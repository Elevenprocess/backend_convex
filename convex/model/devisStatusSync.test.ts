import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { insertUser } from "../test.helpers";
import { syncStatusToLeadAndProject } from "./devisStatusSync";

async function seed(t: any, devisStatus: string) {
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "qualifie", firstName: "S" }));
  const projectId = await t.run((ctx: any) =>
    ctx.db.insert("projects", { leadId, commercialId: comId, name: "P", status: "qualification" }));
  const devisId = await t.run((ctx: any) =>
    ctx.db.insert("devis", {
      leadId, projectId, commercialId: comId, status: devisStatus, ocrStatus: "done",
      filename: "d.pdf", sizeBytes: 1, lignes: [], echeancier: [], extracted: {},
    }));
  return { leadId, projectId, devisId };
}

async function statuses(t: any, leadId: string, projectId: string) {
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  const project = await t.run((ctx: any) => ctx.db.get(projectId));
  return { lead: lead.status, project: project.status };
}

async function applySync(t: any, devisId: string) {
  const devisRow = await t.run((ctx: any) => ctx.db.get(devisId));
  await t.run((ctx: any) => syncStatusToLeadAndProject(ctx, devisRow));
}

test("signe → lead signe + projet signe", async () => {
  const t = makeT();
  const { leadId, projectId, devisId } = await seed(t, "signe");
  await applySync(t, devisId);
  expect(await statuses(t, leadId, projectId)).toEqual({ lead: "signe", project: "signe" });
});

test("signature_en_cours → les deux en signature_en_cours", async () => {
  const t = makeT();
  const { leadId, projectId, devisId } = await seed(t, "signature_en_cours");
  await applySync(t, devisId);
  expect(await statuses(t, leadId, projectId)).toEqual({ lead: "signature_en_cours", project: "signature_en_cours" });
});

test("perdu → les deux en perdu", async () => {
  const t = makeT();
  const { leadId, projectId, devisId } = await seed(t, "perdu");
  await applySync(t, devisId);
  expect(await statuses(t, leadId, projectId)).toEqual({ lead: "perdu", project: "perdu" });
});

test("en_attente → projet devis_en_cours, lead inchangé", async () => {
  const t = makeT();
  const { leadId, projectId, devisId } = await seed(t, "en_attente");
  await applySync(t, devisId);
  expect(await statuses(t, leadId, projectId)).toEqual({ lead: "qualifie", project: "devis_en_cours" });
});

test("brouillon → no-op", async () => {
  const t = makeT();
  const { leadId, projectId, devisId } = await seed(t, "brouillon");
  await applySync(t, devisId);
  expect(await statuses(t, leadId, projectId)).toEqual({ lead: "qualifie", project: "qualification" });
});
