import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

async function seedDossier(
  t: ReturnType<typeof makeT>,
  opts: { technicienVtId?: any } = {},
) {
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: "Sophie",
      lastName: "Martin",
    }),
  );
  const clientId = await t.run((ctx: any) => ensureDossier(ctx, { leadId }));
  if (opts.technicienVtId) {
    await t.run((ctx: any) => ctx.db.patch(clientId, { technicienVtId: opts.technicienVtId }));
  }
  const subs = await t.run((ctx: any) =>
    ctx.db.query("workflowSubsteps").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
  const subByKey = Object.fromEntries(subs.map((s: any) => [s.key, s]));
  return { leadId, clientId, subByKey };
}

test("list décoré du flag unlocked (ordre intra-phase, non bloquant)", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { clientId, subByKey } = await seedDossier(t);
  const unlockedByKey = (rs: any[]) =>
    Object.fromEntries(rs.map((r) => [r.key, r.unlocked])) as Record<string, boolean>;

  let u = unlockedByKey(await asUser(t, boId).query(api.workflowSubsteps.list, { clientId }));
  // Têtes de phase déverrouillées ; sous-étapes suivantes en attente du prérequis.
  expect(u.vt_planifie).toBe(true);
  expect(u.dp_envoyee_mairie).toBe(true);
  expect(u.install_a_faire).toBe(true);
  expect(u.vt_attribuee).toBe(false);
  expect(u.vt_validee).toBe(false);
  expect(u.dp_validee).toBe(false);

  // Marquer vt_planifie `fait` déverrouille vt_attribuee (mais pas encore vt_validee).
  await asUser(t, boId).mutation(api.workflowSubsteps.update, { substepId: subByKey.vt_planifie._id, status: "fait" });
  u = unlockedByKey(await asUser(t, boId).query(api.workflowSubsteps.list, { clientId }));
  expect(u.vt_attribuee).toBe(true);
  expect(u.vt_validee).toBe(false);
});

test("list filtre par phase (via catalogue) ; technicien scopé", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  const mine = await seedDossier(t, { technicienVtId: techId });
  await seedDossier(t);
  const vt = await asUser(t, boId).query(api.workflowSubsteps.list, {
    clientId: mine.clientId,
    phase: "vt",
  });
  expect(vt.map((r: any) => r.key).sort()).toEqual(["vt_attribuee", "vt_planifie", "vt_validee"]);
  const techRows = await asUser(t, techId).query(api.workflowSubsteps.list, {});
  expect(techRows).toHaveLength(12);
  expect(techRows.every((r: any) => r.clientId === mine.clientId)).toBe(true);
  // get hors scope → null
  const otherSub = (await asUser(t, boId).query(api.workflowSubsteps.list, {})).find(
    (r: any) => r.clientId !== mine.clientId,
  );
  expect(
    await asUser(t, techId).query(api.workflowSubsteps.get, { substepId: otherSub._id }),
  ).toBeNull();
});

test("update : chaîne recompute substep → step → client", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { clientId, subByKey } = await seedDossier(t);
  for (const key of ["vt_planifie", "vt_attribuee", "vt_validee"]) {
    await asUser(t, boId).mutation(api.workflowSubsteps.update, {
      substepId: subByKey[key]._id,
      status: "fait",
    });
  }
  const step = await t.run((ctx: any) => ctx.db.get(subByKey.vt_validee.stepId));
  expect(step.status).toBe("fait");
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("administratif_en_cours");
  expect(client.currentPhase).toBe("dp");
});

test("update : audit sur changement de statut, heure patchable, sortie de problème", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { subByKey } = await seedDossier(t);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    status: "probleme",
    problemReason: "vt_client_absent",
    heure: "14:30",
  });
  await asUser(t, boId).mutation(api.workflowSubsteps.resolveProblem, {
    substepId: subByKey.vt_planifie._id,
    status: "en_cours",
  });
  const sub = await t.run((ctx: any) => ctx.db.get(subByKey.vt_planifie._id));
  expect(sub.heure).toBe("14:30");
  expect(sub.problemReason).toBeUndefined();
  expect(sub.problemResolvedAt).toBeDefined();
  const audits = await t.run((ctx: any) => ctx.db.query("auditLog").collect());
  expect(audits).toHaveLength(2); // probleme puis en_cours
  expect(audits[0].entityType).toBe("workflow_substep");
});

test("cancel_sale : (dés)annuler réservé — technicien refusé, back_office OK", async () => {
  const t = makeT();
  const techId = await insertUser(t, { role: "technicien" });
  const boId = await insertUser(t, { role: "back_office", email: "b@e.fr" });
  const { subByKey } = await seedDossier(t, { technicienVtId: techId });
  await expect(
    asUser(t, techId).mutation(api.workflowSubsteps.update, {
      substepId: subByKey.vt_planifie._id,
      status: "annule",
    }),
  ).rejects.toThrow(/annuler/);
  await asUser(t, boId).mutation(api.workflowSubsteps.update, {
    substepId: subByKey.vt_planifie._id,
    status: "annule",
  });
  // désannulation par technicien refusée aussi
  await expect(
    asUser(t, techId).mutation(api.workflowSubsteps.update, {
      substepId: subByKey.vt_planifie._id,
      status: "a_faire",
    }),
  ).rejects.toThrow(/annuler/);
});

test("garde-fous : technicien phase dp interdite, commercial lecture seule", async () => {
  const t = makeT();
  const techId = await insertUser(t, { role: "technicien" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr" });
  const { subByKey } = await seedDossier(t, { technicienVtId: techId });
  await expect(
    asUser(t, techId).mutation(api.workflowSubsteps.update, {
      substepId: subByKey.dp_envoyee_mairie._id,
      status: "fait",
    }),
  ).rejects.toThrow(/non autorisé/);
  await expect(
    asUser(t, comId).mutation(api.workflowSubsteps.update, {
      substepId: subByKey.vt_planifie._id,
      notes: "x",
    }),
  ).rejects.toThrow(/Accès refusé|non autorisé/);
});
