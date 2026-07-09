import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

async function seedProjectWithClient(
  t: ReturnType<typeof makeT>,
  clientOverrides: Record<string, unknown> = {},
) {
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "airtable_migration", status: "signe" }));
  const commercialId = await t.run((ctx) => ctx.db.insert("users", { email: "c@e.fr", name: "Com", role: "commercial", active: true }));
  const projectId = await t.run((ctx) => ctx.db.insert("projects", { leadId, commercialId, name: "Projet", status: "signe" }));
  await t.run((ctx) => ctx.db.insert("clients", { leadId, projectId, statusGlobal: "administratif_en_cours", currentPhase: "vt", blocked: false, ...clientOverrides }));
  return { leadId, commercialId, projectId };
}

describe("ensureImportedProjectDebriefs", () => {
  it("crée un débrief vente depuis le montant du dossier, idempotent", async () => {
    const t = makeT();
    const { projectId, leadId } = await seedProjectWithClient(t, { montantTotal: 18000, typeFinancement: "comptant", signedAt: 5000 });

    const r1 = await t.mutation(internal.payments.ensureImportedProjectDebriefs, {});
    expect(r1).toEqual({ created: 1 });
    const [deb] = await t.run((ctx) => ctx.db.query("debriefs").collect());
    expect(deb).toMatchObject({ projectId, leadId, outcome: "vente", montantTotal: 18000, financingType: "comptant", signedAt: 5000 });

    const r2 = await t.mutation(internal.payments.ensureImportedProjectDebriefs, {});
    expect(r2).toEqual({ created: 0 });
    expect(await t.run((ctx) => ctx.db.query("debriefs").collect())).toHaveLength(1);
  });

  it("priorité au devis signé (montantNet) sur le montant dossier", async () => {
    const t = makeT();
    const { projectId, leadId, commercialId } = await seedProjectWithClient(t, { montantTotal: 10000, typeFinancement: "comptant" });
    await t.run((ctx) => ctx.db.insert("devis", { leadId, projectId, commercialId, status: "signe", montantNet: 22000, financingType: "financement", ocrStatus: "done", filename: "d.pdf", sizeBytes: 1, lignes: [], echeancier: [], extracted: {} }));

    await t.mutation(internal.payments.ensureImportedProjectDebriefs, {});
    const [deb] = await t.run((ctx) => ctx.db.query("debriefs").collect());
    expect(deb).toMatchObject({ montantTotal: 22000, financingType: "financement" });
  });

  it("ignore dossier sans montant, projet déjà débriefé, dossier supprimé", async () => {
    const t = makeT();
    await seedProjectWithClient(t, {}); // sans montantTotal
    const withDebrief = await seedProjectWithClient(t, { montantTotal: 9000 });
    await t.run((ctx) => ctx.db.insert("debriefs", { leadId: withDebrief.leadId, projectId: withDebrief.projectId, commercialId: withDebrief.commercialId, outcome: "vente", acceptanceFactors: [], customEcheancier: false }));
    const del = await seedProjectWithClient(t, { montantTotal: 12000 });
    await t.run(async (ctx) => {
      const c = await ctx.db.query("clients").withIndex("by_project", (q) => q.eq("projectId", del.projectId)).first();
      if (c) await ctx.db.patch(c._id, { deletedAt: 1 });
    });

    const r = await t.mutation(internal.payments.ensureImportedProjectDebriefs, {});
    expect(r).toEqual({ created: 0 });
  });
});
