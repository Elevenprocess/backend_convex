import { expect, test } from "vitest";
import { makeT } from "./test.kit";
import { api } from "./_generated/api";
import { asUser, insertUser } from "./test.helpers";

// Mode « Explorer un profil » (Settings) : overlay serveur users.viewAsUserId,
// appliqué au centre par getCurrentUser — cf. model/access.ts.

test("admin setViewAs commercial → me() renvoie le commercial, sessionContext expose les deux", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { name: "Admin", role: "admin" });
  const comId = await insertUser(t, { name: "Gérald", role: "commercial" });
  await asUser(t, adminId).mutation(api.users.setViewAs, { userId: comId });

  const me = await asUser(t, adminId).query(api.users.me, {});
  expect(me?.name).toBe("Gérald");

  const sc = await asUser(t, adminId).query(api.users.sessionContext, {});
  expect(sc?.real.name).toBe("Admin");
  expect(sc?.viewAs?.name).toBe("Gérald");

  await asUser(t, adminId).mutation(api.users.clearViewAs, {});
  const after = await asUser(t, adminId).query(api.users.me, {});
  expect(after?.name).toBe("Admin");
});

test("setViewAs refusé pour une paire non autorisée (setter → admin)", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { name: "Eric", role: "setter" });
  const adminId = await insertUser(t, { name: "Admin", role: "admin" });
  await expect(
    asUser(t, setterId).mutation(api.users.setViewAs, { userId: adminId }),
  ).rejects.toThrow(/non autorisée/);
});

test("commercial_lead → commercial : lecture OK, mutation bloquée (lecture seule)", async () => {
  const t = makeT();
  const leadId = await insertUser(t, { name: "Lead", role: "commercial_lead" });
  const comId = await insertUser(t, { name: "Gérald", role: "commercial" });
  await asUser(t, leadId).mutation(api.users.setViewAs, { userId: comId });

  const me = await asUser(t, leadId).query(api.users.me, {});
  expect(me?.name).toBe("Gérald");

  // Une mutation quelconque passant par requireUser doit être refusée.
  await expect(
    asUser(t, leadId).mutation(api.users.heartbeat, {}),
  ).rejects.toThrow(/Lecture seule/);

  // clearViewAs reste possible (il agit sur le user réel, pas l'overlay).
  await asUser(t, leadId).mutation(api.users.clearViewAs, {});
  const after = await asUser(t, leadId).query(api.users.me, {});
  expect(after?.name).toBe("Lead");
});

test("cible supprimée → overlay ignoré, on retombe sur le user réel", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { name: "Admin", role: "admin" });
  const comId = await insertUser(t, { name: "Gérald", role: "commercial" });
  await asUser(t, adminId).mutation(api.users.setViewAs, { userId: comId });
  await t.run(async (ctx) => ctx.db.patch(comId, { deletedAt: Date.now() }));
  const me = await asUser(t, adminId).query(api.users.me, {});
  expect(me?.name).toBe("Admin");
});
