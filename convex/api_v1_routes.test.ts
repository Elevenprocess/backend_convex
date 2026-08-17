import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { ROUTES } from "./apiV1/routes";
import { REGISTRY } from "./apiV1/bridge";
import { topLevelFields } from "./apiV1/validate";

async function setup(scopes: string[]) {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin", email: "a@e.fr", name: "Admin" });
  const admin = asUser(t, adminId);
  const { secret } = await admin.mutation(api.apiTokens.create, { name: "Hermes", scopes });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await t.fetch(`/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  return { t, admin, adminId, call };
}

test("registre : chemins uniques par méthode, statiques avant paramétrés, fonctions valides", () => {
  const seen = new Set<string>();
  for (const r of ROUTES) {
    const key = `${r.method} ${r.path}`;
    expect(seen.has(key), `doublon ${key}`).toBe(false);
    seen.add(key);
    if (r.fn) expect(REGISTRY[r.fn], `fonction ${r.fn}`).toBeTruthy();
    // Un paramètre de chemin doit exister dans les args de la fonction.
    if (r.fn) {
      const fields = topLevelFields(REGISTRY[r.fn].exportArgs!());
      for (const m of r.path.matchAll(/:(\w+)/g)) expect(fields[m[1]], `${key} : param ${m[1]} inconnu de ${r.fn}`).toBeTruthy();
    }
    // Cohérence scope ↔ nature : une mutation exige :write, une query :read.
    if (r.fn && r.scope) {
      const kind = REGISTRY[r.fn].isMutation ? "write" : "read";
      expect(r.scope.endsWith(`:${kind}`), `${key} → ${r.fn} devrait être ${kind}`).toBe(true);
    }
  }
  // Statique avant paramétré : "/leads/stats" apparaît avant "/leads/:leadId" en GET.
  const idx = (p: string) => ROUTES.findIndex((r) => r.method === "GET" && r.path === p);
  expect(idx("/leads/stats")).toBeLessThan(idx("/leads/:leadId"));
  expect(idx("/rdv/signatures")).toBeLessThan(idx("/rdv/:rdvId"));
  expect(idx("/users/directory")).toBeLessThan(idx("/users/:userId"));
  expect(ROUTES.length).toBeGreaterThan(90);
});

test("toutes les routes GET sans paramètre obligatoire répondent 200 avec une clé *:read", async () => {
  const { call } = await setup(["*:read"]);
  const failures: string[] = [];
  for (const r of ROUTES) {
    if (r.method !== "GET" || r.path.includes(":") || !r.fn) continue;
    const fields = topLevelFields(REGISTRY[r.fn].exportArgs!());
    const required = Object.entries(fields).filter(([k, f]) => !f.optional && !["now", "today", "todayStart", "paginationOpts"].includes(k));
    if (required.length) continue; // ex. ads.report (from/to), objectives (period)
    const { status, json } = await call("GET", r.path);
    if (status !== 200) failures.push(`${r.path} → ${status} ${JSON.stringify(json).slice(0, 120)}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});

test("prospects : créer, lister (pagination), lire, changer le statut, journal d'activité au nom de la clé", async () => {
  const { t, call } = await setup(["leads:read", "leads:write", "activity:read"]);
  const c1 = await call("POST", "/leads", { firstName: "Léa", lastName: "Martin", city: "Pau" });
  expect(c1.status).toBe(200);
  const leadId = c1.json as string;
  await call("POST", "/leads", { firstName: "Bob", lastName: "Durand" });

  const list = await call("GET", "/leads?limit=1");
  expect(list.status).toBe(200);
  expect(list.json.items).toHaveLength(1);
  expect(list.json.nextCursor).toBeTypeOf("string");
  const page2 = await call("GET", `/leads?limit=1&cursor=${encodeURIComponent(list.json.nextCursor)}`);
  expect(page2.json.items).toHaveLength(1);
  expect(page2.json.items[0]._id).not.toBe(list.json.items[0]._id);

  const one = await call("GET", `/leads/${leadId}`);
  expect(one.json.firstName).toBe("Léa");

  const st = await call("POST", `/leads/${leadId}/status`, { status: "qualifie" });
  expect(st.status).toBe(200);
  expect((await call("GET", `/leads/${leadId}`)).json.status).toBe("qualifie");

  const bad = await call("POST", `/leads/${leadId}/status`, { status: "nimporte" });
  expect(bad.status).toBe(422);
  expect(bad.json.error.message).toMatch(/Paramètre `status`/);

  const act = await call("GET", `/leads/${leadId}/activity`);
  expect(act.status).toBe(200);
  expect(JSON.stringify(act.json)).toContain("Agent API (via Clé API : Hermes)");

  const enriched = await call("GET", "/leads/enriched?limit=5"); // now injecté
  expect(enriched.status).toBe(200);
  expect(enriched.json.items.length).toBe(2);
  const stats = await call("GET", "/leads/stats"); // todayStart injecté
  expect(stats.status).toBe(200);
  void t;
});

