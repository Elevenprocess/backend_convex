import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("anciens leads par statut", () => {
  it("aperçu puis rattachement : statuts ciblés, exclusions, statut inchangé, idempotent", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const now = Date.now();
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "BF", startAt: now - 3_600_000, endAt: now + 7 * 86_400_000,
      legacyStatuses: ["perdu", "relance"], archived: false, createdBy: admin, createdAt: now,
    }));
    const ids = await t.run(async (ctx) => {
      const ok1 = await ctx.db.insert("leads", { source: "ghl", status: "perdu", createdAt: 10 });
      const ok2 = await ctx.db.insert("leads", { source: "ghl", status: "relance", createdAt: 20 });
      const horsStatut = await ctx.db.insert("leads", { source: "ghl", status: "nouveau", createdAt: 30 });
      const supprime = await ctx.db.insert("leads", { source: "ghl", status: "perdu", createdAt: 40, deletedAt: 1 });
      const avecRdv = await ctx.db.insert("leads", { source: "ghl", status: "perdu", createdAt: 50 });
      await ctx.db.insert("rdv", { leadId: avecRdv, scheduledAt: now + 86_400_000, locationType: "domicile", status: "planifie" });
      const rdvPasse = await ctx.db.insert("leads", { source: "ghl", status: "relance", createdAt: 60 });
      await ctx.db.insert("rdv", { leadId: rdvPasse, scheduledAt: now - 86_400_000, locationType: "domicile", status: "planifie" });
      return { ok1, ok2, horsStatut, supprime, avecRdv, rdvPasse };
    });
    const as = asUser(t, admin);
    const preview = await as.query(api.promotions.previewLegacy, { promotionId: promoId, now });
    expect(preview).toEqual({ eligible: 3, byStatus: { perdu: 1, relance: 2 }, skipped: 2 });

    const first = await as.action(api.promotions.attachLegacy, { promotionId: promoId });
    expect(first).toMatchObject({ attached: 3 });
    const second = await as.action(api.promotions.attachLegacy, { promotionId: promoId });
    expect(second.attached).toBe(0);

    const ok1 = await t.run((ctx) => ctx.db.get(ids.ok1));
    expect(ok1).toMatchObject({ promotionId: promoId, promotionSource: "statut", status: "perdu" });
    expect((await t.run((ctx) => ctx.db.get(ids.avecRdv)))?.promotionId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(ids.horsStatut)))?.promotionId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(ids.rdvPasse)))?.promotionId).toBe(promoId);
  });

  it("refusé sur une promo terminée et pour un setter", async () => {
    const t = makeT();
    const admin = await insertUser(t, { role: "admin" });
    const setter = await insertUser(t, { role: "setter", email: "s@x.fr" });
    const promoId = await t.run((ctx) => ctx.db.insert("promotions", {
      name: "Vieille", startAt: 0, endAt: 1000, legacyStatuses: ["perdu"], archived: false, createdBy: admin, createdAt: 0,
    }));
    await expect(asUser(t, admin).action(api.promotions.attachLegacy, { promotionId: promoId })).rejects.toThrow(/terminée/);
    await expect(asUser(t, setter).action(api.promotions.attachLegacy, { promotionId: promoId })).rejects.toThrow(/Accès refusé/);
  });
});
