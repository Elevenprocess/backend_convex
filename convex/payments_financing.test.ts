// ─── payments_financing.test.ts — TDD tranche 5 mutation updateFinancing ─────
// RED  : tests écrits avant l'implémentation
// GREEN: passe après l'ajout de updateFinancing dans payments.ts

import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Test" });
  return { comId, setterId, finId, leadId };
}

// ─── Test principal : recalcul à la lecture après changement de type ──────────
test("updateFinancing: comptant (4 tranches) → financement (1 tranche), recalcul à la lecture", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // Avant : comptant → COMPTANT_TEMPLATE = 4 tranches
  const before = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(before).not.toBeNull();
  expect(before!.echeances.length).toBe(4);

  // Mutation : passer en financement
  await asUser(t, finId).mutation(api.payments.updateFinancing, {
    debriefId,
    financingType: "financement",
  });

  // Après : financement → FINANCEMENT_TEMPLATE = 1 tranche (recalcul à la lecture)
  const after = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(after).not.toBeNull();
  expect(after!.financingType).toBe("financement");
  expect(after!.echeances.length).toBe(1);
});

// ─── Patch vide → throw ───────────────────────────────────────────────────────
test("updateFinancing: patch vide → throw 'au moins un champ'", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, finId).mutation(api.payments.updateFinancing, { debriefId }),
  ).rejects.toThrow(/au moins un champ/i);
});

// ─── Rôle non autorisé → refusé ──────────────────────────────────────────────
test("updateFinancing: rôle setter → refusé (accès refusé)", async () => {
  const t = makeT();
  const { comId, setterId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  await expect(
    asUser(t, setterId).mutation(api.payments.updateFinancing, {
      debriefId,
      financingType: "financement",
    }),
  ).rejects.toThrow();
});

// ─── Débrief soft-deleted → throw introuvable ─────────────────────────────────
test("updateFinancing: débrief soft-deleted → throw 'introuvable'", async () => {
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
    asUser(t, finId).mutation(api.payments.updateFinancing, {
      debriefId,
      financingType: "financement",
    }),
  ).rejects.toThrow(/introuvable/);
});

// ─── Patch partiel : mise à jour montantTotal seul ───────────────────────────
test("updateFinancing: patch partiel montantTotal seul est accepté", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 15000,
    financingType: "comptant",
  });

  // Patch uniquement le montant
  await asUser(t, finId).mutation(api.payments.updateFinancing, {
    debriefId,
    montantTotal: 18000,
  });

  const result = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(result!.montantTotal).toBe(18000);
  // financingType inchangé = toujours comptant → toujours 4 tranches
  expect(result!.financingType).toBe("comptant");
  expect(result!.echeances.length).toBe(4);
});
