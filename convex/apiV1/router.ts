/**
 * Router de l'API agents (`/api/v1/*`) — auth Bearer, scopes, erreurs JSON,
 * rate limit, OpenAPI. Les routes métier sont déclarées dans ./routes.ts
 * (une liste par domaine) ; ce fichier ne connaît que le mécanisme.
 *
 * Contrat d'erreur : `{ error: { code, message, ...extra } }` avec
 *   401 invalid_key | revoked | expired      403 missing_scope {required}
 *   404 not_found   422 validation           429 rate_limited (Retry-After)
 *   405 method_not_allowed                   500 internal
 */
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashToken, TOKEN_PREFIX } from "../model/apiTokenCrypto";
import { API_DOMAINS, expandScopes, hasScope, type ApiAccess, type ApiDomain } from "../model/apiScopes";
import { kindOf, REGISTRY, type ActorArgs } from "./bridge";
import { toJsonSchema, topLevelFields } from "./validate";

export type RouteScope = `${ApiDomain}:${ApiAccess}`;
export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiToken = { id: string; name: string; scopes: string[] };

export type ApiRequest = {
  token: ApiToken;
  /** Acteur transmis au pont (compte de service, ou X-Acting-As). */
  actor: ActorArgs;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown; // JSON parsé (undefined si pas de body)
  now: number;
  raw: Request;
};

export type RouteDef = {
  method: ApiMethod;
  /** Chemin relatif à /api/v1, segments `:param` capturés. Ex. "/leads/:id". */
  path: string;
  /** Scope requis ; `null` = accessible à toute clé valide (ex. /me). */
  scope: RouteScope | null;
  /** Route publique (sans clé) : documentation uniquement, jamais de données. */
  public?: boolean;
  summary: string;
  /** Fonction métier pontée (`module.fn`) : sert à documenter les paramètres. */
  fn?: string;
  /** Documentation OpenAPI facultative des paramètres de query. */
  queryParams?: Record<string, string>;
  handler: (ctx: ActionCtx, req: ApiRequest) => Promise<unknown>;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what = "Ressource introuvable") => new ApiError(404, "not_found", what);
export const badRequest = (message: string, extra: Record<string, unknown> = {}) =>
  new ApiError(422, "validation", message, extra);

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function errorResponse(err: ApiError): Response {
  const headers: Record<string, string> = {};
  if (err.status === 429 && typeof err.extra.retryAfterMs === "number") {
    headers["retry-after"] = String(Math.ceil(err.extra.retryAfterMs / 1000));
  }
  return jsonResponse({ error: { code: err.code, message: err.message, ...err.extra } }, err.status, headers);
}

// ─── Matching ────────────────────────────────────────────────────────────────

export const API_PREFIX = "/api/v1";

function splitPath(p: string): string[] {
  return p.split("/").filter(Boolean);
}

