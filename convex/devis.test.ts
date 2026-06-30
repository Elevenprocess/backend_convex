import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Z" });
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["%PDF-1.4 data"])));
  return { comId, leadId, storageId };
}

// L'upload planifie l'action OCR (runAfter 0). On laisse le timer démarrer puis
// on attend la fin de l'action (sans clé OpenRouter → markOcrFailed) pour ne pas
// laisser d'écriture planifiée fuir après le test.
async function drain(t: any) {
  await new Promise((r) => setTimeout(r, 25));
  await t.finishInProgressScheduledFunctions();
}

test("create insère un devis brouillon/pending et hérite du commercial", async () => {
  const t = makeT();
  const { comId, leadId, storageId } = await seed(t);
  const devisId = await asUser(t, comId).mutation(api.devis.create, {
    leadId, storageId, filename: "devis.pdf", sizeBytes: 13,
  });
  const d = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(d.status).toBe("brouillon");
  expect(d.ocrStatus).toBe("pending");
  expect(d.commercialId).toBe(comId);
  expect(d.filename).toBe("devis.pdf");
  await drain(t);
});

test("create refusé pour un setter", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Z" });
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["x"])));
  await expect(
    asUser(t, setterId).mutation(api.devis.create, { leadId, storageId, filename: "d.pdf", sizeBytes: 1 }),
  ).rejects.toThrow(/non autorisé/);
});

test("create autorisé pour la délivrabilité (back_office)", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office", email: "bo@ecoi.fr" });
  const comId = await insertUser(t, { role: "commercial", email: "c@ecoi.fr" });
  const leadId = await asUser(t, comId).mutation(api.leads.create, { firstName: "Z" });
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["x"])));
  const devisId = await asUser(t, boId).mutation(api.devis.create, { leadId, storageId, filename: "d.pdf", sizeBytes: 1 });
  expect(devisId).toBeDefined();
  await drain(t);
});

test("getById renvoie sans markedSignedById/deletedAt ; listByLead filtre soft-deleted", async () => {
  const t = makeT();
  const { comId, leadId, storageId } = await seed(t);
  const devisId = await asUser(t, comId).mutation(api.devis.create, { leadId, storageId, filename: "d.pdf", sizeBytes: 1 });
  await drain(t);
  const got = await asUser(t, comId).query(api.devis.getById, { devisId });
  expect(got._id).toBe(devisId);
  expect("markedSignedById" in got).toBe(false);
  expect("deletedAt" in got).toBe(false);
  await t.run((ctx: any) => ctx.db.patch(devisId, { deletedAt: Date.now() }));
  expect(await asUser(t, comId).query(api.devis.getById, { devisId })).toBeNull();
  const list = await asUser(t, comId).query(api.devis.listByLead, { leadId });
  expect(list).toHaveLength(0);
});

test("getPdfUrl renvoie une URL", async () => {
  const t = makeT();
  const { comId, leadId, storageId } = await seed(t);
  const devisId = await asUser(t, comId).mutation(api.devis.create, { leadId, storageId, filename: "d.pdf", sizeBytes: 1 });
  await drain(t);
  const url = await asUser(t, comId).query(api.devis.getPdfUrl, { devisId });
  expect(typeof url).toBe("string");
});
