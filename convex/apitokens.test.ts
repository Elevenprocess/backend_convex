import { afterEach, expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const NOW = Date.UTC(2026, 7, 17, 12, 0);

afterEach(() => {
  delete process.env.HERMES_API_KEY;
});

test("un admin crée un token, il ouvre la surface Hermes, la révocation le ferme", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin", email: "a@e.fr", name: "Admin" });
  const admin = asUser(t, adminId);

  const { id, secret } = await admin.mutation(api.apiTokens.create, { name: "n8n" });
  expect(secret.startsWith("vlr_")).toBe(true);
  expect(secret.length).toBeGreaterThan(30);

  const rows = await admin.query(api.apiTokens.list, {});
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("n8n");
  expect(rows[0].revokedAt).toBeNull();
  // Le secret n'apparaît jamais dans la liste, seulement le préfixe.
  expect(JSON.stringify(rows)).not.toContain(secret);
  expect(rows[0].prefix).toBe(secret.slice(0, 12));

  // Sans HERMES_API_KEY d'env : le token DB suffit.
  const out = await t.query(api.hermes.kpis, { apiKey: secret, now: NOW, days: 30 });
  expect(out.engine).toBe("hermes-service");
  await expect(t.query(api.hermes.kpis, { apiKey: "vlr_faux", now: NOW })).rejects.toThrow(/HERMES_API_KEY non configuré/);

  await admin.mutation(api.apiTokens.revoke, { id });
  await expect(t.query(api.hermes.kpis, { apiKey: secret, now: NOW })).rejects.toThrow();
  const after = await admin.query(api.apiTokens.list, {});
  expect(after[0].revokedAt).not.toBeNull();
});

test("les non-admins ne peuvent ni lister ni créer de tokens", async () => {
  const t = makeT();
  const uid = await insertUser(t, { role: "commercial_lead", email: "c@e.fr", name: "Chef" });
  const u = asUser(t, uid);
  await expect(u.mutation(api.apiTokens.create, { name: "x" })).rejects.toThrow(/Accès refusé/);
  await expect(u.query(api.apiTokens.list, {})).rejects.toThrow(/Accès refusé/);
});
