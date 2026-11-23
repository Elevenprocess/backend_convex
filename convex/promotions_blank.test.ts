import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { reunionDayStartMs } from "./model/promotions";

const BASE = { name: "Black Friday 2026", startDay: "2026-11-23", endDay: "2026-11-29" };
const DURING = reunionDayStartMs("2026-11-25");

async function setup(status: string) {
  const t = makeT();
  const admin = await insertUser(t, { role: "admin" });
  const promotionId = await asUser(t, admin).mutation(api.promotions.create, BASE);
  const leadId = await t.run((ctx) =>
    ctx.db.insert("leads", { source: "ghl", status: status as never, firstName: "Ancien", createdAt: 0 }),
  );
  return { t, promotionId, leadId };
}

describe("une promo commence par une page blanche", () => {
  it("un lead qualifié il y a longtemps qui entre dans la promo repart de « nouveau »", async () => {
    const { t, promotionId, leadId } = await setup("rdv_honore");
    await t.mutation(internal.promotions.attachFromWebhook, { promotionId, leadId, at: DURING });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).toMatchObject({ status: "nouveau", promotionStatusBefore: "rdv_honore", promotionId });

    // Et il redevient appelable par un setter (plus de verrou « déjà qualifié »).
    const setter = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
    await asUser(t, setter).mutation(api.callLogs.logCall, { leadId, result: "non_joint" });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("pas_de_reponse");
  });

  it("un client signé garde son statut", async () => {
    const { t, promotionId, leadId } = await setup("signe");
    await t.mutation(internal.promotions.attachFromWebhook, { promotionId, leadId, at: DURING });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.status).toBe("signe");
    expect(lead?.promotionStatusBefore).toBeUndefined();
  });

  it("un lead avec un RDV à venir garde son statut", async () => {
    const { t, promotionId, leadId } = await setup("rdv_pris");
    await t.run((ctx) => ctx.db.insert("rdv", {
      leadId, status: "planifie", scheduledAt: DURING + 86_400_000, locationType: "domicile",
    }));
    await t.mutation(internal.promotions.attachFromWebhook, { promotionId, leadId, at: DURING });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("rdv_pris");
  });

  it("rattrapage : remet à zéro les leads déjà rattachés, sauf ceux déjà retravaillés dans la promo", async () => {
    const { t, promotionId, leadId } = await setup("qualifie");
    const worked = await t.run((ctx) =>
      ctx.db.insert("leads", { source: "ghl", status: "qualifie", firstName: "Retravaillé", createdAt: 0 }),
    );
    const setter = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
    await t.run(async (ctx) => {
      await ctx.db.patch(leadId, { promotionId, promotionJoinedAt: DURING, promotionSource: "tag" });
      await ctx.db.patch(worked, { promotionId, promotionJoinedAt: DURING, promotionSource: "tag" });
      await ctx.db.insert("callLogs", { leadId: worked, setterId: setter, calledAt: DURING + 1000, result: "joint" });
    });
    const dry = await t.mutation(internal.promotions.blankSlateExisting, { promotionId, dryRun: true });
    expect(dry).toMatchObject({ reset: 1, workedInPromo: 1 });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("qualifie");

    const done = await t.mutation(internal.promotions.blankSlateExisting, { promotionId, dryRun: false });
    expect(done).toMatchObject({ reset: 1, workedInPromo: 1 });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("nouveau");
    expect((await t.run((ctx) => ctx.db.get(worked)))?.status).toBe("qualifie");
    // Idempotent.
    expect(await t.mutation(internal.promotions.blankSlateExisting, { promotionId, dryRun: false })).toMatchObject({ reset: 0 });
  });
});
