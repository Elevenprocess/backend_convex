import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";

async function seedDevis(t: any, withProject = true) {
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "qualifie", firstName: "Old" }));
  const projectId = withProject
    ? await t.run((ctx: any) => ctx.db.insert("projects", { leadId, commercialId: comId, name: "P", status: "qualification" }))
    : undefined;
  const devisId = await t.run((ctx: any) =>
    ctx.db.insert("devis", {
      leadId, projectId, commercialId: comId, status: "brouillon", ocrStatus: "processing",
      filename: "d.pdf", sizeBytes: 1, lignes: [], echeancier: [], extracted: {},
    }));
  return { comId, leadId, projectId, devisId };
}

test("applyExtraction dénormalise les colonnes et stocke le brut", async () => {
  const t = makeT();
  const { devisId } = await seedDevis(t);
  await t.mutation(internal.devis.applyExtraction, {
    devisId,
    extracted: {
      devisNumber: "2605-0393", devisDate: "2026-05-27",
      puissanceKwc: 8.4, nbPanneaux: 14, kits: "14 panneaux",
      montantHt: 10000, montantTva: 850, montantTtc: 10850, montantNet: 9000,
      financingType: "comptant",
      prime: { montant: 1850, tarifEuroParKwc: 930, zone: "La Réunion" },
      lignes: [{ designation: "Panneau", qty: 14 }],
      echeancier: [{ label: "Signature", montant: 4500 }],
    },
  });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.ocrStatus).toBe("done");
  expect(d.ocrCompletedAt).toBeGreaterThan(0);
  expect(d.devisNumber).toBe("2605-0393");
  expect(d.puissanceKwc).toBe(8.4);
  expect(d.montantNet).toBe(9000);
  expect(d.primeAutoconsommation).toBe(1850);
  expect(d.primeTarifKwc).toBe(930);
  expect(d.primeZone).toBe("La Réunion");
  expect(d.lignes).toHaveLength(1);
  expect(d.echeancier).toHaveLength(1);
  expect(d.extracted.devisNumber).toBe("2605-0393");
});

test("applyExtraction patche le lead (customer propre) et le projet (adresse)", async () => {
  const t = makeT();
  const { leadId, projectId, devisId } = await seedDevis(t);
  await t.mutation(internal.devis.applyExtraction, {
    devisId,
    extracted: {
      customer: { firstName: "Marie", lastName: "Curie", city: "Saint-Pierre", addressLine: "2 rue Y", postalCode: "97410" },
    },
  });
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  expect(lead.firstName).toBe("Marie");
  expect(lead.city).toBe("Saint-Pierre");
  const project = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(project.addressLine).toBe("2 rue Y");
  expect(project.city).toBe("Saint-Pierre");
});

test("applyExtraction ignore un customer vide/vendeur", async () => {
  const t = makeT();
  const { leadId, devisId } = await seedDevis(t, false);
  await t.mutation(internal.devis.applyExtraction, {
    devisId, extracted: { customer: { firstName: "ELECTRO CONCEPT OI" } },
  });
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  expect(lead.firstName).toBe("Old"); // inchangé
});

test("markOcrFailed pose failed + message", async () => {
  const t = makeT();
  const { devisId } = await seedDevis(t);
  await t.mutation(internal.devis.markOcrFailed, { devisId, error: "boom" });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.ocrStatus).toBe("failed");
  expect(d.ocrError).toBe("boom");
});

test("setOcrProcessing pose processing", async () => {
  const t = makeT();
  const { devisId } = await seedDevis(t);
  await t.run((ctx: any) => ctx.db.patch(devisId, { ocrStatus: "pending" }));
  await t.mutation(internal.devis.setOcrProcessing, { devisId });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.ocrStatus).toBe("processing");
});
