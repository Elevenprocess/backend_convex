import { expect, test } from "vitest";
import { makeT } from "../test";
import { asUser, insertUser } from "../testHelpers";
import { internal } from "../_generated/api";

// On expose les helpers via une internalQuery de test pour les exécuter dans un ctx Convex.
test("requireRole laisse passer un rôle autorisé", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const user = await asUser(t, adminId).query(internal.model.accessTest.whoamiAdmin, {});
  expect(user.role).toBe("admin");
});

test("requireRole bloque un rôle non autorisé", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  await expect(
    asUser(t, setterId).query(internal.model.accessTest.whoamiAdmin, {}),
  ).rejects.toThrow(/non autorisé/);
});

test("requireUser bloque un compte désactivé", async () => {
  const t = makeT();
  const offId = await insertUser(t, { role: "admin", active: false });
  await expect(
    asUser(t, offId).query(internal.model.accessTest.whoamiAdmin, {}),
  ).rejects.toThrow(/désactivé/);
});
