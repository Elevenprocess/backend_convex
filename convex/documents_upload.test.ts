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
  return { boId, leadId, clientId, subByKey, storageId };
}

test("attachToSubstep : insère avec type auto (recepisse_dp) et liens step/substep", async () => {
  const t = makeT();
  const { boId, clientId, subByKey, storageId } = await seed(t);
  const res = await asUser(t, boId).mutation(api.documents.attachToSubstep, {
    substepId: subByKey.dp_envoyee_mairie._id,
    files: [{ storageId, filename: "recepisse.pdf", mimeType: "application/pdf", sizeBytes: 3 }],
  });
  expect(res).toHaveLength(1);
  expect(res[0].type).toBe("recepisse_dp");
  const rows = await t.run((ctx: any) => ctx.db.query("documents").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].clientId).toBe(clientId);
  expect(rows[0].workflowSubstepId).toBe(subByKey.dp_envoyee_mairie._id);
  expect(rows[0].workflowStepId).toBe(subByKey.dp_envoyee_mairie.stepId);
});

test("multi-fichiers OK ; fichier > 25 Mo → throw ; files vide → throw", async () => {
  const t = makeT();
  const { boId, subByKey, storageId } = await seed(t);
  const s2 = await t.run((ctx: any) => ctx.storage.store(new Blob(["y"])));
  const res = await asUser(t, boId).mutation(api.documents.attachToSubstep, {
    substepId: subByKey.consuel_valide._id,
    files: [
      { storageId, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 },
      { storageId: s2, filename: "b.pdf", mimeType: "application/pdf", sizeBytes: 1 },
    ],
  });
  expect(res).toHaveLength(2);
  await expect(
    asUser(t, boId).mutation(api.documents.attachToSubstep, {
      substepId: subByKey.consuel_valide._id,
      files: [
        { storageId, filename: "gros.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 },
      ],
    }),
  ).rejects.toThrow(/25 Mo/);
  await expect(
    asUser(t, boId).mutation(api.documents.attachToSubstep, {
      substepId: subByKey.consuel_valide._id,
      files: [],
    }),
  ).rejects.toThrow(/Aucun fichier/);
});

test("dépôt seul (racco_validee) → dateRealisee posée au jour du dépôt", async () => {
  const t = makeT();
  const { boId, subByKey, storageId } = await seed(t);
  await asUser(t, boId).mutation(api.documents.attachToSubstep, {
    substepId: subByKey.racco_validee._id,
    files: [{ storageId, filename: "crae.pdf", mimeType: "application/pdf", sizeBytes: 3 }],
  });
  const sub = await t.run((ctx: any) => ctx.db.get(subByKey.racco_validee._id));
  expect(sub.dateRealisee).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("technicien : OK sur SA phase terrain, refusé hors scope/hors phase", async () => {
  const t = makeT();
  const { boId, clientId, subByKey, storageId } = await seed(t);
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  // Hors dossier (pas technicienVtId) → refus même sur phase vt
  await expect(
    asUser(t, techId).mutation(api.documents.attachToSubstep, {
      substepId: subByKey.vt_validee._id,
      files: [{ storageId, filename: "r.pdf", mimeType: "application/pdf", sizeBytes: 1 }],
    }),
  ).rejects.toThrow(/non autorisé/);
  await asUser(t, boId).mutation(api.clients.assignTechniciens, {
    clientId,
    technicienVtIds: [techId],
  });
  // Sa phase vt → OK
  await asUser(t, techId).mutation(api.documents.attachToSubstep, {
    substepId: subByKey.vt_validee._id,
    files: [{ storageId, filename: "r.pdf", mimeType: "application/pdf", sizeBytes: 1 }],
  });
  // Phase dp (paperasse) → refus
  const s2 = await t.run((ctx: any) => ctx.storage.store(new Blob(["z"])));
  await expect(
    asUser(t, techId).mutation(api.documents.attachToSubstep, {
      substepId: subByKey.dp_validee._id,
      files: [{ storageId: s2, filename: "d.pdf", mimeType: "application/pdf", sizeBytes: 1 }],
    }),
  ).rejects.toThrow(/non autorisé/);
});

test("generateUploadUrl accessible aux MANAGE_ROLES, refusé au setter", async () => {
  const t = makeT();
  const { boId } = await seed(t);
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr" });
  expect(typeof (await asUser(t, boId).mutation(api.documents.generateUploadUrl, {}))).toBe("string");
  await expect(
    asUser(t, setterId).mutation(api.documents.generateUploadUrl, {}),
  ).rejects.toThrow(/Accès refusé/);
});
