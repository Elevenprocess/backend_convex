import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

describe("devTools.purgePromoTestLead", () => {
  it("supprime un lead d’essai et son journal ; refuse un vrai lead", async () => {
    const t = makeT();
    const now = Date.now();
    const essai = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "ESSAIx", lastName: "CRENEAU (à supprimer)", createdAt: now }));
    const vrai = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "abc123", lastName: "Hoarau", createdAt: now }));
    const presque = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "abc456", lastName: "Payet (à supprimer)", createdAt: now }));
    await t.mutation(internal.promotions.setSlotFromWebhook, { leadId: essai, day: "2026-11-27", hour: 14, at: now });
    await expect(t.mutation(internal.devTools.purgePromoTestLead, { leadId: vrai })).rejects.toThrow(/Refus/);
    await expect(t.mutation(internal.devTools.purgePromoTestLead, { leadId: presque })).rejects.toThrow(/Refus/);
    expect(await t.mutation(internal.devTools.purgePromoTestLead, { leadId: essai })).toEqual({ deleted: 2 });
    expect(await t.run((ctx) => ctx.db.query("leads").collect())).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.query("activityLog").collect())).toHaveLength(0);
  });
});
