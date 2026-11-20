import { describe, expect, it } from "vitest";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import { normalizeTag } from "./model/promotions";

const SECRET = "hook-secret";

async function post(t: ReturnType<typeof makeT>, body: unknown, secret = SECRET) {
  return await t.fetch("/webhooks/ghl/tags", {
    method: "POST",
    headers: { "content-type": "application/json", "x-elevenprocess-webhook-secret": secret },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /webhooks/ghl/tags", () => {
  it("403 sans bon secret, 400 sans contact_id ou JSON invalide", async () => {
    process.env.ELEVENPROCESS_WEBHOOK_SECRET = SECRET;
    const t = makeT();
    expect((await post(t, { contact_id: "c" }, "faux")).status).toBe(403);
    expect((await post(t, { tags: "x" })).status).toBe(400);
    expect((await post(t, "{pas du json")).status).toBe(400);
  });

  it("rattache le lead existant à la promo en cours et trace l'événement", async () => {
    process.env.ELEVENPROCESS_WEBHOOK_SECRET = SECRET;
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const now = Date.now();
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "BF", tag: "zz-test-promo", tagKey: normalizeTag("zz-test-promo"),
      startAt: now - 3_600_000, endAt: now + 3_600_000, archived: false, createdBy: admin, createdAt: now,
    }));
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", ghlContactId: "ghl-1", createdAt: now }));
    const res = await post(t, { contact_id: "ghl-1", tags: "simulateur,zz-test-promo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matched: true, attached: true });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.promotionId).toBe(promoId);
    const events = await t.run((ctx) => ctx.db.query("webhookEvents").collect());
    expect(events.find((e) => e.eventType === "contact.tags")?.status).toBe("processed");
  });

  it("contact inconnu → 200 matched false", async () => {
    process.env.ELEVENPROCESS_WEBHOOK_SECRET = SECRET;
    const t = makeT();
    const res = await post(t, { contact_id: "inconnu", tags: "x" });
    expect(await res.json()).toMatchObject({ ok: true, matched: false });
  });
});
