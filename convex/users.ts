import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { roleValidator, teamValidator } from "./model/enums";
import { getCurrentUser, requireUser, requireRole } from "./model/access";

export const me = query({
  args: {},
  handler: async (ctx) => getCurrentUser(ctx),
});

// Profil d'un membre (pages /team/setters/:id et /team/commerciaux/:id).
// Arg string + normalizeId : un id invalide (vieux lien REST) rend null au
// lieu de faire échouer la validation.
export const get = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const id = ctx.db.normalizeId("users", args.userId);
    if (!id) return null;
    const user = await ctx.db.get(id);
    return user && user.deletedAt === undefined ? user : null;
  },
});

export const list = query({
  args: {
    role: v.optional(roleValidator),
    team: v.optional(teamValidator),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "setter_lead", "commercial_lead"]);
    let rows = args.role
      ? await ctx.db.query("users").withIndex("by_role", (q) => q.eq("role", args.role!)).collect()
      : await ctx.db.query("users").collect();
    if (args.team !== undefined) rows = rows.filter((u) => u.team === args.team);
    if (args.active !== undefined) rows = rows.filter((u) => (u.active ?? true) === args.active);
    return rows.filter((u) => u.deletedAt === undefined);
  },
});

export const create = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.optional(roleValidator),
    team: v.optional(teamValidator),
    ghlUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    return await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      role: args.role ?? "setter",
      team: args.team,
      ghlUserId: args.ghlUserId,
      active: true,
      createdById: admin._id,
    });
  },
});

export const updateRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    await ctx.db.patch(args.userId, { role: args.role });
    return null;
  },
});

export const toggleActive = mutation({
  args: { userId: v.id("users"), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    await ctx.db.patch(args.userId, { active: args.active });
    return null;
  },
});

export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { lastSeenAt: Date.now() });
    return null;
  },
});
