import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

async function seedDossier(
  t: ReturnType<typeof makeT>,
  opts: { technicienVtId?: any; assignedToId?: any } = {},
) {
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: "Sophie",
      lastName: "Martin",
      ...(opts.assignedToId ? { assignedToId: opts.assignedToId } : {}),
    }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  if (opts.technicienVtId) {
    await t.run((ctx: any) => ctx.db.patch(clientId, { technicienVtId: opts.technicienVtId }));
  }
  const steps = await t.run((ctx: any) =>
    ctx.db.query("workflowSteps").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
  const stepByPhase = Object.fromEntries(steps.map((s: any) => [s.phase, s]));
  return { leadId, clientId, stepByPhase };
}

test("list : back_office voit tout, filtres clientId/phase/status", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { clientId } = await seedDossier(t);
  await seedDossier(t);
  const all = await asUser(t, boId).query(api.workflowSteps.list, {});
  expect(all).toHaveLength(12); // 2 dossiers × 6 phases
  const one = await asUser(t, boId).query(api.workflowSteps.list, { clientId });
  expect(one).toHaveLength(6);
  const vt = await asUser(t, boId).query(api.workflowSteps.list, { clientId, phase: "vt" });
  expect(vt).toHaveLength(1);
  const aFaire = await asUser(t, boId).query(api.workflowSteps.list, { status: "a_faire" });
  expect(aFaire).toHaveLength(12);
});

test("list : technicien ne voit que ses dossiers, get hors scope → null", async () => {
  const t = makeT();
  const techId = await insertUser(t, { role: "technicien" });
  const mine = await seedDossier(t, { technicienVtId: techId });
  const other = await seedDossier(t);
  const rows = await asUser(t, techId).query(api.workflowSteps.list, {});
  expect(rows).toHaveLength(6);
  expect(rows.every((s: any) => s.clientId === mine.clientId)).toBe(true);
  const hidden = await asUser(t, techId).query(api.workflowSteps.get, {
    stepId: other.stepByPhase.vt._id,
  });
  expect(hidden).toBeNull();
  const visible = await asUser(t, techId).query(api.workflowSteps.get, {
    stepId: mine.stepByPhase.vt._id,
  });
  expect(visible).not.toBeNull();
});

test("list : commercial scopé à ses leads ; commercial_lead voit tout", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const clId = await insertUser(t, { role: "commercial_lead", email: "cl@e.fr" });
  await seedDossier(t, { assignedToId: comId });
  await seedDossier(t);
  expect(await asUser(t, comId).query(api.workflowSteps.list, {})).toHaveLength(6);
  expect(await asUser(t, clId).query(api.workflowSteps.list, {})).toHaveLength(12);
});

test("update back_office : status fait → audit + recompute client", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { clientId, stepByPhase } = await seedDossier(t);
  await asUser(t, boId).mutation(api.workflowSteps.update, {
    stepId: stepByPhase.vt._id,
    status: "fait",
    notes: "ras",
  });
  const step = await t.run((ctx: any) => ctx.db.get(stepByPhase.vt._id));
  expect(step.status).toBe("fait");
  expect(step.notes).toBe("ras");
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("administratif_en_cours"); // VT fait → phase dp
  const audits = await t.run((ctx: any) => ctx.db.query("auditLog").collect());
  expect(audits).toHaveLength(1);
  expect(audits[0].entityType).toBe("workflow_step");
});

test("update sans changement de statut → pas d'audit ; null efface un champ", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { stepByPhase } = await seedDossier(t);
  await asUser(t, boId).mutation(api.workflowSteps.update, {
    stepId: stepByPhase.vt._id,
    notes: "brouillon",
  });
  await asUser(t, boId).mutation(api.workflowSteps.update, {
    stepId: stepByPhase.vt._id,
    notes: null,
  });
  const step = await t.run((ctx: any) => ctx.db.get(stepByPhase.vt._id));
  expect(step.notes).toBeUndefined();
  expect(await t.run((ctx: any) => ctx.db.query("auditLog").collect())).toHaveLength(0);
});

test("sortie de probleme → problemResolvedAt posé ; resolveProblem nettoie problemReason", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { stepByPhase } = await seedDossier(t);
  await asUser(t, boId).mutation(api.workflowSteps.update, {
    stepId: stepByPhase.vt._id,
    status: "probleme",
    problemReason: "vt_client_absent",
  });
  await asUser(t, boId).mutation(api.workflowSteps.resolveProblem, {
    stepId: stepByPhase.vt._id,
    status: "en_cours",
  });
  const step = await t.run((ctx: any) => ctx.db.get(stepByPhase.vt._id));
  expect(step.status).toBe("en_cours");
  expect(step.problemReason).toBeUndefined();
  expect(step.problemResolvedAt).toBeDefined();
});

test("garde-fous : technicien hors phase terrain / hors dossier / assign / resolve", async () => {
  const t = makeT();
  const techId = await insertUser(t, { role: "technicien" });
  const boId = await insertUser(t, { role: "back_office", email: "b@e.fr" });
  const mine = await seedDossier(t, { technicienVtId: techId });
  const other = await seedDossier(t);
  // technicien édite SA phase vt → OK
  await asUser(t, techId).mutation(api.workflowSteps.update, {
    stepId: mine.stepByPhase.vt._id,
    status: "en_cours",
  });
  // phase dp interdite
  await expect(
    asUser(t, techId).mutation(api.workflowSteps.update, {
      stepId: mine.stepByPhase.dp._id,
      status: "en_cours",
    }),
  ).rejects.toThrow(/non autorisé/);
  // dossier d'un autre interdit
  await expect(
    asUser(t, techId).mutation(api.workflowSteps.update, {
      stepId: other.stepByPhase.vt._id,
      status: "en_cours",
    }),
  ).rejects.toThrow(/non autorisé/);
  // assign interdit au technicien
  await expect(
    asUser(t, techId).mutation(api.workflowSteps.update, {
      stepId: mine.stepByPhase.vt._id,
      responsableId: techId,
    }),
  ).rejects.toThrow(/assigner/);
  // resolve_problem interdit au technicien
  await asUser(t, boId).mutation(api.workflowSteps.update, {
    stepId: mine.stepByPhase.vt._id,
    status: "probleme",
    problemReason: "vt_client_absent",
  });
  await expect(
    asUser(t, techId).mutation(api.workflowSteps.update, {
      stepId: mine.stepByPhase.vt._id,
      status: "en_cours",
    }),
  ).rejects.toThrow(/problème/);
});
