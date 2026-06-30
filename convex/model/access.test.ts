import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { asUser, insertUser } from "../test.helpers";
import { internal } from "../_generated/api";

// On expose les helpers via une internalQuery de test pour les exécuter dans un ctx Convex.
test("requireRole laisse passer un rôle autorisé", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const user = await asUser(t, adminId).query(internal.model["access.testfns"].whoamiAdmin, {});
  expect(user.role).toBe("admin");
});

test("requireRole bloque un rôle non autorisé", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  await expect(
    asUser(t, setterId).query(internal.model["access.testfns"].whoamiAdmin, {}),
  ).rejects.toThrow(/non autorisé/);
});

test("requireUser bloque un compte désactivé", async () => {
  const t = makeT();
  const offId = await insertUser(t, { role: "admin", active: false });
  await expect(
    asUser(t, offId).query(internal.model["access.testfns"].whoamiAdmin, {}),
  ).rejects.toThrow(/désactivé/);
});

test("assertCommercialRole laisse passer un commercial", async () => {
  const t = makeT();
  const id = await insertUser(t, { role: "commercial" });
  const r = await t.query(internal.model["access.testfns"].assertCommercialOk, { userId: id });
  expect(r.role).toBe("commercial");
});

test("assertCommercialRole rejette un setter", async () => {
  const t = makeT();
  const id = await insertUser(t, { role: "setter" });
  await expect(
    t.query(internal.model["access.testfns"].assertCommercialOk, { userId: id }),
  ).rejects.toThrow(/commercial/);
});
