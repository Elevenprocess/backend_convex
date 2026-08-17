import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { hashToken } from "./model/apiTokenCrypto";
import { ALL_SCOPES, expandScopes, hasScope, normalizeScopes } from "./model/apiScopes";
import { RATE_LIMIT_PER_MINUTE } from "./apiTokens";

const NOW = Date.UTC(2026, 7, 17, 12, 0);

async function adminT() {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin", email: "a@e.fr", name: "Admin" });
  return { t, admin: asUser(t, adminId), adminId };
}

test("scopes : validation, presets, write n'implique pas read", () => {
  expect(ALL_SCOPES).toContain("leads:read");
  expect(ALL_SCOPES).toContain("calendar:write");
  expect(ALL_SCOPES.length).toBe(32);
  expect(normalizeScopes(["rdv:write", "leads:read", "leads:read", " "])).toEqual(["leads:read", "rdv:write"]);
  expect(() => normalizeScopes(["apikeys:write"])).toThrow(/Scope inconnu/);
  expect(() => normalizeScopes(["leads:admin"])).toThrow(/Scope inconnu/);
  expect(hasScope(["leads:write"], "leads:read")).toBe(false);
  expect(hasScope(["*:read"], "payments:read")).toBe(true);
  expect(hasScope(["*:read"], "payments:write")).toBe(false);
  expect(expandScopes(["*:write", "leads:read"])).toContain("ads:write");
  expect(expandScopes(["*:write", "leads:read"])).toContain("leads:read");
});

test("un admin crée une clé scopée ; le secret n'est visible qu'une fois", async () => {
  const { t, admin } = await adminT();
  const { id, secret, scopes } = await admin.mutation(api.apiTokens.create, {
    name: "Agent Hermes",
    scopes: ["leads:read", "rdv:read", "rdv:write"],
  });
  expect(secret.startsWith("vlr_")).toBe(true);
  expect(scopes).toEqual(["leads:read", "rdv:read", "rdv:write"]);

  const rows = await admin.query(api.apiTokens.list, {});
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(id);
  expect(rows[0].prefix).toBe(secret.slice(0, 12));
  expect(JSON.stringify(rows)).not.toContain(secret);
  expect(rows[0].callCount).toBe(0);

  const auth = await t.mutation(internal.apiTokens.authenticate, { tokenHash: hashToken(secret), now: NOW });
  expect(auth.ok).toBe(true);
  if (auth.ok) expect(auth.token.scopes).toEqual(["leads:read", "rdv:read", "rdv:write"]);
  const after = await admin.query(api.apiTokens.list, {});
  expect(after[0].callCount).toBe(1);
  expect(after[0].lastUsedAt).toBe(NOW);
});

test("règles de création : nom, scopes, expiration, admin only", async () => {
  const { t, admin } = await adminT();
  await expect(admin.mutation(api.apiTokens.create, { name: " ", scopes: ["leads:read"] })).rejects.toThrow(/Nom/);
  await expect(admin.mutation(api.apiTokens.create, { name: "x", scopes: [] })).rejects.toThrow(/au moins un scope/);
  await expect(admin.mutation(api.apiTokens.create, { name: "x", scopes: ["foo:read"] })).rejects.toThrow(/Scope inconnu/);
  await expect(
    admin.mutation(api.apiTokens.create, { name: "x", scopes: ["leads:read"], expiresAt: Date.now() - 1000 }),
  ).rejects.toThrow(/futur/);

  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr", name: "Setter" });
  await expect(
    asUser(t, setterId).mutation(api.apiTokens.create, { name: "x", scopes: ["leads:read"] }),
  ).rejects.toThrow(/Accès refusé/);
  await expect(asUser(t, setterId).query(api.apiTokens.list, {})).rejects.toThrow(/Accès refusé/);
});

test("révocation, expiration, mise à jour des scopes", async () => {
  const { t, admin } = await adminT();
  const { id, secret } = await admin.mutation(api.apiTokens.create, {
    name: "k", scopes: ["leads:read"], expiresAt: NOW + 60_000,
  });
  const h = hashToken(secret);

  await admin.mutation(api.apiTokens.updateScopes, { id, scopes: ["*:read"] });
  let auth = await t.mutation(internal.apiTokens.authenticate, { tokenHash: h, now: NOW });
  expect(auth.ok && auth.token.scopes).toEqual(["*:read"]);

  auth = await t.mutation(internal.apiTokens.authenticate, { tokenHash: h, now: NOW + 60_000 });
  expect(auth).toEqual({ ok: false, code: "expired" });

  await admin.mutation(api.apiTokens.revoke, { id });
  auth = await t.mutation(internal.apiTokens.authenticate, { tokenHash: h, now: NOW });
  expect(auth).toEqual({ ok: false, code: "revoked" });
  await expect(admin.mutation(api.apiTokens.updateScopes, { id, scopes: ["leads:read"] })).rejects.toThrow(/révoquée/);

  const unknown = await t.mutation(internal.apiTokens.authenticate, { tokenHash: hashToken("vlr_nope"), now: NOW });
  expect(unknown).toEqual({ ok: false, code: "invalid_key" });
});

test("rate limit : 300 appels/minute par clé, puis 429 jusqu'à la fenêtre suivante", async () => {
  const { t, admin } = await adminT();
  const { secret } = await admin.mutation(api.apiTokens.create, { name: "k", scopes: ["leads:read"] });
  const h = hashToken(secret);
  await t.run(async (ctx: any) => {
    const row = await ctx.db.query("apiTokens").withIndex("by_tokenHash", (q: any) => q.eq("tokenHash", h)).unique();
    await ctx.db.patch(row._id, { windowStart: NOW, windowCount: RATE_LIMIT_PER_MINUTE - 1 });
  });
  expect((await t.mutation(internal.apiTokens.authenticate, { tokenHash: h, now: NOW + 1000 })).ok).toBe(true);
  const limited = await t.mutation(internal.apiTokens.authenticate, { tokenHash: h, now: NOW + 2000 });
  expect(limited.ok).toBe(false);
  if (!limited.ok) {
    expect(limited.code).toBe("rate_limited");
    expect(limited.retryAfterMs).toBe(58_000);
  }
  expect((await t.mutation(internal.apiTokens.authenticate, { tokenHash: h, now: NOW + 61_000 })).ok).toBe(true);
});
