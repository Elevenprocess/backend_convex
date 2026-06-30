import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { callResultValidator } from "./model/enums";
import { requireUser } from "./model/access";

export const logCall = mutation({
  args: {
    leadId: v.id("leads"),
    result: callResultValidator,
    durationSec: v.optional(v.number()),
    notes: v.optional(v.string()),
    nextCallbackAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    const calledAt = Date.now();
    const id = await ctx.db.insert("callLogs", {
      leadId: args.leadId,
      setterId: user._id,
      calledAt,
      result: args.result,
      durationSec: args.durationSec,
      notes: args.notes,
      nextCallbackAt: args.nextCallbackAt,
    });
    await ctx.db.patch(args.leadId, { lastContactAt: calledAt });
    return id;
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db
      .query("callLogs")
      .withIndex("by_lead_calledAt", (q) => q.eq("leadId", args.leadId))
      .order("desc")
      .collect();
  },
});

export const upcomingCallbacks = query({
  args: { setterId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("callLogs")
      .withIndex("by_callback", (q) => q.gt("nextCallbackAt", now))
      .collect();
    return args.setterId ? rows.filter((r) => r.setterId === args.setterId) : rows;
  },
});
