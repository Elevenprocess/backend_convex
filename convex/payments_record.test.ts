// ─── payments_record.test.ts — TDD tranche 5 mutation recordEcheance ──────────
// RED  : tests écrits avant l'implémentation
// GREEN: passe après l'ajout de recordEcheance dans payments.ts

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

// ─── Upsert : 1er appel crée la ligne ────────────────────────────────────────
test("recordEcheance: premier appel insère une ligne acompteEcheances", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // comptant → 4 tranches (ordres 1..4)
  await asUser(t, finId).mutation(api.payments.recordEcheance, {
    debriefId,
    ordre: 1,
    statut: "a_encaisser",
  });

  // Vérifier que la ligne existe (en lisant l'échéancier)
  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  const tranche1 = result!.echeances.find((e: any) => e.ordre === 1);
  expect(tranche1).toBeDefined();
  expect(tranche1!.statut).toBe("a_encaisser");
});

// ─── Upsert : 2e appel met à jour la même ligne (pas de doublon) ─────────────
test("recordEcheance: second appel met à jour la même ligne (upsert)", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // Premier appel : insère
  await asUser(t, finId).mutation(api.payments.recordEcheance, {
    debriefId,
    ordre: 2,
    statut: "a_encaisser",
  });

  // Second appel : met à jour
  await asUser(t, finId).mutation(api.payments.recordEcheance, {
    debriefId,
    ordre: 2,
    statut: "encaisse",
    montantReel: 3000,
    dateEncaissement: "2026-06-15",
  });

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  const tranche2 = result!.echeances.find((e: any) => e.ordre === 2);
  expect(tranche2).toBeDefined();
  expect(tranche2!.statut).toBe("encaisse");
  expect(tranche2!.montantReel).toBe(3000);
  expect(tranche2!.dateEncaissement).toBe("2026-06-15");
  // Toujours 4 tranches — pas de doublon
  expect(result!.echeances.filter((e: any) => e.ordre === 2).length).toBe(1);
});

// ─── encaisse sans montantReel → throw ───────────────────────────────────────
test("recordEcheance: statut encaisse sans montantReel → throw", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, finId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 1,
      statut: "encaisse",
      // montantReel absent
      dateEncaissement: "2026-06-01",
    }),
  ).rejects.toThrow(/montantReel.*requis|requis.*montantReel|montantReel/i);
});

// ─── encaisse sans dateEncaissement → throw ──────────────────────────────────
test("recordEcheance: statut encaisse sans dateEncaissement → throw", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, finId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 1,
      statut: "encaisse",
      montantReel: 6000,
      // dateEncaissement absent
    }),
  ).rejects.toThrow(/dateEncaissement.*requis|requis.*dateEncaissement|dateEncaissement/i);
});

// ─── ordre hors template → throw ─────────────────────────────────────────────
test("recordEcheance: ordre hors template (comptant a 4 tranches, ordre=99) → throw", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, finId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 99,
      statut: "a_encaisser",
    }),
  ).rejects.toThrow(/ordre.*invalide|invalide|template/i);
});

// ─── rôle delivrabilite → refusé (seuls admin/finances) ─────────────────────
test("recordEcheance: rôle delivrabilite → refusé", async () => {
  const t = makeT();
  const { comId, delivId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, delivId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 1,
      statut: "a_encaisser",
    }),
  ).rejects.toThrow(/accès refusé|non autorisé|refusé/i);
});

// ─── rôle setter → refusé ────────────────────────────────────────────────────
test("recordEcheance: rôle setter → refusé", async () => {
  const t = makeT();
  const { comId, setterId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, setterId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 1,
      statut: "a_encaisser",
    }),
  ).rejects.toThrow();
});

// ─── débrief introuvable → throw ─────────────────────────────────────────────
test("recordEcheance: débrief soft-deleted → throw 'introuvable'", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });
  await asUser(t, comId).mutation(api.debriefs.softDelete, { debriefId });

  await expect(
    asUser(t, finId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 1,
      statut: "a_encaisser",
    }),
  ).rejects.toThrow(/introuvable/);
});

// ─── admin peut aussi enregistrer ────────────────────────────────────────────
test("recordEcheance: rôle admin peut enregistrer une tranche", async () => {
  const t = makeT();
  const { comId, adminId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 20000,
    financingType: "financement",
  });

  // financement → 1 tranche (ordre 1)
  await expect(
    asUser(t, adminId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 1,
      statut: "a_encaisser",
    }),
  ).resolves.not.toThrow();
});
