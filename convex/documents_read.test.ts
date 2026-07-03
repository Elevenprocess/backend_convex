import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

async function seed(t: ReturnType<typeof makeT>) {
  const boId = await insertUser(t, { role: "back_office" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "signe", firstName: "S" }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  const subs = await t.run((ctx: any) =>
    ctx.db.query("workflowSubsteps").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
  const subByKey = Object.fromEntries(subs.map((s: any) => [s.key, s]));
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["pdf"])));
  const [docSummary] = await asUser(t, boId).mutation(api.documents.attachToSubstep, {
    substepId: subByKey.dp_envoyee_mairie._id,
    files: [{ storageId, filename: "recepisse.pdf", mimeType: "application/pdf", sizeBytes: 3 }],
  });
  return { boId, clientId, subByKey, docId: docSummary.id };
}

test("getUrl : url non nulle pour finances ; null si supprimé", async () => {
  const t = makeT();
  const { boId, docId } = await seed(t);
  const finId = await insertUser(t, { role: "finances", email: "f@e.fr" });
  const res = await asUser(t, finId).query(api.documents.getUrl, { documentId: docId });
  expect(res).not.toBeNull();
  expect(res!.url).toBeTruthy();
  expect(res!.filename).toBe("recepisse.pdf");
  await asUser(t, boId).mutation(api.documents.remove, { documentId: docId });
  expect(await asUser(t, finId).query(api.documents.getUrl, { documentId: docId })).toBeNull();
});

test("getUrl : technicien limité à SES dossiers", async () => {
  const t = makeT();
  const { boId, clientId, docId } = await seed(t);
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  expect(await asUser(t, techId).query(api.documents.getUrl, { documentId: docId })).toBeNull();
  await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtIds: [techId],
  });
  expect(await asUser(t, techId).query(api.documents.getUrl, { documentId: docId })).not.toBeNull();
});

test("listBySubstep : résumés actifs ; hors périmètre → []", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  const rows = await asUser(t, boId).query(api.documents.listBySubstep, {
    substepId: subByKey.dp_envoyee_mairie._id,
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].filename).toBe("recepisse.pdf");
  // technicien sans dossier attribué → hors périmètre
  expect(
    await asUser(t, techId).query(api.documents.listBySubstep, {
      substepId: subByKey.dp_envoyee_mairie._id,
    }),
  ).toEqual([]);
});

test("remove : soft-delete + droits (technicien hors scope refusé)", async () => {
  const t = makeT();
  const { boId, docId } = await seed(t);
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  await expect(
    asUser(t, techId).mutation(api.documents.remove, { documentId: docId }),
  ).rejects.toThrow(/non autorisé/);
  const res = await asUser(t, boId).mutation(api.documents.remove, { documentId: docId });
  expect(res).toEqual({ ok: true });
  const row = await t.run((ctx: any) => ctx.db.query("documents").collect());
  expect(row[0].deletedAt).toBeDefined();
  // Re-suppression → throw introuvable
  await expect(
    asUser(t, boId).mutation(api.documents.remove, { documentId: docId }),
  ).rejects.toThrow(/introuvable/);
});
