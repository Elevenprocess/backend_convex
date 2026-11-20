import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("promotions.stats", () => {
  it("sépare nouveaux/anciens et domicile/bureau", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const setter = await insertUser(t, { role: "setter", email: "s@x.fr" });
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "BF", tag: "bf", tagKey: "bf", startAt: 0, endAt: Date.now() + 1e9, archived: false, createdBy: admin, createdAt: 0,
    }));
    await t.run(async (ctx) => {
      const n1 = await ctx.db.insert("leads", { source: "ghl", status: "signe", promotionId: promoId, promotionSource: "tag" });
      await ctx.db.insert("leads", { source: "ghl", status: "nouveau", promotionId: promoId, promotionSource: "tag" });
      const a1 = await ctx.db.insert("leads", { source: "ghl", status: "qualifie", promotionId: promoId, promotionSource: "statut" });
      const hors = await ctx.db.insert("leads", { source: "ghl", status: "qualifie" });
      await ctx.db.insert("callLogs", { leadId: n1, setterId: setter, calledAt: 1, result: "joint" });
      await ctx.db.insert("rdv", { leadId: n1, locationType: "domicile", status: "planifie", promotionId: promoId });
      await ctx.db.insert("rdv", { leadId: a1, locationType: "agence", status: "planifie", promotionId: promoId });
      await ctx.db.insert("rdv", { leadId: hors, locationType: "agence", status: "planifie", promotionId: promoId });
    });
    const s = await asUser(t, admin).query(api.promotions.stats, { promotionId: promoId });
    expect(s.nouveaux).toEqual({ leads: 2, joints: 1, rdvDomicile: 1, rdvBureau: 0, qualifies: 1, signes: 1 });
    expect(s.anciens).toEqual({ leads: 1, joints: 0, rdvDomicile: 0, rdvBureau: 1, qualifies: 1, signes: 0 });
    expect(s.rdvBureauHorsPromo).toBe(1);
  });
});
