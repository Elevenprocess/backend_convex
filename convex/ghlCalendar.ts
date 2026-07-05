/**
 * Calendrier GHL — sync (cron 15 min + manuelle) et lectures front (Tranche 8b).
 * GHL est la source de vérité des rendez-vous. Couches : helpers purs dans
 * model/ghl/, fetch API dans ghlClient.ts, écritures ici en mutations internes.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireUser, roleOf } from "./model/access";

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

// ─── Queries internes de support (les actions n'ont pas ctx.db) ─────────────

export const viewerInfo = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { userId: user._id, role: roleOf(user) };
  },
});

export const commercialsByGhlUserId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("users").collect();
    return rows
      .filter((u) =>
        u.deletedAt === undefined &&
        u.ghlUserId !== undefined &&
        (u.role === "commercial" || u.role === "commercial_lead"),
      )
      .map((u) => ({ ghlUserId: u.ghlUserId!, userId: u._id, name: u.name ?? "" }));
  },
});

export const leadSyncInfo = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    return { externalId: lead.externalId };
  },
});

export const userForMySector = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt !== undefined) return null;
    return { ghlUserId: user.ghlUserId, ghlCalendarId: user.ghlCalendarId };
  },
});

export const setUserGhlCalendarId = internalMutation({
  args: { userId: v.id("users"), calendarId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { ghlCalendarId: args.calendarId });
    return null;
  },
});
