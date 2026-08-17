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

export type RouteScope = `${ApiDomain}:${ApiAccess}`;
export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type ApiToken = { id: string; name: string; scopes: string[] };

export type ApiRequest = {
  token: ApiToken;
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
  summary: string;
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
      const token = await authenticate(ctx, req, now);

      const match = matchRoute(routes, req.method, url.pathname);
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

      const result = await route.handler(ctx, { token, params, query: url.searchParams, body, now, raw: req });
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
    const queryParams = Object.entries(r.queryParams ?? {}).map(([name, description]) => ({
      name, in: "query", required: false, description, schema: { type: "string" },
    }));
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
      op.requestBody = { required: false, content: { "application/json": { schema: { type: "object" } } } };
    }
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
