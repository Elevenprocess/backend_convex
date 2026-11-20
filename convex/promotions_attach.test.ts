import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import { normalizeTag, reunionDayEndMs, reunionDayStartMs } from "./model/promotions";

async function seedPromo(t: ReturnType<typeof makeT>) {
  const admin = await insertUser(t, { role: "admin" });
  return await t.run((ctx) => ctx.db.insert("promotions", {
    name: "Black Friday", tag: "Black Friday", tagKey: normalizeTag("Black Friday"),
    startAt: reunionDayStartMs("2026-11-23"), endAt: reunionDayEndMs("2026-11-29"),
    archived: false, createdBy: admin, createdAt: 0,
  }));
}
const DURING = reunionDayStartMs("2026-11-24");

describe("rattachement par tag", () => {
  it("createLeadFromWebhook avec le tag pendant la promo → rattaché (source tag) + ghlTags", async () => {
    const t = makeT();
    const promoId = await seedPromo(t);
    const { leadId } = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1", data: { firstName: "A" }, signals: {}, tags: ["simulateur", "black friday"], now: DURING,
    });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).toMatchObject({ promotionId: promoId, promotionSource: "tag", ghlTags: ["simulateur", "black friday"] });
  });

  it("hors période → tags stockés mais pas de rattachement", async () => {
    const t = makeT();
    await seedPromo(t);
    const { leadId } = await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c2", data: {}, signals: {}, tags: ["Black Friday"], now: reunionDayStartMs("2026-12-02"),
    });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.promotionId).toBeUndefined();
    expect(lead?.ghlTags).toEqual(["Black Friday"]);
  });

  it("ancien lead taggé pendant la promo → rattaché ; rejouer = idempotent ; jamais retiré", async () => {
    const t = makeT();
    const promoId = await seedPromo(t);
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "perdu", externalId: "old", createdAt: 1 }));
    const first = await t.mutation(internal.promotions.applyLeadTags, { leadId, tags: ["black friday"], at: DURING });
    const again = await t.mutation(internal.promotions.applyLeadTags, { leadId, tags: ["black friday"], at: DURING });
    await t.mutation(internal.promotions.applyLeadTags, { leadId, tags: ["autre"], at: DURING });
    expect(first.attached).toBe(true);
    expect(again.attached).toBe(false);
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.promotionId).toBe(promoId);
    expect(lead?.ghlTags).toEqual(["autre"]);
  });

  it("applyContactTags : lead introuvable → matched false", async () => {
    const t = makeT();
    await seedPromo(t);
    const r = await t.mutation(internal.promotions.applyContactTags, { contactId: "nope", tags: ["black friday"], at: DURING });
    expect(r).toEqual({ matched: false, attached: false });
  });
});
