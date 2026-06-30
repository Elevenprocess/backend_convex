import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole, requireUser } from "./model/access";

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    if (args.activeOnly) {
      return await ctx.db
        .query("referrers")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
    }
    return await ctx.db.query("referrers").collect();
  },
});

export const create = mutation({
  args: {
    nom: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "setter_lead", "commercial_lead", "setter", "commercial"]);
    return await ctx.db.insert("referrers", {
      nom: args.nom,
      phone: args.phone,
      email: args.email,
      notes: args.notes,
      active: true,
    });
  },
});
