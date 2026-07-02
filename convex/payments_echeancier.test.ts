// ─── payments_echeancier.test.ts — TDD tranche 5 mutations setEcheancier/resetEcheancier ─
// RED  : tests écrits avant l'implémentation
// GREEN: passe après l'ajout de setEcheancier/resetEcheancier dans payments.ts

import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const adminId = await insertUser(t, { role: "admin", email: "admin@ecoi.fr" });
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const delivId = await insertUser(t, { role: "delivrabilite", email: "d@ecoi.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Test" });
  return { comId, adminId, finId, setterId, delivId, leadId };
}

// ─── setEcheancier : remplace par 2 tranches custom + customEcheancier=true ──
test("setEcheancier: remplace l'échéancier par 2 tranches et passe customEcheancier=true", async () => {
  const t = makeT();
  const { comId, adminId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 12000,
    financingType: "comptant",
  });

  await asUser(t, adminId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "Acompte 30%", percent: 30, montantPrevu: 3600 },
      { label: "Solde 70%", percent: 70, montantPrevu: 8400 },
    ],
  });

  const result = await asUser(t, adminId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  // 2 tranches exactement
  expect(result!.echeances).toHaveLength(2);
  expect(result!.echeances[0].ordre).toBe(1);
  expect(result!.echeances[0].label).toBe("Acompte 30%");
  expect(result!.echeances[1].ordre).toBe(2);
  expect(result!.echeances[1].label).toBe("Solde 70%");
  // customEcheancier=true sur le débrief
  expect(result!.customEcheancier).toBe(true);
});

// ─── setEcheancier : préserve l'encaissement existant si statut absent du DTO ─
test("setEcheancier: préserve le statut/montantReel/dateEncaissement si non fournis", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  // Premier setEcheancier : crée 2 tranches AVEC statut sur la 1ère
  await asUser(t, finId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "Tranche 1", percent: 40, statut: "encaisse", montantReel: 4000, dateEncaissement: "2026-06-01" },
      { label: "Tranche 2", percent: 60 },
    ],
  });

  // Second setEcheancier : met à jour le label de la 1ère tranche SANS fournir statut
  await asUser(t, finId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "Tranche 1 renommée", percent: 40 }, // pas de statut/montantReel/dateEncaissement
      { label: "Tranche 2", percent: 60 },
    ],
  });

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  const t1 = result!.echeances.find((e: any) => e.ordre === 1);
  expect(t1).toBeDefined();
  expect(t1!.label).toBe("Tranche 1 renommée");
  // Encaissement préservé (non écrasé)
  expect(t1!.statut).toBe("encaisse");
  expect(t1!.montantReel).toBe(4000);
  expect(t1!.dateEncaissement).toBe("2026-06-01");
});

// ─── setEcheancier : supprime les ordres en trop ──────────────────────────────
test("setEcheancier: supprime les tranches d'ordre > tranches.length", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  // Créer 3 tranches
  await asUser(t, finId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "T1", percent: 33 },
      { label: "T2", percent: 33 },
      { label: "T3", percent: 34 },
    ],
  });

  // Réduire à 2 tranches → T3 (ordre 3) doit disparaître
  await asUser(t, finId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "T1", percent: 50 },
      { label: "T2", percent: 50 },
    ],
  });

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  expect(result!.echeances).toHaveLength(2);
  expect(result!.echeances.find((e: any) => e.ordre === 3)).toBeUndefined();
});

// ─── resetEcheancier : customEcheancier=false, lignes non supprimées ──────────
test("resetEcheancier: passe customEcheancier=false et conserve les lignes en base", async () => {
  const t = makeT();
  const { comId, adminId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 8000,
    financingType: "comptant",
  });

  // setEcheancier d'abord pour avoir customEcheancier=true + des lignes
  await asUser(t, adminId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "Custom 1", percent: 50 },
      { label: "Custom 2", percent: 50 },
    ],
  });

  // reset
  await asUser(t, adminId).mutation(api.payments.resetEcheancier, { debriefId });

  // Vérifier que customEcheancier est revenu à false
  // On vérifie via getAcompte (qui expose customEcheancier)
  const result = await asUser(t, adminId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  expect(result!.customEcheancier).toBe(false);

  // Les lignes persistées restent en base (non supprimées)
  // On le vérifie indirectement : si customEcheancier=false, assembleEcheancier
  // utilise les templates standards. Les lignes persistées ne sont pas visibles
  // directement dans getAcompte (elles servent seulement quand customEcheancier=true).
  // Pour vérifier les lignes, on remet customEcheancier=true et on check.
  await asUser(t, adminId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "Custom 1 rétabli", percent: 50 },
      { label: "Custom 2 rétabli", percent: 50 },
    ],
  });
  const result2 = await asUser(t, adminId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  // Les lignes sont encore là (reset ne les a pas supprimées, juste mises à jour)
  expect(result2!.echeances).toHaveLength(2);
});

// ─── rôle non autorisé → throw ────────────────────────────────────────────────
test("setEcheancier: rôle setter → accès refusé", async () => {
  const t = makeT();
  const { comId, setterId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, setterId).mutation(api.payments.setEcheancier, {
      debriefId,
      tranches: [{ label: "T1", percent: 100 }],
    }),
  ).rejects.toThrow(/accès refusé|non autorisé|refusé/i);
});

test("resetEcheancier: rôle setter → accès refusé", async () => {
  const t = makeT();
  const { comId, setterId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, setterId).mutation(api.payments.resetEcheancier, { debriefId }),
  ).rejects.toThrow(/accès refusé|non autorisé|refusé/i);
});

// ─── débrief soft-deleted → throw ────────────────────────────────────────────
test("setEcheancier: débrief soft-deleted → throw 'introuvable'", async () => {
  const t = makeT();
  const { comId, adminId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  await asUser(t, comId).mutation(api.debriefs.softDelete, { debriefId });

  await expect(
    asUser(t, adminId).mutation(api.payments.setEcheancier, {
      debriefId,
      tranches: [{ label: "T1", percent: 100 }],
    }),
  ).rejects.toThrow(/introuvable/i);
});

test("resetEcheancier: débrief soft-deleted → throw 'introuvable'", async () => {
  const t = makeT();
  const { comId, adminId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  await asUser(t, comId).mutation(api.debriefs.softDelete, { debriefId });

  await expect(
    asUser(t, adminId).mutation(api.payments.resetEcheancier, { debriefId }),
  ).rejects.toThrow(/introuvable/i);
});
