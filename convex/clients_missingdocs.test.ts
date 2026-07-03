import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

test("missingDocs : compteur initial (docs attendus) puis décrémente après upload", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "signe", firstName: "S" }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));

  // Catalogue : 6 sous-étapes attendent ≥1 doc (vt_validee, dp_envoyee_mairie,
  // dp_validee, racco_envoye, racco_validee, consuel_valide).
  const before = await asUser(t, boId).query(api.clients.list, {});
  expect(before[0].missingDocs).toBe(6);

  const subs = await t.run((ctx: any) =>
    ctx.db.query("workflowSubsteps").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
  const dp = subs.find((s: any) => s.key === "dp_envoyee_mairie");
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["p"])));
  await asUser(t, boId).mutation(api.documents.attachToSubstep, {
    substepId: dp._id,
    files: [{ storageId, filename: "r.pdf", mimeType: "application/pdf", sizeBytes: 1 }],
  });

  const after = await asUser(t, boId).query(api.clients.list, {});
  expect(after[0].missingDocs).toBe(5);
  const one = await asUser(t, boId).query(api.clients.getByLead, { leadId });
  expect(one!.missingDocs).toBe(5);
});
