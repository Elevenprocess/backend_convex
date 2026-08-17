/**
 * Clés API agents (Paramètres → Clés API, admin uniquement).
 *
 * - list / create / updateScopes / revoke : mutations admin (session Convex Auth).
 * - authenticate : internalMutation appelée par le router /api/v1 à CHAQUE
 *   requête (lookup par hash, révocation, expiration, scopes, rate limit,
 *   compteurs d'usage). Fail-closed.
 *
 * Le secret `vlr_…` n'est renvoyé qu'à la création ; seul son hash est stocké.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireRole } from "./model/access";
import { insertAudit } from "./model/audit";
import { hashToken, randomToken, tokenPrefix } from "./model/apiTokenCrypto";
import { ALL_SCOPES, expandScopes, normalizeScopes } from "./model/apiScopes";

export const RATE_LIMIT_PER_MINUTE = 300;
const MAX_NAME = 60;
const MAX_TOKENS = 50;

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db.query("apiTokens").withIndex("by_createdAt").order("desc").collect();
    const names = new Map<string, string>();
    for (const r of rows) {
      if (!names.has(r.createdById)) {
        const u = await ctx.db.get(r.createdById);
        names.set(r.createdById, u?.name ?? u?.email ?? "—");
      }
    }
    return rows.map((r) => ({
      id: r._id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes ?? [],
      effectiveScopes: expandScopes(r.scopes ?? []),
      createdAt: r.createdAt,
      createdBy: names.get(r.createdById) ?? "—",
      expiresAt: r.expiresAt ?? null,
      revokedAt: r.revokedAt ?? null,
      lastUsedAt: r.lastUsedAt ?? null,
      callCount: r.callCount ?? 0,
    }));
  },
});

/** Catalogue des scopes (pour l'UI) : la liste complète + presets. */
export const scopes = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return { all: ALL_SCOPES, presets: ["*:read", "*:write"] as const };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const name = args.name.trim();
    if (!name) throw new Error("Nom de la clé requis");
    if (name.length > MAX_NAME) throw new Error(`Nom trop long (max ${MAX_NAME})`);
    const scopes = normalizeScopes(args.scopes);
    if (scopes.length === 0) throw new Error("Choisissez au moins un scope");
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error("La date d'expiration doit être dans le futur");
    }
    const existing = await ctx.db.query("apiTokens").withIndex("by_createdAt").collect();
    if (existing.filter((r) => !r.revokedAt).length >= MAX_TOKENS) {
      throw new Error(`Limite de ${MAX_TOKENS} clés actives atteinte`);
    }
    const secret = randomToken();
    const id = await ctx.db.insert("apiTokens", {
      name,
      prefix: tokenPrefix(secret),
      tokenHash: hashToken(secret),
      scopes,
      createdById: admin._id,
      createdAt: Date.now(),
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
      callCount: 0,
    });
    await insertAudit(ctx, {
      userId: admin._id,
      action: "api_token.created",
      entityType: "apiToken",
      entityId: id,
      after: { name, scopes, expiresAt: args.expiresAt ?? null },
    });
    // Seul moment où le secret transite : il n'est jamais re-lisible.
    return { id, secret, prefix: tokenPrefix(secret), scopes };
  },
});

export const updateScopes = mutation({
  args: { id: v.id("apiTokens"), scopes: v.array(v.string()) },
  handler: async (ctx, { id, scopes: raw }) => {
    const admin = await requireRole(ctx, ["admin"]);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Clé introuvable");
    if (row.revokedAt) throw new Error("Clé révoquée : créez-en une nouvelle");
    const scopes = normalizeScopes(raw);
    if (scopes.length === 0) throw new Error("Choisissez au moins un scope");
    await ctx.db.patch(id, { scopes });
    await insertAudit(ctx, {
      userId: admin._id,
      action: "api_token.scopes_updated",
      entityType: "apiToken",
      entityId: id,
      before: { scopes: row.scopes ?? [] },
      after: { scopes },
    });
    return { id, scopes };
  },
});

export const revoke = mutation({
  args: { id: v.id("apiTokens") },
  handler: async (ctx, { id }) => {
    const admin = await requireRole(ctx, ["admin"]);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Clé introuvable");
    if (row.revokedAt) return null;
    await ctx.db.patch(id, { revokedAt: Date.now() });
    await insertAudit(ctx, {
      userId: admin._id,
      action: "api_token.revoked",
      entityType: "apiToken",
      entityId: id,
      before: { name: row.name, scopes: row.scopes ?? [] },
    });
    return null;
  },
});

export type AuthFailure = "invalid_key" | "revoked" | "expired" | "rate_limited";
export type AuthResult =
  | { ok: true; token: { id: string; name: string; scopes: string[] } }
  | { ok: false; code: AuthFailure; retryAfterMs?: number };

/**
 * Authentification d'une requête /api/v1 : une seule écriture par appel
 * (compteurs + fenêtre de rate limit). `now` injecté pour les tests.
 */
export const authenticate = internalMutation({
  args: { tokenHash: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { tokenHash, now: nowArg }): Promise<AuthResult> => {
    const now = nowArg ?? Date.now();
    const row = await ctx.db
      .query("apiTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!row) return { ok: false, code: "invalid_key" };
    if (row.revokedAt) return { ok: false, code: "revoked" };
    if (row.expiresAt !== undefined && row.expiresAt <= now) return { ok: false, code: "expired" };

    const windowStart = row.windowStart ?? 0;
    const inWindow = now - windowStart < 60_000;
    const windowCount = inWindow ? (row.windowCount ?? 0) : 0;
    if (windowCount >= RATE_LIMIT_PER_MINUTE) {
      return { ok: false, code: "rate_limited", retryAfterMs: Math.max(0, 60_000 - (now - windowStart)) };
    }
    await ctx.db.patch(row._id, {
      lastUsedAt: now,
      callCount: (row.callCount ?? 0) + 1,
      windowStart: inWindow ? windowStart : now,
      windowCount: windowCount + 1,
    });
    return { ok: true, token: { id: row._id, name: row.name, scopes: row.scopes ?? [] } };
  },
});
