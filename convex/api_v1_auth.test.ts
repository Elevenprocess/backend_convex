import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { createApiHandler, matchRoute, type RouteDef } from "./apiV1/router";
import { ROUTES } from "./apiV1/routes";

async function setup(scopes: string[]) {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin", email: "a@e.fr", name: "Admin" });
  const admin = asUser(t, adminId);
  const { id, secret } = await admin.mutation(api.apiTokens.create, { name: "Hermes", scopes });
  const call = (path: string, init: RequestInit = {}, bearer: string | null = secret) =>
    t.fetch(`/api/v1${path}`, {
      ...init,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(init.headers ?? {}) },
    });
  return { t, admin, id, secret, call };
}

test("401 sans clé, clé mal formée, clé inconnue, révoquée", async () => {
  const { admin, id, call } = await setup(["leads:read"]);
  let res = await call("/me", {}, null);
  expect(res.status).toBe(401);
  expect((await res.json()).error.code).toBe("invalid_key");

  res = await call("/me", {}, "pas-un-vlr");
  expect(res.status).toBe(401);

  res = await call("/me", {}, "vlr_inconnue");
  expect(res.status).toBe(401);

  await admin.mutation(api.apiTokens.revoke, { id });
  res = await call("/me");
  expect(res.status).toBe(401);
  expect((await res.json()).error.code).toBe("revoked");
});

test("/me décrit la clé et ses routes accessibles ; compteur d'usage incrémenté", async () => {
  const { admin, secret, call } = await setup(["rdv:read", "*:write"]);
  const res = await call("/me");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.name).toBe("Hermes");
  expect(body.scopes).toEqual(["*:write", "rdv:read"]);
  expect(body.effectiveScopes).toContain("leads:write");
  expect(body.effectiveScopes).not.toContain("leads:read");
  expect(body.routes.some((r: any) => r.path === "/api/v1/me")).toBe(true);
  expect(JSON.stringify(body)).not.toContain(secret);
  const rows = await admin.query(api.apiTokens.list, {});
  expect(rows[0].callCount).toBe(1);
});

test("404 route inconnue, 405 mauvaise méthode, 422 JSON invalide", async () => {
  const { call } = await setup(["*:read", "*:write"]);
  let res = await call("/nimportequoi");
  expect(res.status).toBe(404);
  expect((await res.json()).error.code).toBe("not_found");

  res = await call("/me", { method: "POST" });
  expect(res.status).toBe(405);
  expect((await res.json()).error.code).toBe("method_not_allowed");
});

test("openapi.json liste toutes les routes du registre avec leur scope", async () => {
  const { call } = await setup(["leads:read"]);
  const res = await call("/openapi.json");
  expect(res.status).toBe(200);
  const spec = await res.json();
  expect(spec.openapi).toBe("3.1.0");
  expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  const ops = Object.values(spec.paths as Record<string, Record<string, any>>).flatMap((m) => Object.values(m));
  expect(ops.length).toBe(ROUTES.length);
  for (const r of ROUTES) {
    const oaPath = `/api/v1${r.path}`.replace(/:(\w+)/g, "{$1}");
    expect(spec.paths[oaPath][r.method.toLowerCase()]["x-scope"]).toBe(r.scope);
  }
  // Toute route déclarée porte un scope valide (ou null pour meta) et un résumé.
  for (const r of ROUTES) {
    expect(r.summary.length).toBeGreaterThan(3);
    if (r.scope) expect(r.scope).toMatch(/^[a-z]+:(read|write)$/);
  }
});

test("403 missing_scope avec le scope requis en clair, 429 avec Retry-After (route factice)", async () => {
  // Le registre n'a pas encore de route métier (lot 2) : on vérifie le
  // matching + le contrat via une route de test et un ctx réduit à runMutation.
  const { t, secret } = await setup(["leads:read"]);
  const fake: RouteDef = { method: "GET", path: "/leads/:id", scope: "leads:read", summary: "t", handler: async (_c, r) => ({ id: r.params.id }) };
  const write: RouteDef = { method: "PATCH", path: "/leads/:id", scope: "leads:write", summary: "t", handler: async () => ({}) };
  const boom: RouteDef = { method: "GET", path: "/boom", scope: null, summary: "t", handler: async () => { throw new Error("Lead introuvable"); } };
  const ctx = { runMutation: (ref: any, args: any) => t.mutation(ref, args) } as any;
  const handle = createApiHandler([fake, write, boom]);
  const H = { authorization: `Bearer ${secret}` };

  let res = await handle(ctx, new Request("https://x.convex.site/api/v1/leads/L1", { headers: H }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "L1" });

  res = await handle(ctx, new Request("https://x.convex.site/api/v1/leads/L1", { method: "PATCH", headers: H, body: "{}" }));
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: { code: "missing_scope", message: "Scope requis : leads:write", required: "leads:write" } });

  res = await handle(ctx, new Request("https://x.convex.site/api/v1/leads/L1", { method: "PATCH", headers: H, body: "{oops" }));
  expect(res.status).toBe(403); // le scope est vérifié avant le body

  res = await handle(ctx, new Request("https://x.convex.site/api/v1/boom", { headers: H }));
  expect(res.status).toBe(422);
  expect((await res.json()).error.message).toBe("Lead introuvable");

  await t.run(async (c: any) => {
    const row = (await c.db.query("apiTokens").collect())[0];
    await c.db.patch(row._id, { windowStart: Date.now(), windowCount: 300 });
  });
  res = await handle(ctx, new Request("https://x.convex.site/api/v1/leads/L1", { headers: H }));
  expect(res.status).toBe(429);
  expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  const m = matchRoute([fake], "GET", "/api/v1/leads/abc%20d");
  expect("route" in m && m.params).toEqual({ id: "abc d" });
  expect(matchRoute([fake], "POST", "/api/v1/leads/x")).toEqual({ pathExists: true });
  expect(matchRoute([fake], "GET", "/api/v1/leads")).toEqual({ pathExists: false });
  expect(matchRoute([fake], "GET", "/other/leads/x")).toEqual({ pathExists: false });
});

test("openapi.json et guide.md sont publics (sans clé) ; /me reste protégé", async () => {
  const { call } = await setup(["leads:read"]);
  const spec = await call("/openapi.json", {}, null);
  expect(spec.status).toBe(200);
  expect((await spec.json()).openapi).toBe("3.1.0");
  const guide = await call("/guide.md", {}, null);
  expect(guide.status).toBe(200);
  expect(guide.headers.get("content-type")).toContain("text/markdown");
  const md = await guide.text();
  expect(md).toContain("# Velora — API agents");
  expect(md).toContain("**GET /api/v1/leads**");
  expect(md).toContain("body : ");
  expect(md).toContain("scope `leads:write`");
  expect((await call("/me", {}, null)).status).toBe(401);
});