export function matchRoute(
  routes: readonly RouteDef[],
  method: string,
  pathname: string,
): { route: RouteDef; params: Record<string, string> } | { pathExists: boolean } {
  if (!pathname.startsWith(API_PREFIX)) return { pathExists: false };
  const segs = splitPath(pathname.slice(API_PREFIX.length));
  let pathExists = false;
  for (const route of routes) {
    const pat = splitPath(route.path);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(":")) params[pat[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (pat[i] !== segs[i]) { ok = false; break; }
    }
    if (!ok) continue;
    pathExists = true;
    if (route.method === method) return { route, params };
  }
  return { pathExists };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

async function authenticate(ctx: ActionCtx, req: Request, now: number): Promise<ApiToken> {
  const secret = extractBearer(req);
  if (!secret || !secret.startsWith(TOKEN_PREFIX)) {
    throw new ApiError(401, "invalid_key", "Clé API manquante ou invalide (header Authorization: Bearer vlr_…)");
  }
  const result = await ctx.runMutation(internal.apiTokens.authenticate, { tokenHash: hashToken(secret), now });
  if (result.ok) return result.token;
  switch (result.code) {
    case "revoked": throw new ApiError(401, "revoked", "Clé API révoquée");
    case "expired": throw new ApiError(401, "expired", "Clé API expirée");
    case "rate_limited":
      throw new ApiError(429, "rate_limited", "Trop de requêtes pour cette clé", { retryAfterMs: result.retryAfterMs ?? 60_000 });
    default: throw new ApiError(401, "invalid_key", "Clé API invalide");
  }
}

// ─── Handler principal ───────────────────────────────────────────────────────

export function createApiHandler(routes: readonly RouteDef[]) {
  return async (ctx: ActionCtx, req: Request): Promise<Response> => {
    const now = Date.now();
    try {
      const url = new URL(req.url);
      const match = matchRoute(routes, req.method, url.pathname);
      const publicRoute = "route" in match && match.route.public === true;
      const token: ApiToken = publicRoute
        ? { id: "public", name: "public", scopes: [] }
        : await authenticate(ctx, req, now);

      if (!("route" in match)) {
        if (match.pathExists) throw new ApiError(405, "method_not_allowed", `Méthode ${req.method} non autorisée sur ${url.pathname}`);
        throw notFound(`Route inconnue : ${req.method} ${url.pathname}`);
      }
      const { route, params } = match;

      if (route.scope && !hasScope(token.scopes, route.scope)) {
        throw new ApiError(403, "missing_scope", `Scope requis : ${route.scope}`, { required: route.scope });
      }

      let body: unknown = undefined;
      if (req.method !== "GET") {
        const text = await req.text();
        if (text.trim()) {
          try { body = JSON.parse(text); } catch { throw badRequest("Body JSON invalide"); }
        }
      }

      if (publicRoute) {
        const out = await route.handler(ctx, {
          token, actor: { source: "public", serviceUserId: "" as ActorArgs["serviceUserId"] },
          params, query: url.searchParams, body, now, raw: req,
        });
        return typeof out === "string"
          ? new Response(out, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8", "access-control-allow-origin": "*" } })
          : jsonResponse(out ?? {}, 200, { "access-control-allow-origin": "*" });
      }
      const serviceUserId = await ctx.runMutation(internal.apiV1.bridge.ensureServiceUser, {});
      const actingAs = req.headers.get("x-acting-as")?.trim();
      const actor: ActorArgs = {
        source: `Clé API : ${token.name}`,
        serviceUserId,
        ...(actingAs ? { actingAsUserId: actingAs } : {}),
      };

      const result = await route.handler(ctx, { token, actor, params, query: url.searchParams, body, now, raw: req });
      return jsonResponse(result ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err);
      // Erreur métier remontée d'une mutation/query Convex (règle violée,
      // entité introuvable…) : on l'expose telle quelle en 422, message FR.
      const message = err instanceof Error ? cleanConvexMessage(err.message) : "Erreur inconnue";
      console.error("[api/v1]", req.method, req.url, message);
      return errorResponse(new ApiError(422, "validation", message));
    }
  };
}

/** Convex préfixe les erreurs de fonctions : on ne garde que le message utile. */
function cleanConvexMessage(msg: string): string {
  const m = /Uncaught Error:\s*([\s\S]*?)(?:\n\s+at |$)/.exec(msg);
  return (m ? m[1] : msg).trim();
}

// ─── Invocation des fonctions métier via le pont ─────────────────────────────

/** Appelle `module.fn` (query ou mutation publique) au nom de l'acteur de la requête. */
export async function invoke(ctx: ActionCtx, req: ApiRequest, fn: string, args: unknown = {}): Promise<unknown> {
  return kindOf(fn) === "query"
    ? await ctx.runQuery(internal.apiV1.bridge.invokeQuery, { fn, args, actor: req.actor })
    : await ctx.runMutation(internal.apiV1.bridge.invokeMutation, { fn, args, actor: req.actor });
}

// ─── Introspection ───────────────────────────────────────────────────────────

export function describeToken(token: ApiToken) {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    effectiveScopes: expandScopes(token.scopes),
  };
}

/** Routes accessibles à une clé, pour l'auto-découverte côté agent. */
export function allowedRoutes(routes: readonly RouteDef[], token: ApiToken) {
  return routes
    .filter((r) => r.scope === null || hasScope(token.scopes, r.scope))
    .map((r) => ({ method: r.method, path: `${API_PREFIX}${r.path}`, scope: r.scope, summary: r.summary }));
}

export function buildOpenApi(routes: readonly RouteDef[], baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const oaPath = `${API_PREFIX}${r.path}`.replace(/:(\w+)/g, "{$1}");
    const pathParams = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1], in: "path", required: true, schema: { type: "string" },
    }));
    const queryParams: Array<Record<string, unknown>> = Object.entries(r.queryParams ?? {}).map(([name, description]) => ({
      name, in: "query", required: false, description, schema: { type: "string" },
    }));
    let bodySchema: Record<string, unknown> | undefined;
    if (r.fn && REGISTRY[r.fn]?.exportArgs) {
      const fields = topLevelFields(REGISTRY[r.fn].exportArgs!());
      const pathNames = new Set(pathParams.map((p) => p.name));
      const bodyProps: Record<string, unknown> = {};
      const bodyRequired: string[] = [];
      for (const [name, { fieldType, optional }] of Object.entries(fields)) {
        if (pathNames.has(name)) continue;
        if (name === "paginationOpts") {
          if (r.method === "GET") queryParams.push(
            { name: "limit", in: "query", required: false, description: "Taille de page (1-200, défaut 50)", schema: { type: "integer" } },
            { name: "cursor", in: "query", required: false, description: "Curseur `nextCursor` de la page précédente", schema: { type: "string" } },
          );
          continue;
        }
        const injected = name === "now" || name === "today" || name === "todayStart";
        if (r.method === "GET") {
          queryParams.push({
            name, in: "query", required: !optional && !injected, schema: toJsonSchema(fieldType),
            ...(injected ? { description: "Injecté automatiquement (heure serveur / date Réunion) si absent" } : {}),
          });
        } else {
          bodyProps[name] = toJsonSchema(fieldType);
          if (!optional && !injected) bodyRequired.push(name);
        }
      }
      if (r.method !== "GET") bodySchema = { type: "object", properties: bodyProps, ...(bodyRequired.length ? { required: bodyRequired } : {}) };
    }
    const op: Record<string, unknown> = {
      operationId: `${r.method.toLowerCase()}_${r.path.replace(/[/:]+/g, "_").replace(/^_|_$/g, "") || "root"}`,
      summary: r.summary,
      tags: [r.scope ? r.scope.split(":")[0] : "meta"],
      "x-scope": r.scope,
      parameters: [...pathParams, ...queryParams],
      responses: {
        "200": { description: "OK" },
        "401": { description: "Clé invalide / révoquée / expirée" },
        "403": { description: `Scope requis : ${r.scope ?? "aucun"}` },
        "422": { description: "Validation / règle métier" },
        "429": { description: "Rate limit (300 req/min/clé)" },
      },
    };
    if (r.method !== "GET") {
      op.requestBody = { required: false, content: { "application/json": { schema: bodySchema ?? { type: "object" } } } };
    }
    if (r.fn) op["x-convex-function"] = r.fn;
    (paths[oaPath] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Velora — API agents",
      version: "1",
      description:
        "API pour agents et automatisations (Hermes, n8n…). Auth : `Authorization: Bearer vlr_…`. " +
        "Chaque route exige le scope indiqué en `x-scope` (`<domaine>:read|write`, presets `*:read` / `*:write`).",
    },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "meta", description: "Introspection" },
      ...API_DOMAINS.map((d) => ({ name: d.key, description: `${d.label} — ${d.desc}` })),
    ],
    paths,
  };
}

