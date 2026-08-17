import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { roleValidator, teamValidator } from "./model/enums";
import { getCurrentUser, requireUser, requireRole, getRealUser, resolveViewAs, impersonationAllowed, roleOf } from "./model/access";
import { logActivity, userLabel, ROLE_LABEL, label, diffFields, fieldsSentence } from "./model/activity";

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
    return rows.filter((u) => u.deletedAt === undefined && !u.isService);
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
    const userId = await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      role: args.role ?? "setter",
      team: args.team,
      ghlUserId: args.ghlUserId,
      active: true,
      createdById: admin._id,
    });
    await logActivity(ctx, {
      action: "user.created", entityType: "user", entityId: userId, subject: args.name,
      summary: `a créé le compte ${args.name} (${label(ROLE_LABEL, args.role ?? "setter")})`,
      details: { email: args.email, role: args.role ?? "setter", team: args.team ?? null },
    });
    return userId;
  },
});

// Édition admin de la fiche membre (modale « Modifier l'utilisateur »).
// phone: null efface le numéro (même contrat que le PATCH REST historique).
export const adminUpdate = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    phone: v.optional(v.union(v.string(), v.null())),
    role: v.optional(roleValidator),
    team: v.optional(teamValidator),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const target = await ctx.db.get(args.userId);
    if (!target || target.deletedAt !== undefined) throw new Error("Utilisateur introuvable");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.phone !== undefined) patch.phone = args.phone ?? undefined;
    if (args.role !== undefined) patch.role = args.role;
    if (args.team !== undefined) patch.team = args.team;
    if (args.active !== undefined) patch.active = args.active;
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.userId, patch);
    {
      const diff = diffFields(target as unknown as Record<string, unknown>, patch);
      if (diff.changed.length > 0) {
        const bits: string[] = [];
        if (diff.changed.includes("role")) bits.push(`rôle « ${label(ROLE_LABEL, target.role)} » → « ${label(ROLE_LABEL, args.role)} »`);
        if (diff.changed.includes("active")) bits.push(args.active ? "compte réactivé" : "compte désactivé");
        const rest = diff.changed.filter((k) => k !== "role" && k !== "active");
        if (rest.length) bits.push(fieldsSentence(rest));
        await logActivity(ctx, {
          action: diff.changed.includes("role") ? "user.role_changed" : diff.changed.includes("active") ? (args.active ? "user.activated" : "user.deactivated") : "user.updated",
          entityType: "user", entityId: args.userId, subject: userLabel(target),
          summary: `a modifié le compte ${userLabel(target)} (${bits.join(" ; ")})`,
          details: { before: diff.before, after: diff.after },
        });
      }
    }
    return null;
  },
});

// Suppression douce (bouton « Supprimer l'utilisateur ») : le compte disparaît
// des listes et ne peut plus se connecter, l'historique (leads, RDV, appels)
// reste rattaché à son id.
export const remove = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    if (admin._id === args.userId) throw new Error("Impossible de supprimer son propre compte");
    const target = await ctx.db.get(args.userId);
    if (!target || target.deletedAt !== undefined) throw new Error("Utilisateur introuvable");
    await ctx.db.patch(args.userId, { deletedAt: Date.now(), active: false });
    await logActivity(ctx, {
      action: "user.deleted", entityType: "user", entityId: args.userId, subject: userLabel(target),
      summary: `a supprimé le compte ${userLabel(target)} (${label(ROLE_LABEL, target.role)})`,
    });
    return null;
  },
});

export const updateRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const target = await ctx.db.get(args.userId);
    await ctx.db.patch(args.userId, { role: args.role });
    if (target && target.role !== args.role) {
      await logActivity(ctx, {
        action: "user.role_changed", entityType: "user", entityId: args.userId, subject: userLabel(target),
        summary: `a changé le rôle de ${userLabel(target)} : « ${label(ROLE_LABEL, target.role ?? "setter")} » → « ${label(ROLE_LABEL, args.role)} »`,
        details: { before: { role: target.role ?? "setter" }, after: { role: args.role } },
      });
    }
    return null;
  },
});

export const toggleActive = mutation({
  args: { userId: v.id("users"), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const target = await ctx.db.get(args.userId);
    await ctx.db.patch(args.userId, { active: args.active });
    if (target && (target.active ?? true) !== args.active) {
      await logActivity(ctx, {
        action: args.active ? "user.activated" : "user.deactivated", entityType: "user", entityId: args.userId,
        subject: userLabel(target),
        summary: args.active ? `a réactivé le compte ${userLabel(target)}` : `a désactivé le compte ${userLabel(target)}`,
      });
    }
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
