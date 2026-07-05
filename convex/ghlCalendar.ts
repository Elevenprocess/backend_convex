/**
 * Calendrier GHL — sync (cron 15 min + manuelle) et lectures front (Tranche 8b).
 * GHL est la source de vérité des rendez-vous. Couches : helpers purs dans
 * model/ghl/, fetch API dans ghlClient.ts, écritures ici en mutations internes.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// ─── Cache events (TTL 60 s, table — la Map mémoire NestJS ne survit pas aux
// isolates Convex) ────────────────────────────────────────────────────────────

export const cacheGet = internalQuery({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("ghlEventsCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!row || row.expiresAt <= args.now) return null;
    return row.payload;
  },
});

export const cacheSet = internalMutation({
  args: { key: v.string(), payload: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ghlEventsCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { payload: args.payload, expiresAt: args.expiresAt });
    else await ctx.db.insert("ghlEventsCache", args);
    return null;
  },
});
