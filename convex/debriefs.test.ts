import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Z" });
  return { comId, setterId, leadId };
}

async function leadStatus(t: any, leadId: string) {
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  return lead.status;
}

test("createForLead vente crée le projet signe + lead signe + stage history", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente", montantTotal: 15000, acceptanceFactors: ["aides"],
  });
  const d = await t.run((ctx: any) => ctx.db.get(debriefId));
  expect(d.projectId).toBeDefined();
  const project = await t.run((ctx: any) => ctx.db.get(d.projectId));
  expect(project.status).toBe("signe");
  expect(await leadStatus(t, leadId)).toBe("signe");
  const hist = await t.run((ctx: any) =>
    ctx.db.query("leadStageHistory").withIndex("by_lead_changedAt", (q: any) => q.eq("leadId", leadId)).collect());
  expect(hist.some((h: any) => h.saasStatus === "signe")).toBe(true);
});

test("createForLead vente avec projectId fourni signe CE projet et crée le dossier délivrabilité", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  // Le front pré-crée le projet (status qualification) puis passe son id.
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "Pré-créé" });
  const before = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(before.status).toBe("qualification");

  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente", projectId, montantTotal: 12000,
  });

  const after = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(after.status).toBe("signe");
  // Le dossier délivrabilité (clients) doit exister pour ce projet.
  const dossier = await t.run((ctx: any) =>
    ctx.db.query("clients").withIndex("by_project", (q: any) => q.eq("projectId", projectId)).first());
  expect(dossier).not.toBeNull();
});

test("createForLead vente réutilise un projet ouvert existant (pas de doublon)", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const openId = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "Ouvert" });
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente",
  });
  const d = await t.run((ctx: any) => ctx.db.get(debriefId));
  expect(d.projectId).toBe(openId);
  const all = await asUser(t, comId).query(api.projects.listByLead, { leadId });
  expect(all).toHaveLength(1);
});

test("createForLead non_vente ne crée pas de projet et dérive le statut lead", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "non_vente", nonSaleReason: "pas_interesse",
  });
  expect(await leadStatus(t, leadId)).toBe("perdu");
  const projects = await asUser(t, comId).query(api.projects.listByLead, { leadId });
  expect(projects).toHaveLength(0);
});

test("createForLead avec rdvId ne touche pas le statut lead", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  const before = await leadStatus(t, leadId);
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "non_vente", nonSaleReason: "pas_interesse", rdvId,
  });
  expect(await leadStatus(t, leadId)).toBe(before);
});

test("create rattache à un projet existant et résout le leadId", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "P" });
  const debriefId = await asUser(t, comId).mutation(api.debriefs.create, {
    projectId, outcome: "vente",
  });
  const d = await t.run((ctx: any) => ctx.db.get(debriefId));
  expect(d.projectId).toBe(projectId);
  expect(d.leadId).toBe(leadId);
  expect(await leadStatus(t, leadId)).toBe("signe");
});

test("create rejette un projet introuvable", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "P" });
  await asUser(t, comId).mutation(api.projects.softDelete, { projectId });
  await expect(
    asUser(t, comId).mutation(api.debriefs.create, { projectId, outcome: "vente" }),
  ).rejects.toThrow(/introuvable/);
});

test("listByProject et listByLead filtrent les soft-deleted, ordre desc", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "P" });
  const d1 = await asUser(t, comId).mutation(api.debriefs.create, { projectId, outcome: "en_reflexion", reflexionReason: "autre" });
  const d2 = await asUser(t, comId).mutation(api.debriefs.create, { projectId, outcome: "vente" });
  await asUser(t, comId).mutation(api.debriefs.softDelete, { debriefId: d1 });
  const byProject = await asUser(t, comId).query(api.debriefs.listByProject, { projectId });
  expect(byProject).toHaveLength(1);
  expect(byProject[0]._id).toBe(d2);
  const byLead = await asUser(t, comId).query(api.debriefs.listByLead, { leadId });
  expect(byLead.map((d: any) => d._id)).toContain(d2);
});

test("update re-dérive le statut lead quand outcome change", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "en_reflexion", reflexionReason: "autre",
  });
  expect(await leadStatus(t, leadId)).toBe("a_rappeler");
  await asUser(t, comId).mutation(api.debriefs.update, {
    debriefId, outcome: "non_vente", nonSaleReason: "pas_interesse",
  });
  expect(await leadStatus(t, leadId)).toBe("perdu");
});

test("update vers vente provisionne projet signé + dossier délivrabilité", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  // Débrief initial en réflexion : aucun projet ni dossier.
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "en_reflexion", reflexionReason: "autre",
  });
  expect(await asUser(t, comId).query(api.projects.listByLead, { leadId })).toHaveLength(0);

  // Le commercial édite en vente : le projet et le dossier doivent apparaître.
  await asUser(t, comId).mutation(api.debriefs.update, {
    debriefId, outcome: "vente", montantTotal: 18000,
  });
  const d = await t.run((ctx: any) => ctx.db.get(debriefId));
  expect(d.projectId).toBeDefined();
  const project = await t.run((ctx: any) => ctx.db.get(d.projectId));
  expect(project.status).toBe("signe");
  const dossier = await t.run((ctx: any) =>
    ctx.db.query("clients").withIndex("by_project", (q: any) => q.eq("projectId", d.projectId)).first());
  expect(dossier).not.toBeNull();
  expect(await leadStatus(t, leadId)).toBe("signe");
});

test("createForLead refusé pour un setter (gating commercial)", async () => {
  const t = makeT();
  const { setterId, leadId } = await seed(t);
  await expect(
    asUser(t, setterId).mutation(api.debriefs.createForLead, { leadId, outcome: "vente" }),
  ).rejects.toThrow(/non autorisé/);
});

test("get renvoie le débrief ; softDelete le retire", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const debriefId = await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId, outcome: "vente",
  });
  expect((await asUser(t, comId).query(api.debriefs.get, { debriefId }))?._id).toBe(debriefId);
  await asUser(t, comId).mutation(api.debriefs.softDelete, { debriefId });
  expect(await asUser(t, comId).query(api.debriefs.get, { debriefId })).toBeNull();
});