// ─── Guide Markdown pour agents (GET /guide.md) ──────────────────────────────

function fieldType(v: ReturnType<typeof topLevelFields>[string]["fieldType"]): string {
  const sch = toJsonSchema(v) as Record<string, unknown>;
  if (Array.isArray(sch.enum)) return (sch.enum as unknown[]).map((x) => JSON.stringify(x)).join(" | ");
  if (sch.type === "array") return `tableau`;
  if (typeof sch.type === "string") return sch.type === "number" ? "nombre" : sch.type === "boolean" ? "booléen" : sch.type === "string" ? "chaîne" : String(sch.type);
  if (Array.isArray(sch.anyOf)) return "valeur (voir openapi.json)";
  return "objet";
}

export function buildGuide(routes: readonly RouteDef[], baseUrl: string): string {
  const base = `${baseUrl}${API_PREFIX}`;
  const lines: string[] = [];
  lines.push("# Velora — API agents : guide d'utilisation", "");
  lines.push(`Base : \`${base}\` — Auth : header \`Authorization: Bearer vlr_…\` (clé créée par un admin dans Paramètres → API).`, "");
  lines.push("## Règles", "",
    "- `GET /me` : nom de la clé, scopes, **routes autorisées** (lis-le en premier). `GET /openapi.json` : schémas complets.",
    "- Scopes `<domaine>:read|write` ; `403 missing_scope` renvoie `required` = le scope à demander à un admin.",
    "- `X-Acting-As: <userId>` (optionnel) : agir au nom d'un utilisateur Velora (ses droits s'appliquent, l'action lui est attribuée). Sinon la clé agit comme un admin « Agent API ».",
    "- Listes paginées : `?limit=` (1-200, défaut 50) `&cursor=` → `{ items, nextCursor }` ; boucler tant que `nextCursor` n'est pas null.",
    "- Dates : millisecondes epoch (`scheduledAt`, `from`, `to`, `nextCallbackAt`) sauf `YYYY-MM-DD` (`period`, rapports pubs `from`/`to`). `now`/`today` sont injectés automatiquement.",
    "- Écritures : body JSON avec exactement les champs listés (champ inconnu = 422). Ne jamais inventer un identifiant : lis-le d'abord (ex. `GET /leads?search=`).",
    "- Erreurs : `{ error: { code, message } }` en français ; 422 = règle métier ou paramètre invalide (corrige et réessaie), 429 = attendre `Retry-After` secondes.",
    "- Avant un `DELETE` ou un changement de statut, confirme avec l'humain si la demande est ambiguë.", "");
  lines.push("## Vocabulaire métier → routes", "",
    "- prospect / lead / contact → `/leads` · appel téléphonique → `/leads/{leadId}/calls` · rendez-vous → `/rdv`",
    "- débrief (compte-rendu de RDV, vente ou non) → `/debriefs` · devis → `/devis` · projet / dossier de vente → `/projects`",
    "- délivrabilité (VT, DP, raccordement, installation, Consuel, mise en service) → `/clients` + `/workflow/steps` + `/workflow/substeps`",
    "- acomptes / échéancier / financement → `/payments`, `/debriefs/{debriefId}/…` · pubs Meta/Google → `/ads` · KPI, funnel, classements → `/analytics`",
    "- équipe (setters, commerciaux, techniciens…) → `/users` · objectifs mensuels → `/objectives` · apporteurs d'affaires → `/referrers` · historique des actions → `/activity`", "");
  lines.push("## Routes par domaine", "");
  const byDomain = new Map<string, RouteDef[]>();
  for (const r of routes) {
    const d = r.scope ? r.scope.split(":")[0] : "meta";
    (byDomain.get(d) ?? byDomain.set(d, []).get(d)!).push(r);
  }
  const label = (d: string) => API_DOMAINS.find((x) => x.key === d)?.label ?? (d === "meta" ? "Introspection" : d);
  for (const [d, rs] of byDomain) {
    lines.push(`### ${label(d)} (${d})`, "");
    for (const r of rs) {
      lines.push(`- **${r.method} ${API_PREFIX}${r.path}** — ${r.summary}${r.scope ? ` · scope \`${r.scope}\`` : " · public"}`);
      if (r.fn && REGISTRY[r.fn]?.exportArgs) {
        const fields = topLevelFields(REGISTRY[r.fn].exportArgs!());
        const pathNames = new Set([...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]));
        const parts: string[] = [];
        for (const [name, { fieldType: ft, optional }] of Object.entries(fields)) {
          if (pathNames.has(name)) continue;
          if (name === "paginationOpts") { parts.push("limit?, cursor?"); continue; }
          if (name === "now" || name === "today" || name === "todayStart") continue;
          parts.push(`${name}${optional ? "?" : ""}: ${fieldType(ft)}`);
        }
        if (parts.length) lines.push(`  - ${r.method === "GET" ? "query" : "body"} : ${parts.join(" ; ")}`);
      }
    }
    lines.push("");
  }
  lines.push("## Exemples", "",
    "```bash",
    `curl -H "Authorization: Bearer $VELORA_API_KEY" "${base}/leads?status=qualifie&limit=20"`,
    `curl -X POST -H "Authorization: Bearer $VELORA_API_KEY" -H "X-Acting-As: <userId>" -H "content-type: application/json" \\`,
    `  -d '{"result":"rappel_planifie","notes":"Rappeler jeudi","nextCallbackAt":1724000000000}' "${base}/leads/<leadId>/calls"`,
    `curl -X PATCH -H "Authorization: Bearer $VELORA_API_KEY" -H "content-type: application/json" -d '{"scheduledAt":1724050000000}' "${base}/rdv/<rdvId>"`,
    `curl -H "Authorization: Bearer $VELORA_API_KEY" "${base}/analytics/summary?days=30"`,
    "```", "");
  return lines.join("\n");
}
