import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

// ─── Helpers de seed ─────────────────────────────────────────────────────────

async function seedLead(t: ReturnType<typeof makeT>) {
  return t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual",
      status: "qualifie",
      firstName: "Sophie",
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

// ─── Tests ───────────────────────────────────────────────────────────────────

test("bootstrap({projectId}) crée un dossier avec workflow semé, retrouvable via getByProject", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const comId = await insertUser(t, { role: "commercial", email: "c@ecoi.fr" });
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId, comId);

  const clientId = await asUser(t, boId).mutation(api.clients.bootstrap, {
    projectId,
  });

  const dossier = await asUser(t, boId).query(api.clients.getByProject, {
    projectId,
  });
  expect(dossier).not.toBeNull();
  expect(dossier!._id).toBe(clientId);
  expect(dossier!.leadId).toBe(leadId); // leadId résolu depuis le projet
  expect(dossier!.statusGlobal).toBe("vt_a_faire");

  const substeps = await t.run((ctx: any) =>
    ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client", (q: any) => q.eq("clientId", clientId))
      .collect(),
  );
  expect(substeps).toHaveLength(12);
});

test("bootstrap({leadId}) sans projet crée un dossier legacy scopé au lead", async () => {
  const t = makeT();
  const rtId = await insertUser(t, { role: "responsable_technique" });
  const leadId = await seedLead(t);

  const clientId = await asUser(t, rtId).mutation(api.clients.bootstrap, {
    leadId,
  });

  const dossier = await asUser(t, rtId).query(api.clients.getByLead, { leadId });
  expect(dossier).not.toBeNull();
  expect(dossier!._id).toBe(clientId);
  expect(dossier!.projectId).toBeUndefined();
});

test("double bootstrap = 1 seul dossier (idempotent)", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const comId = await insertUser(t, { role: "commercial", email: "c@ecoi.fr" });
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId, comId);

  const id1 = await asUser(t, boId).mutation(api.clients.bootstrap, { projectId });
  const id2 = await asUser(t, boId).mutation(api.clients.bootstrap, { projectId });
  expect(id2).toBe(id1);

  const clients = await t.run((ctx: any) => ctx.db.query("clients").collect());
  expect(clients).toHaveLength(1);
});

test("bootstrap({}) sans leadId ni projectId → throw", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });

  await expect(
    asUser(t, boId).mutation(api.clients.bootstrap, {}),
  ).rejects.toThrow(/leadId ou projectId/);
});

test("bootstrap avec projectId introuvable → throw", async () => {
  const t = makeT();
  const boId = await insertUser(t, { role: "back_office" });
  const comId = await insertUser(t, { role: "commercial", email: "c@ecoi.fr" });
  const leadId = await seedLead(t);
  const projectId = await seedProject(t, leadId, comId);
  await t.run((ctx: any) => ctx.db.patch(projectId, { deletedAt: 1_000 }));

  await expect(
    asUser(t, boId).mutation(api.clients.bootstrap, { projectId }),
  ).rejects.toThrow(/introuvable/);
});

test("rôles non autorisés (technicien, setter, finances) → throw", async () => {
  const t = makeT();
  const techId = await insertUser(t, { role: "technicien" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const finId = await insertUser(t, { role: "finances", email: "f@ecoi.fr" });
  const leadId = await seedLead(t);

  for (const uid of [techId, setterId, finId]) {
    await expect(
      asUser(t, uid).mutation(api.clients.bootstrap, { leadId }),
    ).rejects.toThrow(/Accès refusé/);
  }
});

test("admin peut bootstrapper", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const leadId = await seedLead(t);

  const clientId = await asUser(t, adminId).mutation(api.clients.bootstrap, {
    leadId,
  });
  expect(clientId).toBeTruthy();
});
