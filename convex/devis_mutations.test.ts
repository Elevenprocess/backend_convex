import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

// L'upload planifie l'OCR (runAfter 0) ; on draine pour ne pas laisser fuir
// d'écriture planifiée après le test.
async function drain(t: any) {
  await new Promise((r) => setTimeout(r, 25));
  await t.finishInProgressScheduledFunctions();
}

async function seedDevis(t: any, opts: { rdvId?: boolean } = {}) {
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Z" });
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "P" });
  const rdvId = opts.rdvId
    ? await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId })
    : undefined;
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["x"])));
  const devisId = await asUser(t, comId).mutation(api.devis.create, {
    leadId, projectId, rdvId, storageId, filename: "d.pdf", sizeBytes: 1,
  });
  await drain(t);
  return { comId, leadId, projectId, rdvId, devisId, storageId };
}

test("update patche les champs + merge extracted + sync statut", async () => {
  const t = makeT();
  const { comId, leadId, projectId, devisId } = await seedDevis(t);
  await asUser(t, comId).mutation(api.devis.update, {
    devisId, status: "en_attente", montantTtc: 12000,
    customer: { firstName: "Léa" }, lignes: [{ designation: "X", qty: 1 }],
  });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.status).toBe("en_attente");
  expect(d.montantTtc).toBe(12000);
  expect(d.extracted.customer.firstName).toBe("Léa");
  expect(d.extracted.lignes).toHaveLength(1);
  const project = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(project.status).toBe("devis_en_cours");
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  expect(lead.status).toBe("nouveau"); // en_attente ne touche pas le lead
});

test("update interdit sur un devis signé", async () => {
  const t = makeT();
  const { comId, devisId } = await seedDevis(t);
  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });
  await expect(
    asUser(t, comId).mutation(api.devis.update, { devisId, montantTtc: 1 }),
  ).rejects.toThrow(/signé/i);
});

test("markAsSigned passe signe + sync lead/projet + rdv inline", async () => {
  const t = makeT();
  const { comId, leadId, projectId, rdvId, devisId } = await seedDevis(t, { rdvId: true });
  await asUser(t, comId).mutation(api.devis.update, { devisId, montantNet: 9000, financingType: "comptant", kits: "kit A" });
  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.status).toBe("signe");
  expect(d.signedAt).toBeGreaterThan(0);
  expect(d.markedSignedById).toBe(comId);
  expect((await t.run((ctx: any) => ctx.db.get(leadId))).status).toBe("signe");
  expect((await t.run((ctx: any) => ctx.db.get(projectId))).status).toBe("signe");
  const rdvRow = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(rdvRow.result).toBe("signe");
  expect(rdvRow.montantTotal).toBe(9000);
  expect(rdvRow.kits).toBe("kit A");
});

test("markAsSigned est idempotent", async () => {
  const t = makeT();
  const { comId, devisId } = await seedDevis(t);
  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });
  const r2 = await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });
  expect(r2.status).toBe("signe");
});

test("remove supprime un devis non signé + son fichier", async () => {
  const t = makeT();
  const { comId, devisId } = await seedDevis(t);
  const r = await asUser(t, comId).mutation(api.devis.remove, { devisId });
  expect(r.deleted).toBe(true);
  expect(await t.run((ctx: any) => ctx.db.get(devisId))).toBeNull();
});

test("remove refusé sur un devis signé", async () => {
  const t = makeT();
  const { comId, devisId } = await seedDevis(t);
  await asUser(t, comId).mutation(api.devis.markAsSigned, { devisId });
  await expect(asUser(t, comId).mutation(api.devis.remove, { devisId })).rejects.toThrow(/signé/i);
});

test("retryOcr guard : interdit si statut OCR ≠ failed", async () => {
  const t = makeT();
  const { comId, devisId } = await seedDevis(t);
  // seedDevis a drainé l'OCR (→ failed sans clé) ; on repart d'un état non-failed.
  await t.run((ctx: any) => ctx.db.patch(devisId, { ocrStatus: "done", ocrError: undefined }));
  await expect(asUser(t, comId).mutation(api.devis.retryOcr, { devisId })).rejects.toThrow(/retry/i);
  await t.run((ctx: any) => ctx.db.patch(devisId, { ocrStatus: "failed", ocrError: "x" }));
  await asUser(t, comId).mutation(api.devis.retryOcr, { devisId });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.ocrStatus).toBe("pending");
  expect(d.ocrError).toBeUndefined();
  await drain(t); // retryOcr replanifie l'OCR
});
