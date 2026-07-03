import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

// ─── Helpers de seed ─────────────────────────────────────────────────────────

async function seedCommercialAndLead(t: ReturnType<typeof makeT>) {
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, {
    firstName: "Sophie",
    lastName: "Martin",
  });
  return { comId, leadId };
}

async function activeClients(t: ReturnType<typeof makeT>) {
  const rows = await t.run((ctx: any) => ctx.db.query("clients").collect());
  return rows.filter((c: any) => c.deletedAt === undefined);
}

// Devis minimal inséré directement (l'upload/OCR est hors du périmètre du test).
async function seedDevis(
  t: ReturnType<typeof makeT>,
  fields: { leadId: any; commercialId: any; projectId?: any; rdvId?: any },
) {
  return t.run((ctx: any) =>
    ctx.db.insert("devis", {
      leadId: fields.leadId,
      projectId: fields.projectId,
      rdvId: fields.rdvId,
      commercialId: fields.commercialId,
      status: "brouillon",
      filename: "devis.pdf",
      sizeBytes: 1000,
      ocrStatus: "done",
      montantTtc: 12000,
      montantNet: 11000,
      financingType: "comptant",
      kits: "Kit 6kWc",
      lignes: [],
      echeancier: [],
      extracted: {},
    }),
  );
}

// ─── Débrief vente → dossier ─────────────────────────────────────────────────

test("un débrief vente crée un dossier clients avec workflow semé", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);

  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
    kits: "Kit 6kWc",
    signedAt: 1_750_000_000_000,
  });

  const clients = await activeClients(t);
  expect(clients).toHaveLength(1);
  expect(clients[0].leadId).toBe(leadId);
  expect(clients[0].projectId).toBeDefined(); // projet bootstrappé par ensureProjectForLead
  expect(clients[0].montantTotal).toBe(15000);
  expect(clients[0].typeFinancement).toBe("comptant");
  expect(clients[0].kits).toBe("Kit 6kWc");
  expect(clients[0].signedAt).toBe(1_750_000_000_000);
  expect(clients[0].statusGlobal).toBe("vt_a_faire");

  const substeps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", clients[0]._id))
      .collect(),
  );
  expect(substeps).toHaveLength(12);
});

test("un débrief non-vente ne crée PAS de dossier", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);

  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "pas_de_vente",
    nonSaleReason: "budget",
  });

  expect(await activeClients(t)).toHaveLength(0);
});

test("debriefs.create (par projet) avec outcome vente crée le dossier du projet", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, {
    leadId,
  });

  await asUser(t, comId).mutation(api.debriefs.create, {
    projectId,
    outcome: "vente",
    montantTotal: 20000,
  });

  const clients = await activeClients(t);
  expect(clients).toHaveLength(1);
  expect(clients[0].projectId).toBe(projectId);
  expect(clients[0].montantTotal).toBe(20000);
});

// ─── devis.markAsSigned → dossier ────────────────────────────────────────────

test("devis.markAsSigned crée le dossier (montantNet prioritaire sur TTC)", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, {
    leadId,
  });
  const devisId = await seedDevis(t, { leadId, commercialId: comId, projectId });

  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });

  const clients = await activeClients(t);
  expect(clients).toHaveLength(1);
  expect(clients[0].projectId).toBe(projectId);
  expect(clients[0].montantTotal).toBe(11000); // montantNet, pas montantTtc
  expect(clients[0].typeFinancement).toBe("comptant");
});

test("devis.markAsSigned sans projet crée un dossier scopé au lead", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);
  const devisId = await seedDevis(t, { leadId, commercialId: comId });

  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });

  const clients = await activeClients(t);
  expect(clients).toHaveLength(1);
  expect(clients[0].leadId).toBe(leadId);
  expect(clients[0].projectId).toBeUndefined();
});

test("markAsSigned idempotent : re-signature ne crée pas de 2e dossier", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, {
    leadId,
  });
  const devisId = await seedDevis(t, { leadId, commercialId: comId, projectId });

  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });
  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });

  expect(await activeClients(t)).toHaveLength(1);
});

// ─── Convergence débrief + devis ─────────────────────────────────────────────

test("double signature (débrief vente puis devis signé, même projet) = 1 seul dossier", async () => {
  const t = makeT();
  const { comId, leadId } = await seedCommercialAndLead(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, {
    leadId,
  });

  await asUser(t, comId).mutation(api.debriefs.create, {
    projectId,
    outcome: "vente",
    montantTotal: 15000,
  });
  const devisId = await seedDevis(t, { leadId, commercialId: comId, projectId });
  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });

  const clients = await activeClients(t);
  expect(clients).toHaveLength(1);
  // Le devis signé a rafraîchi les champs vente (montantNet)
  expect(clients[0].montantTotal).toBe(11000);
});
