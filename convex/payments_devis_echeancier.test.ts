// ─── payments_devis_echeancier.test.ts — l'échéancier suit le devis signé ────
// Un devis signé porte les conditions de règlement réelles (echeancier OCR) :
// pour les ventes comptant / mode non renseigné, le plan de tranches vient du
// devis (priorité : custom > devis > template standard), chaque tranche étant
// rattachée au jalon workflow correspondant.

import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const DEVIS_ECHEANCIER = [
  { label: "Signature du devis", montant: 4000 },
  { label: "Validation technique", montant: 2000 },
  { label: "Réception du CNO", montant: 2000 },
  { label: "Fin de pose", montant: 2000 },
];

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Test" });
  return { comId, finId, leadId };
}

async function insertSignedDevis(
  t: any,
  leadId: any,
  comId: any,
  extra: Record<string, any> = {},
) {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("devis", {
      leadId,
      commercialId: comId,
      status: "signe",
      filename: "devis.pdf",
      sizeBytes: 1,
      ocrStatus: "done",
      devisNumber: "2605-0393",
      montantTtc: 10000,
      signedAt: Date.now(),
      lignes: [],
      echeancier: DEVIS_ECHEANCIER,
      extracted: {},
      ...extra,
    }),
  );
}

test("comptant + devis signé : l'échéancier suit les tranches du devis (labels, montants, jalons)", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  await insertSignedDevis(t, leadId, comId);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  const a = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });

  expect(a!.echeancierSource).toBe("devis");
  expect(a!.devisNumber).toBe("2605-0393");
  expect(a!.echeances).toHaveLength(4);
  expect(a!.echeances.map((e: any) => e.label)).toEqual([
    "Signature du devis",
    "Validation technique",
    "Réception du CNO",
    "Fin de pose",
  ]);
  expect(a!.echeances.map((e: any) => e.jalonKey)).toEqual([
    "signature",
    "vt_validee",
    "dp_validee",
    "install_effectuee",
  ]);
  expect(a!.echeances.map((e: any) => e.montantPrevu)).toEqual([4000, 2000, 2000, 2000]);
  // Jalon 'signature' toujours franchi → tranche 1 due d'emblée.
  expect(a!.echeances[0].jalonAtteint).toBe(true);
  expect(a!.echeances[0].statut).toBe("a_encaisser");
  expect(a!.echeances[1].statut).toBe("en_attente");
});

test("recordEcheance valide les ordres contre les tranches du devis (même ensemble lecture/écriture)", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  // Devis à 2 tranches : le template comptant standard en aurait 4.
  await insertSignedDevis(t, leadId, comId, {
    echeancier: [
      { label: "Signature", montant: 5000 },
      { label: "Fin de pose", montant: 5000 },
    ],
  });

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  // Ordre 2 = tranche du devis → accepté.
  await asUser(t, finId).mutation(api.payments.recordEcheance, {
    debriefId,
    ordre: 2,
    statut: "encaisse",
    montantReel: 5000,
    dateEncaissement: "2026-06-30",
  });

  // Ordre 3 n'existe pas dans le devis (il existerait dans le template 40/20/20/20).
  await expect(
    asUser(t, finId).mutation(api.payments.recordEcheance, {
      debriefId,
      ordre: 3,
      statut: "encaisse",
      montantReel: 1,
      dateEncaissement: "2026-06-30",
    }),
  ).rejects.toThrow(/Ordre 3 invalide/);

  const a = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(a!.echeances).toHaveLength(2);
  expect(a!.totalEncaisse).toBe(5000);
});

test("financement : l'échéancier du devis est ignoré, le solde organisme reste la règle", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  await insertSignedDevis(t, leadId, comId, { financingType: "financement" });

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "financement",
  });

  const a = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(a!.echeancierSource).toBe("standard");
  expect(a!.devisNumber).toBe(null);
  expect(a!.echeances).toHaveLength(1);
  expect(a!.echeances[0].jalonKey).toBe("install_effectuee");
});

test("échéancier personnalisé (back-office) prioritaire sur le devis", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  await insertSignedDevis(t, leadId, comId);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  await asUser(t, finId).mutation(api.payments.setEcheancier, {
    debriefId,
    tranches: [
      { label: "Acompte négocié", percent: 50 },
      { label: "Solde négocié", percent: 50 },
    ],
  });

  const a = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(a!.echeancierSource).toBe("custom");
  expect(a!.echeances).toHaveLength(2);
  expect(a!.echeances[0].label).toBe("Acompte négocié");
});

test("devis non signé ou sans échéancier : retombe sur le template standard", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  // Devis en attente (non signé) avec échéancier → ne doit PAS piloter.
  await insertSignedDevis(t, leadId, comId, { status: "en_attente" });
  // Devis signé mais sans échéancier extrait → idem.
  await insertSignedDevis(t, leadId, comId, { echeancier: [], devisNumber: "X-1" });

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 10000,
    financingType: "comptant",
  });

  const a = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(a!.echeancierSource).toBe("standard");
  // Template comptant historique : 40/20/20/20.
  expect(a!.echeances).toHaveLength(4);
  expect(a!.echeances[0].jalonKey).toBe("vt_validee");
});

test("somme devis ≠ montant net débrief : proportions appliquées au montant du débrief", async () => {
  const t = makeT();
  const { comId, finId, leadId } = await seed(t);
  // Devis TTC 10 000, débrief net de prime 9 000.
  await insertSignedDevis(t, leadId, comId);

  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId,
    outcome: "vente",
    montantTotal: 9000,
    financingType: "comptant",
  });

  const a = await asUser(t, finId).query(api.payments.getAcompte, {
    debriefId,
    today: "2026-07-01",
  });
  expect(a!.echeancierSource).toBe("devis");
  // 40/20/20/20 de 9 000 ; la dernière tranche absorbe l'arrondi.
  expect(a!.echeances.map((e: any) => e.montantPrevu)).toEqual([3600, 1800, 1800, 1800]);
});
