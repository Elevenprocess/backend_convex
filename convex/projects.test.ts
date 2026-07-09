import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seed(t: any) {
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, {
    firstName: "Jean", lastName: "Dupont", city: "Lyon",
  });
  return { comId, setterId, leadId };
}

test("create hérite du nom/adresse du lead et pose qualification", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId });
  const p = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(p.status).toBe("qualification");
  expect(p.name).toBe("Projet Jean Dupont");
  expect(p.city).toBe("Lyon");
  expect(p.commercialId).toBe(comId);
});

test("create refusé pour un setter (gating commercial)", async () => {
  const t = makeT();
  const { setterId, leadId } = await seed(t);
  await expect(
    asUser(t, setterId).mutation(api.projects.create, { leadId }),
  ).rejects.toThrow(/non autorisé/);
});

test("listByLead exclut les projets soft-deleted, ordre desc", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const a = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "A" });
  const b = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "B" });
  await asUser(t, comId).mutation(api.projects.softDelete, { projectId: a });
  const list = await asUser(t, comId).query(api.projects.listByLead, { leadId });
  expect(list).toHaveLength(1);
  expect(list[0]._id).toBe(b);
});

test("update patche le statut", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId });
  await asUser(t, comId).mutation(api.projects.update, { projectId, status: "signe", notes: "ok" });
  const p = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(p.status).toBe("signe");
  expect(p.notes).toBe("ok");
});

test("get renvoie le projet ; softDelete le retire de get", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const projectId = await asUser(t, comId).mutation(api.projects.create, { leadId });
  expect((await asUser(t, comId).query(api.projects.get, { projectId }))?._id).toBe(projectId);
  await asUser(t, comId).mutation(api.projects.softDelete, { projectId });
  expect(await asUser(t, comId).query(api.projects.get, { projectId })).toBeNull();
});

test("ficheByLead agrège projets + débriefs + devis + pièces en une query", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const pA = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "A" });
  const pB = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "B" });
  await asUser(t, comId).mutation(api.debriefs.create, { projectId: pA, outcome: "vente" });
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["%PDF-1.4"])));
  await t.run((ctx: any) =>
    ctx.db.insert("devis", {
      leadId, projectId: pA, commercialId: comId, status: "brouillon", ocrStatus: "pending",
      storageId, filename: "devis.pdf", sizeBytes: 8, lignes: [], echeancier: [], extracted: {},
    }));
  await t.run((ctx: any) =>
    ctx.db.insert("projectAttachments", {
      projectId: pB, kind: "photo", filename: "toit.jpg", contentType: "image/jpeg", sizeBytes: 4,
    }));

  const fiche = await asUser(t, comId).query(api.projects.ficheByLead, { leadId });
  expect(fiche.map((f: any) => f.project._id)).toEqual([pB, pA]); // desc
  const a = fiche.find((f: any) => f.project._id === pA);
  const b = fiche.find((f: any) => f.project._id === pB);
  expect(a.debriefs).toHaveLength(1);
  expect(a.devis).toHaveLength(1);
  expect(a.devis[0].projectId).toBe(pA);
  expect(a.attachments).toHaveLength(0);
  expect(b.attachments).toHaveLength(1);
  expect(b.attachments[0].filename).toBe("toit.jpg");
  expect(b.debriefs).toHaveLength(0);
});

test("ficheByLead exclut les projets soft-deleted", async () => {
  const t = makeT();
  const { comId, leadId } = await seed(t);
  const pA = await asUser(t, comId).mutation(api.projects.create, { leadId, name: "A" });
  await asUser(t, comId).mutation(api.projects.softDelete, { projectId: pA });
  expect(await asUser(t, comId).query(api.projects.ficheByLead, { leadId })).toHaveLength(0);
});
