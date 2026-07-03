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
  return { boId, clientId, subByKey };
}

test("missingDocument : true avant upload du type attendu, false après, revient à la suppression", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  const get = async () =>
    (await asUser(t, boId).query(api.workflowSubsteps.get, {
      substepId: subByKey.dp_envoyee_mairie._id,
    }))!;

  expect((await get()).missingDocument).toBe(true);
  expect((await get()).documents).toEqual([]);

  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["p"])));
  const [doc] = await asUser(t, boId).mutation(api.documents.attachToSubstep, {
    substepId: subByKey.dp_envoyee_mairie._id,
    files: [{ storageId, filename: "r.pdf", mimeType: "application/pdf", sizeBytes: 1 }],
  });
  const after = await get();
  expect(after.missingDocument).toBe(false);
  expect(after.documents).toHaveLength(1);
  expect(after.documents[0].type).toBe("recepisse_dp");

  await asUser(t, boId).mutation(api.documents.remove, { documentId: doc.id });
  expect((await get()).missingDocument).toBe(true);
});

test("sous-étape sans doc attendu : missingDocument false", async () => {
  const t = makeT();
  const { boId, subByKey } = await seed(t);
  const row = (await asUser(t, boId).query(api.workflowSubsteps.get, {
    substepId: subByKey.vt_planifie._id,
  }))!;
  expect(row.missingDocument).toBe(false);
});

test("list décoré aussi (documents + missingDocument présents)", async () => {
  const t = makeT();
  const { boId, clientId } = await seed(t);
  const rows = await asUser(t, boId).query(api.workflowSubsteps.list, { clientId });
  expect(rows.every((r: any) => "missingDocument" in r && Array.isArray(r.documents))).toBe(true);
});
