import { expect, test } from "vitest";
import { makeT } from "./test.kit";

test("acompteEcheances insertable", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("leads", { source: "manual", status: "nouveau" } as any);
    const commercialId = await ctx.db.insert("users", {} as any);
    const debriefId = await ctx.db.insert("debriefs", { commercialId, outcome: "vente", acceptanceFactors: [], customEcheancier: false } as any);
    const id = await ctx.db.insert("acompteEcheances", { debriefId, leadId, ordre: 1, statut: "a_encaisser" });
    expect(await ctx.db.get(id)).toMatchObject({ ordre: 1, statut: "a_encaisser" });
  });
});

test("acompteEncaissements + payments insertables", async () => {
  const t = makeT();
  await t.run(async (ctx) => {
    const commercialId = await ctx.db.insert("users", {} as any);
    const debriefId = await ctx.db.insert("debriefs", { commercialId, outcome: "vente", acceptanceFactors: [], customEcheancier: false } as any);
    await ctx.db.insert("acompteEncaissements", { debriefId, statut: "attendu" });
    await ctx.db.insert("payments", { clientId: "ext-1", type: "acompte_1", montantTheorique: 4000 });
  });
});
