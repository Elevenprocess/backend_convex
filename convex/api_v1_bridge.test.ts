import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";
import { REGISTRY, SERVICE_EMAIL } from "./apiV1/bridge";

const SRC = "Clé API : Hermes";

test("le registre n'expose que les query/mutation publiques des modules métier", () => {
  expect(REGISTRY["leads.list"]?.isQuery).toBe(true);
  expect(REGISTRY["leads.create"]?.isMutation).toBe(true);
  expect(REGISTRY["rdv.create"]?.isMutation).toBe(true);
  expect(REGISTRY["analytics.summary"]?.isQuery).toBe(true);
  // Internes / actions / autres modules : absents.
  expect(REGISTRY["apiTokens.authenticate"]).toBeUndefined();
  expect(REGISTRY["hermes.kpis"]).toBeUndefined();
  expect(Object.keys(REGISTRY).length).toBeGreaterThan(80);
});

test("compte de service créé une fois, admin, isService ; masqué de users.list", async () => {
  const t = makeT();
  const id1 = await t.mutation(internal.apiV1.bridge.ensureServiceUser, {});
  const id2 = await t.mutation(internal.apiV1.bridge.ensureServiceUser, {});
  expect(id1).toBe(id2);
  const svc = await t.run(async (ctx: any) => ctx.db.get(id1));
  expect(svc.email).toBe(SERVICE_EMAIL);
  expect(svc.role).toBe("admin");
  expect(svc.isService).toBe(true);
});

test("invokeMutation exécute la fonction métier avec l'acteur de service et trace « via clé »", async () => {
  const t = makeT();
  const serviceUserId = await t.mutation(internal.apiV1.bridge.ensureServiceUser, {});
  const actor = { source: SRC, serviceUserId };

  const leadId = await t.mutation(internal.apiV1.bridge.invokeMutation, {
    fn: "leads.create", args: { firstName: "Léa", lastName: "Martin", city: "Pau" }, actor,
  });
  const lead = await t.run(async (ctx: any) => ctx.db.get(leadId));
  expect(lead.firstName).toBe("Léa");
  expect(lead.setterId).toBe(serviceUserId);

  const rows = await t.run(async (ctx: any) => ctx.db.query("activityLog").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].actorName).toBe(`Agent API (via ${SRC})`);
  expect(rows[0].actorId).toBe(serviceUserId);
  expect(rows[0].action).toBe("lead.created");

  // Lecture via invokeQuery : leads.get voit le lead (admin).
  const got = await t.query(internal.apiV1.bridge.invokeQuery, { fn: "leads.get", args: { leadId }, actor });
  expect((got as any)._id).toBe(leadId);

  // Arguments validés contre le validateur Convex de la fonction : message lisible.
  await expect(
    t.query(internal.apiV1.bridge.invokeQuery, { fn: "leads.get", args: { id: leadId }, actor }),
  ).rejects.toThrow(/Paramètre `id` : champ inconnu|Paramètre `leadId` : requis/);
  await expect(
    t.mutation(internal.apiV1.bridge.invokeMutation, { fn: "leads.create", args: { firstName: 12 }, actor }),
  ).rejects.toThrow(/Paramètre `firstName` : doit être une chaîne/);
});

test("X-Acting-As : droits et attribution de l'utilisateur emprunté", async () => {
  const t = makeT();
  const serviceUserId = await t.mutation(internal.apiV1.bridge.ensureServiceUser, {});
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr", name: "Sam Setter" });
  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr", name: "Tec" });

  const leadId = await t.mutation(internal.apiV1.bridge.invokeMutation, {
    fn: "leads.create", args: { firstName: "Bob" }, actor: { source: SRC, serviceUserId, actingAsUserId: setterId },
  });
  const lead = await t.run(async (ctx: any) => ctx.db.get(leadId));
  expect(lead.setterId).toBe(setterId);
  const rows = await t.run(async (ctx: any) => ctx.db.query("activityLog").collect());
  expect(rows[0].actorName).toBe(`Sam Setter (via ${SRC})`);

  await expect(
    t.mutation(internal.apiV1.bridge.invokeMutation, {
      fn: "leads.create", args: { firstName: "X" }, actor: { source: SRC, serviceUserId, actingAsUserId: techId },
    }),
  ).rejects.toThrow(/Accès refusé/);

  await expect(
    t.mutation(internal.apiV1.bridge.invokeMutation, {
      fn: "leads.create", args: {}, actor: { source: SRC, serviceUserId, actingAsUserId: serviceUserId },
    }),
  ).rejects.toThrow(/compte de service/);

  await expect(
    t.mutation(internal.apiV1.bridge.invokeMutation, { fn: "apiTokens.create", args: {}, actor: { source: SRC, serviceUserId } }),
  ).rejects.toThrow(/non exposée/);
  await expect(
    t.query(internal.apiV1.bridge.invokeQuery, { fn: "leads.create", args: {}, actor: { source: SRC, serviceUserId } }),
  ).rejects.toThrow(/non exposée/);
});
