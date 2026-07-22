import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { roleValidator, teamValidator } from "./model/enums";
import { getCurrentUser, requireUser, requireRole, getRealUser, resolveViewAs, impersonationAllowed, roleOf } from "./model/access";

export const me = query({
  args: {},
  handler: async (ctx) => getCurrentUser(ctx),
});

// ─── Mode « Explorer un profil » (Settings) ──────────────────────────────────
// L'overlay vit en base (users.viewAsUserId) et est appliqué au centre par
// getCurrentUser : toutes les requêtes de l'app voient le profil exploré.
// sessionContext alimente le pont d'auth frontend (user réel + overlay) pour
// le bandeau « voir en tant que ».

export const sessionContext = query({
  args: {},
  handler: async (ctx) => {
    const real = await getRealUser(ctx);
    if (!real) return null;
    return { real, viewAs: await resolveViewAs(ctx, real) };
  },
});

export const setViewAs = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const real = await getRealUser(ctx);
    if (!real || real.active === false) throw new Error("Non authentifié");
    if (args.userId === real._id) throw new Error("Impossible d'explorer son propre profil");
    const target = await ctx.db.get(args.userId);
    if (!target || target.deletedAt !== undefined) throw new Error("Profil introuvable");
    if (!impersonationAllowed(roleOf(real), roleOf(target))) {
      throw new Error("Exploration non autorisée pour ce profil");
    }
    await ctx.db.patch(real._id, { viewAsUserId: args.userId });
    return null;
  },
});

export const clearViewAs = mutation({
  args: {},
  handler: async (ctx) => {
    const real = await getRealUser(ctx);
    if (!real) return null;
    if (real.viewAsUserId !== undefined) await ctx.db.patch(real._id, { viewAsUserId: undefined });
    return null;
  },
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

// Annuaire minimal (id, nom, rôle) ouvert à tout utilisateur connecté : sert à
// résoudre les noms setter/commercial dans les listes, appels et fiches. La
// fiche complète (emails, téléphones, activité) reste réservée via list().
export const directory = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("users").collect();
    return rows
      .filter((u) => u.deletedAt === undefined)
      .map((u) => ({ _id: u._id, _creationTime: u._creationTime, name: u.name, role: u.role }));
  },
});

// Présence « en ligne » (badge Actif/Non actif de la page équipe) : un compte
// est actif si son heartbeat (users:heartbeat, ~60 s côté front) date de moins
// de ONLINE_TTL_MS. `now` vient du client : une query Convex ne se réévalue pas
// avec le temps qui passe, le front change l'arg à chaque tick pour rafraîchir.
const ONLINE_TTL_MS = 2 * 60_000;

export const onlineIds = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("users").collect();
    return rows
      .filter((u) => u.deletedAt === undefined && (u.lastSeenAt ?? 0) > args.now - ONLINE_TTL_MS)
      .map((u) => u._id);
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
