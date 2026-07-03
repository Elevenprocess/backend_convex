/**
 * Cloche de notifications : lecture + marquage lu, scopés au propriétaire.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./model/access";

export const listMine = query({
  args: { unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows
      .filter((n) => !args.unreadOnly || n.readAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.notificationId);
    if (!row || row.userId !== user._id) throw new Error("Notification introuvable");
    await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const now = Date.now();
    for (const n of rows) {
      if (n.readAt === undefined) await ctx.db.patch(n._id, { readAt: now });
    }
    return null;
  },
});
