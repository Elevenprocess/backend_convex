/**
 * Tokens API (Paramètres → API). Un admin crée un token nommé ; le secret
 * (`vlr_…`) n'est renvoyé qu'une seule fois. Seul son hash SHA-256 est stocké.
 * Un token valide est accepté partout où la clé de service HERMES_API_KEY
 * l'est (surface Hermes / adSpend), via requireServiceKey().
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireRole } from "./model/access";
import { hashToken } from "./model/hermesAuth";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSecret(): string {
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `vlr_${out}`;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db.query("apiTokens").withIndex("by_createdAt").order("desc").collect();
    const users = new Map<string, string>();
    for (const r of rows) {
      if (!users.has(r.createdById)) {
        const u = await ctx.db.get(r.createdById);
        users.set(r.createdById, u?.name ?? u?.email ?? "—");
      }
    }
    return rows.map((r) => ({
      id: r._id,
      name: r.name,
      prefix: r.prefix,
      createdAt: r.createdAt,
      createdBy: users.get(r.createdById) ?? "—",
      lastUsedAt: r.lastUsedAt ?? null,
      revokedAt: r.revokedAt ?? null,
    }));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const admin = await requireRole(ctx, ["admin"]);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Nom du token requis");
    const secret = randomSecret();
    const id = await ctx.db.insert("apiTokens", {
      name: trimmed,
      prefix: secret.slice(0, 12),
      tokenHash: await hashToken(secret),
      createdById: admin._id,
      createdAt: Date.now(),
    });
    // Le secret n'est jamais re-lisible : c'est le seul moment où il transite.
    return { id, secret };
  },
});

export const revoke = mutation({
  args: { id: v.id("apiTokens") },
  handler: async (ctx, { id }) => {
    await requireRole(ctx, ["admin"]);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Token introuvable");
    if (!row.revokedAt) await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

// Vérification par hash (utilisée depuis les actions, qui n'ont pas ctx.db).
export const checkHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const row = await ctx.db.query("apiTokens").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
    return row && !row.revokedAt ? row._id : null;
  },
});

export const touch = internalMutation({
  args: { id: v.id("apiTokens") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    // Au plus une écriture par minute par token : évite de saturer les writes.
    if (row && (!row.lastUsedAt || Date.now() - row.lastUsedAt > 60_000)) {
      await ctx.db.patch(id, { lastUsedAt: Date.now() });
    }
  },
});
