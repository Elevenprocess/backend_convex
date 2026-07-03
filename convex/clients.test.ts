import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ensureDossier } from "./model/ensureDossier";

// ─── Helpers de seed ─────────────────────────────────────────────────────────

async function seedLead(t: ReturnType<typeof makeT>, firstName = "Sophie") {
  return t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "qualifie",
      firstName,
      lastName: "Martin",
    }),
  );
}

async function seedProject(
  t: ReturnType<typeof makeT>,
  leadId: any,
  commercialId: any,
) {
  return t.run((ctx: any) =>
    ctx.db.insert("projects", {
      leadId,
      commercialId,
      name: "Projet test",
      status: "signe",
    }),
  );
}

async function seedDossier(
  t: ReturnType<typeof makeT>,
  opts: { withProject?: boolean } = { withProject: true },
) {
  const comId = await insertUser(t, {
    role: "commercial",
    email: `c${Math.floor(Math.random() * 1e9)}@ecoi.fr`,
  });
  const leadId = await seedLead(t);
  const projectId = opts.withProject
    ? await seedProject(t, leadId, comId)
    : undefined;
  const clientId = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, projectId }),
  );
  return { comId, leadId, projectId, clientId };
}

// ─── getByProject / getByLead ────────────────────────────────────────────────

test("getByProject renvoie le dossier actif du projet", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { projectId, clientId } = await seedDossier(t);

  const dossier = await asUser(t, boId).query(api.clients.getByProject, {
    projectId: projectId!,
  });
  expect(dossier).not.toBeNull();
  expect(dossier!._id).toBe(clientId);
  expect(dossier!.statusGlobal).toBe("vt_a_faire");
  expect(dossier!.currentPhase).toBe("vt");
});

test("getByProject renvoie null si le dossier est supprimé", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const { projectId, clientId } = await seedDossier(t);
  await t.run((ctx: any) => ctx.db.patch(clientId, { deletedAt: 1_000 }));

  const dossier = await asUser(t, boId).query(api.clients.getByProject, {
    projectId: projectId!,
  });
  expect(dossier).toBeNull();
});

test("getByLead renvoie le dossier actif du lead", async () => {
  const t = makeT();
  const rtId = await insertUser(t, { role: "responsable_technique" });
  const { leadId, clientId } = await seedDossier(t, { withProject: false });

  const dossier = await asUser(t, rtId).query(api.clients.getByLead, {
    leadId,
  });
  expect(dossier).not.toBeNull();
  expect(dossier!._id).toBe(clientId);
});

// ─── list ────────────────────────────────────────────────────────────────────

test("list renvoie les dossiers actifs et exclut les supprimés", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const d1 = await seedDossier(t);
  const d2 = await seedDossier(t);
  await t.run((ctx: any) => ctx.db.patch(d2.clientId, { deletedAt: 1_000 }));

  const rows = await asUser(t, boId).query(api.clients.list, {});
  expect(rows.map((r: any) => r._id)).toEqual([d1.clientId]);
});

test("list filtre par statusGlobal", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const d1 = await seedDossier(t);
  const d2 = await seedDossier(t);
  // d2 passe en annule (patch direct du dérivé stocké pour le test)
  await t.run((ctx: any) => ctx.db.patch(d2.clientId, { statusGlobal: "annule" }));

  const rows = await asUser(t, boId).query(api.clients.list, {
    statusGlobal: "annule",
  });
  expect(rows.map((r: any) => r._id)).toEqual([d2.clientId]);

  const rowsVt = await asUser(t, boId).query(api.clients.list, {
    statusGlobal: "vt_a_faire",
  });
  expect(rowsVt.map((r: any) => r._id)).toEqual([d1.clientId]);
});

test("list filtre par phase et par blocked", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const d1 = await seedDossier(t);
  const d2 = await seedDossier(t);
  await t.run((ctx: any) =>
    ctx.db.patch(d2.clientId, { currentPhase: "dp", blocked: true }),
  );

  const rowsDp = await asUser(t, boId).query(api.clients.list, { phase: "dp" });
  expect(rowsDp.map((r: any) => r._id)).toEqual([d2.clientId]);

  const rowsBlocked = await asUser(t, boId).query(api.clients.list, {
    blocked: true,
  });
  expect(rowsBlocked.map((r: any) => r._id)).toEqual([d2.clientId]);

  const rowsVt = await asUser(t, boId).query(api.clients.list, { phase: "vt" });
  expect(rowsVt.map((r: any) => r._id)).toEqual([d1.clientId]);
});

test("list filtre par projectId et leadId", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const d1 = await seedDossier(t);
  await seedDossier(t);

  const byProject = await asUser(t, boId).query(api.clients.list, {
    projectId: d1.projectId!,
  });
  expect(byProject.map((r: any) => r._id)).toEqual([d1.clientId]);

  const byLead = await asUser(t, boId).query(api.clients.list, {
    leadId: d1.leadId,
  });
  expect(byLead.map((r: any) => r._id)).toEqual([d1.clientId]);
});

// ─── Rôles ───────────────────────────────────────────────────────────────────

test("les rôles lecture élargie (finances, commercial, technicien) accèdent à list", async () => {
  const t = makeT();
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const comId = await insertUser(t, { role: "commercial", email: "com@ecoi.fr" });
  const techId = await insertUser(t, { role: "technicien", email: "t@ecoi.fr" });
  await seedDossier(t);

  for (const uid of [finId, comId, techId]) {
    const rows = await asUser(t, uid).query(api.clients.list, {});
    expect(rows).toHaveLength(1);
  }
});

test("un setter n'a pas accès aux queries clients", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const { projectId, leadId } = await seedDossier(t);

  await expect(
    asUser(t, setterId).query(api.clients.list, {}),
  ).rejects.toThrow(/Accès refusé/);
  await expect(
    asUser(t, setterId).query(api.clients.getByProject, { projectId: projectId! }),
  ).rejects.toThrow(/Accès refusé/);
  await expect(
    asUser(t, setterId).query(api.clients.getByLead, { leadId }),
  ).rejects.toThrow(/Accès refusé/);
});
