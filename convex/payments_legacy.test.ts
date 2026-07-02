// ─── payments_legacy.test.ts — TDD tranche 5 legacy bridges ──────────────────
// RED  : tests écrits avant l'implémentation
// GREEN: passe après ensureImportedProjectDebriefs (no-op) +
//        pont legacy acompteEncaissements dans assembleEcheancier.

import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "LegacyTest" });
  return { comId, finId, leadId };
}

// ─── ensureImportedProjectDebriefs ───────────────────────────────────────────

test("ensureImportedProjectDebriefs est une no-op et retourne { created: 0 }", async () => {
  const t = makeT();
  const result = await t.mutation(internal.payments.ensureImportedProjectDebriefs, {});
  expect(result).toEqual({ created: 0 });
});

test("ensureImportedProjectDebriefs ne crée aucun débrief", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "A" });
  // Insérer un projet sans débrief vente
  await t.run((ctx: any) =>
    ctx.db.insert("projects", {
      leadId,
      commercialId: comId,
      name: "Projet sans débrief",
      status: "qualification",
    }),
  );

  const before = await t.run((ctx: any) =>
    ctx.db.query("debriefs").collect(),
  );
  await t.mutation(internal.payments.ensureImportedProjectDebriefs, {});
  const after = await t.run((ctx: any) =>
    ctx.db.query("debriefs").collect(),
  );

  // Aucun débrief créé (la table clients n'existe pas encore)
  expect(after.length).toBe(before.length);
});

// ─── Pont legacy acompteEncaissements ────────────────────────────────────────

test("pont legacy: ligne acompteEncaissements (encaisse) remonte dans echeances à ordre=1", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // Insérer une ligne legacy directement en base
  await t.run((ctx: any) =>
    ctx.db.insert("acompteEncaissements", {
      debriefId,
      leadId,
      statut: "encaisse",
      montantReel: 6000,
      dateEncaissement: "2026-01-15",
    }),
  );

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  expect(result).not.toBeNull();
  const tranche1 = result!.echeances.find((e: any) => e.ordre === 1);
  expect(tranche1).toBeDefined();
  // La ligne legacy est surfacée avec statut encaisse et montantReel
  expect(tranche1!.statut).toBe("encaisse");
  expect(tranche1!.montantReel).toBe(6000);
  expect(tranche1!.dateEncaissement).toBe("2026-01-15");
});

test("pont legacy: statut 'attendu' mappé en 'a_encaisser'", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  await t.run((ctx: any) =>
    ctx.db.insert("acompteEncaissements", {
      debriefId,
      statut: "attendu",
      montantReel: 4000,
    }),
  );

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  const tranche1 = result!.echeances.find((e: any) => e.ordre === 1);
  expect(tranche1).toBeDefined();
  // 'attendu' legacy → 'a_encaisser' en Convex
  expect(tranche1!.statut).toBe("a_encaisser");
});

test("pont legacy: ignoré si une ligne acompteEcheances moderne existe à ordre=1", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // Insérer une ligne moderne acompteEcheances à ordre=1
  await t.run((ctx: any) =>
    ctx.db.insert("acompteEcheances", {
      debriefId,
      leadId,
      ordre: 1,
      statut: "encaisse",
      montantReel: 9999,
      dateEncaissement: "2026-03-01",
    }),
  );

  // Insérer aussi une ligne legacy — doit être ignorée
  await t.run((ctx: any) =>
    ctx.db.insert("acompteEncaissements", {
      debriefId,
      statut: "encaisse",
      montantReel: 1111,
      dateEncaissement: "2025-01-01",
    }),
  );

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  const tranche1 = result!.echeances.find((e: any) => e.ordre === 1);
  expect(tranche1).toBeDefined();
  // La ligne moderne (9999) prend le dessus sur la legacy (1111)
  expect(tranche1!.montantReel).toBe(9999);
});

test("pont legacy: pas de ligne legacy → comportement normal inchangé", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  // Doit fonctionner normalement : 4 tranches comptant, statuts dérivés.
  // COMPTANT_TEMPLATE = DEFAULT_IMPORTED_TEMPLATE : ordre 1 = "VT validée"
  // (jalonKey: 'vt_validee'), non encore atteinte en env test → en_attente.
  expect(result).not.toBeNull();
  expect(result!.echeances.length).toBe(4);
  // Sans ligne legacy ni moderne, la tranche 1 reste en_attente (vt_validee non franchie).
  const tranche1 = result!.echeances.find((e: any) => e.ordre === 1);
  expect(tranche1!.statut).toBe("en_attente");
  // Sans ligne legacy, montantReel est null.
  expect(tranche1!.montantReel).toBeNull();
});
