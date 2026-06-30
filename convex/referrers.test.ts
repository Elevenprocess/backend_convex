import { expect, test } from "vitest";
import { makeT } from "./test";
import { api } from "./_generated/api";
import { asUser, insertUser } from "./testHelpers";

test("create + list referrers", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  await asUser(t, adminId).mutation(api.referrers.create, { nom: "Jean Parrain", phone: "0600000000" });
  const all = await asUser(t, adminId).query(api.referrers.list, {});
  expect(all).toHaveLength(1);
  expect(all[0].nom).toBe("Jean Parrain");
  expect(all[0].active).toBe(true);
});

test("list activeOnly filtre les inactifs", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  await asUser(t, adminId).mutation(api.referrers.create, { nom: "Actif" });
  // insérer un referrer inactif directement via t.run
  await t.run(async (ctx) => {
    await ctx.db.insert("referrers", { nom: "Inactif", active: false });
  });
  const activeOnly = await asUser(t, adminId).query(api.referrers.list, { activeOnly: true });
  expect(activeOnly).toHaveLength(1);
  expect(activeOnly[0].nom).toBe("Actif");
});

test("create refusé pour un rôle non autorisé", async () => {
  const t = makeT();
  // aucun rôle connu — on crée manuellement un user avec un rôle fictif
  const noRoleId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "x@ecoi.fr", name: "X", role: "setter" as any, active: true }),
  );
  // on force un rôle non listé (ex. gestionnaire) en patchant directement
  await t.run(async (ctx) => {
    await ctx.db.patch(noRoleId, { role: "gestionnaire" as any });
  });
  await expect(
    asUser(t, noRoleId).mutation(api.referrers.create, { nom: "Blocked" }),
  ).rejects.toThrow(/non autorisé/);
});
