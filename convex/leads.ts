import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { leadStatusValidator } from "./model/enums";
import { requireUser, requireRole } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";

export const get = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db.get(args.leadId);
  },
});

export const list = query({
  args: {
    status: v.optional(leadStatusValidator),
    setterId: v.optional(v.id("users")),
    city: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let q;
    if (args.status !== undefined && args.setterId !== undefined) {
      q = ctx.db.query("leads").withIndex("by_status_setter", (ix) =>
        ix.eq("status", args.status!).eq("setterId", args.setterId!),
      );
    } else if (args.status !== undefined) {
      q = ctx.db.query("leads").withIndex("by_status_setter", (ix) => ix.eq("status", args.status!));
    } else if (args.setterId !== undefined) {
      q = ctx.db.query("leads").withIndex("by_setter", (ix) => ix.eq("setterId", args.setterId!));
    } else {
      q = ctx.db.query("leads");
    }
    const ordered = q.order("desc");
    if (args.city !== undefined) {
      return await ordered.filter((f) => f.eq(f.field("city"), args.city!)).paginate(args.paginationOpts);
    }
    return await ordered.paginate(args.paginationOpts);
  },
});

export const create = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    revenuFiscal: v.optional(v.number()),
    typeLogement: v.optional(v.string()),
    referrerId: v.optional(v.id("referrers")),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      "admin", "setter", "setter_lead", "commercial", "commercial_lead",
    ]);
    return await ctx.db.insert("leads", {
      ...args,
      source: "manual",
      status: "nouveau",
      setterId: user._id,
    });
  },
});

export const assignSetter = mutation({
  args: { leadId: v.id("leads"), setterId: v.id("users") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "setter_lead"]);
    await ctx.db.patch(args.leadId, { setterId: args.setterId });
    return null;
  },
});

export const assignCommercial = mutation({
  args: { leadId: v.id("leads"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "commercial_lead", "setter_lead"]);
    await ctx.db.patch(args.leadId, { assignedToId: args.userId });
    return null;
  },
});

export const updateStatus = mutation({
  args: { leadId: v.id("leads"), status: leadStatusValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    if (lead.status === args.status) return null; // pas de mouvement
    await ctx.db.patch(args.leadId, { status: args.status });
    await insertStageHistory(ctx, {
      leadId: args.leadId,
      ghlStageName: args.status, // entrées manuelles : libellé = statut SaaS
      saasStatus: args.status,
      assignedToId: lead.assignedToId,
      changedAt: Date.now(),
      source: "manual",
    });
    return null;
  },
});

export const qualify = mutation({
  args: { leadId: v.id("leads"), qualified: v.boolean() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    const status = args.qualified ? "qualifie" : "pas_qualifie";
    if (lead.status === status) return null;
    await ctx.db.patch(args.leadId, { status });
    await insertStageHistory(ctx, {
      leadId: args.leadId,
      ghlStageName: status,
      saasStatus: status,
      assignedToId: lead.assignedToId,
      changedAt: Date.now(),
      source: "manual",
    });
    return null;
  },
});