test("appels + X-Acting-As : l'appel est attribué au setter emprunté ; scope manquant → 403", async () => {
  const { t, call } = await setup(["leads:write", "calls:read", "calls:write"]);
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr", name: "Sam" });
  const leadId = (await call("POST", "/leads", { firstName: "Zoé" })).json as string;

  const logged = await call("POST", `/leads/${leadId}/calls`, { result: "rappel_planifie", nextCallbackAt: Date.now() + 3600_000 }, { "x-acting-as": setterId });
  expect(logged.status).toBe(200);
  const calls = await call("GET", `/leads/${leadId}/calls`);
  expect(calls.json).toHaveLength(1);
  expect(calls.json[0].setterId).toBe(setterId);

  const cb = await call("GET", "/calls/upcoming-callbacks");
  expect(cb.status).toBe(200);

  const denied = await call("GET", `/leads/${leadId}`); // pas de leads:read
  expect(denied.status).toBe(403);
  expect(denied.json.error.required).toBe("leads:read");

  const ghost = await call("GET", `/leads/${leadId}/calls`, undefined, { "x-acting-as": "users:inexistant" });
  expect(ghost.status).toBe(422);
  expect(ghost.json.error.message).toMatch(/X-Acting-As/);
});

test("RDV + analytics + paiements : coercion des query params, `now`/`today` injectés", async () => {
  const { t, call } = await setup(["*:read", "*:write"]);
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com" });
  const leadId = (await call("POST", "/leads", { firstName: "Ana" })).json as string;
  const when = Date.UTC(2026, 7, 20, 9, 0);
  const created = await call("POST", "/rdv", { leadId, commercialId: comId, scheduledAt: when, locationType: "domicile" });
  expect(created.status).toBe(200);

  const inRange = await call("GET", `/rdv?from=${when - 1000}&to=${when + 1000}&limit=10`);
  expect(inRange.status).toBe(200);
  expect(inRange.json.items).toHaveLength(1);
  const outRange = await call("GET", `/rdv?from=${when + 1000}`);
  expect(outRange.json.items).toHaveLength(0);
  const badLimit = await call("GET", "/rdv?limit=abc");
  expect(badLimit.status).toBe(422);

  const byLead = await call("GET", `/leads/${leadId}/rdv`);
  expect(byLead.json).toHaveLength(1);

  expect((await call("GET", "/analytics/summary?days=30")).status).toBe(200);
  expect((await call("GET", `/analytics/commercials/${comId}?days=30`)).status).toBe(200);
  expect((await call("GET", "/payments/acomptes")).status).toBe(200);
  expect((await call("GET", "/objectives?period=2026-08")).status).toBe(200);
  const noPeriod = await call("GET", "/objectives");
  expect(noPeriod.status).toBe(422);
  expect(noPeriod.json.error.message).toMatch(/period/);
});

test("openapi.json documente paramètres de query et body à partir des validateurs", async () => {
  const { call } = await setup(["leads:read"]);
  const { status, json: spec } = await call("GET", "/openapi.json");
  expect(status).toBe(200);
  const listOp = spec.paths["/api/v1/leads"].get;
  const names = listOp.parameters.map((p: any) => p.name);
  expect(names).toEqual(expect.arrayContaining(["status", "setterId", "search", "limit", "cursor"]));
  expect(names).not.toContain("paginationOpts");
  const statusParam = listOp.parameters.find((p: any) => p.name === "status");
  expect(statusParam.schema.enum).toContain("qualifie");

  const createOp = spec.paths["/api/v1/leads"].post;
  expect(createOp.requestBody.content["application/json"].schema.properties.firstName).toEqual({ type: "string" });
  expect(createOp["x-scope"]).toBe("leads:write");

  const statusOp = spec.paths["/api/v1/leads/{leadId}/status"].post;
  expect(statusOp.parameters.map((p: any) => p.name)).toEqual(["leadId"]);
  expect(statusOp.requestBody.content["application/json"].schema.required).toEqual(["status"]);
});
