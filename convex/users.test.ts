import { expect, test } from "vitest";
import { makeT } from "./test";
import { api } from "./_generated/api";
import { asUser, insertUser } from "./testHelpers";

test("me() renvoie le profil courant", async () => {
  const t = makeT();
  const id = await insertUser(t, { name: "Alice", role: "setter" });
  const me = await asUser(t, id).query(api.users.me, {});
  expect(me?.name).toBe("Alice");
});

test("create() crée un user (admin) avec rôle défaut setter", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const newId = await asUser(t, adminId).mutation(api.users.create, {
    email: "bob@ecoi.fr",
    name: "Bob",
  });
  const bob = await t.run((ctx) => ctx.db.get(newId));
  expect(bob?.role).toBe("setter");
  expect(bob?.createdById).toBe(adminId);
});

test("create() refusé pour un non-admin", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  await expect(
    asUser(t, setterId).mutation(api.users.create, { email: "x@ecoi.fr", name: "X" }),
  ).rejects.toThrow(/non autorisé/);
});

test("updateRole() promeut un user", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const targetId = await insertUser(t, { role: "setter" });
  await asUser(t, adminId).mutation(api.users.updateRole, { userId: targetId, role: "commercial" });
  const target = await t.run((ctx) => ctx.db.get(targetId));
  expect(target?.role).toBe("commercial");
});

test("list() filtre par rôle", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  await insertUser(t, { role: "setter", email: "s1@ecoi.fr" });
  await insertUser(t, { role: "setter", email: "s2@ecoi.fr" });
  const setters = await asUser(t, adminId).query(api.users.list, { role: "setter" });
  expect(setters).toHaveLength(2);
});

test("toggleActive() désactive un user (admin)", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const targetId = await insertUser(t, { role: "setter", email: "target@ecoi.fr" });
  await asUser(t, adminId).mutation(api.users.toggleActive, { userId: targetId, active: false });
  const target = await t.run((ctx) => ctx.db.get(targetId));
  expect(target?.active).toBe(false);
});

test("toggleActive() refusé pour un non-admin", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const targetId = await insertUser(t, { role: "setter", email: "target2@ecoi.fr" });
  await expect(
    asUser(t, setterId).mutation(api.users.toggleActive, { userId: targetId, active: false }),
  ).rejects.toThrow(/non autorisé/);
});

test("heartbeat() met à jour lastSeenAt", async () => {
  const t = makeT();
  const id = await insertUser(t, { role: "setter" });
  await asUser(t, id).mutation(api.users.heartbeat, {});
  const u = await t.run((ctx) => ctx.db.get(id));
  expect(u?.lastSeenAt).toBeGreaterThan(0);
});
