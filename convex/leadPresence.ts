/**
 * Présence « un setter regarde ce lead » — remplace le gateway socket.io
 * NestJS (lead:select / lead:deselect). Modèle heartbeat :
 *  - le client `touch` à l'ouverture d'un prospect puis toutes les ~25 s ;
 *  - TTL 60 s : sans heartbeat (onglet fermé, crash), le verrou expire seul ;
 *  - `list` est une query RÉACTIVE : chaque heartbeat/release des autres
 *    onglets pousse la mise à jour à tous les clients abonnés.
 * Une seule ligne par utilisateur (on ne regarde qu'un prospect à la fois).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./model/access";

const TTL_MS = 60_000;

export const touch = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = Date.now();
    const userName = user.name || user.email || "Setter";

    const existing = await ctx.db
      .query("leadPresence")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        leadId: args.leadId,
        userName,
        expiresAt: now + TTL_MS,
        // Nouveau prospect consulté → nouveau point de départ.
        ...(existing.leadId !== args.leadId ? { startedAt: now } : {}),
      });
    } else {
      await ctx.db.insert("leadPresence", {
        leadId: args.leadId,
        userId: user._id,
        userName,
        startedAt: now,
        expiresAt: now + TTL_MS,
      });
    }

    // Nettoyage opportuniste des verrous morts (bornés pour rester léger).
    const stale = await ctx.db
      .query("leadPresence")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(20);
    for (const row of stale) await ctx.db.delete(row._id);
    return null;
  },
});

export const release = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("leadPresence")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const now = Date.now();
    const rows = await ctx.db.query("leadPresence").collect();
    return rows
      .filter((r) => r.expiresAt > now)
      .map((r) => ({
        leadId: r.leadId,
        userId: r.userId,
        userName: r.userName,
        since: r.startedAt,
      }));
  },
});
