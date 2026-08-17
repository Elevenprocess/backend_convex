/**
 * Garde de la surface « service » (Hermes, adSpend, intégrations) : accepte
 * soit la clé d'env HERMES_API_KEY, soit un token API créé dans Paramètres →
 * API (table apiTokens, comparé par hash SHA-256, non révoqué).
 * Fail-closed : ni clé serveur configurée ni token valide → refus.
 */
import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

export async function hashToken(secret: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function findApiToken(ctx: AnyCtx, apiKey: string): Promise<string | null> {
  if (!apiKey.startsWith("vlr_")) return null;
  const tokenHash = await hashToken(apiKey);
  if ("db" in ctx) {
    const row = await ctx.db.query("apiTokens").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).unique();
    return row && !row.revokedAt ? row._id : null;
  }
  return await ctx.runQuery(internal.apiTokens.checkHash, { tokenHash });
}

export async function requireServiceKey(ctx: AnyCtx, apiKey: string): Promise<void> {
  const expected = process.env.HERMES_API_KEY;
  if (expected && apiKey === expected) return;
  const tokenId = await findApiToken(ctx, apiKey);
  if (tokenId) {
    // Trace d'usage best-effort ; les queries ne peuvent pas écrire.
    if ("scheduler" in ctx) {
      try { await ctx.scheduler.runAfter(0, internal.apiTokens.touch, { id: tokenId as any }); } catch { /* ignore */ }
    }
    return;
  }
  if (!expected) throw new Error("HERMES_API_KEY non configuré côté serveur et aucun token API valide");
  throw new Error("Clé Hermes invalide");
}
