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
