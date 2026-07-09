// Invitations d'onboarding — portage de UsersService (invite/accept/revoke/
// regenerate/renew) adapté à Convex Auth : l'invité s'inscrit via le flux auth,
// puis `acceptInvitation` (authentifié) applique rôle/équipe/activation. Les
// business managers (admin + commercial_lead) émettent et gèrent les invitations.
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireUser, requireRole } from "./model/access";
import { roleValidator, teamValidator, type Role } from "./model/enums";

const MANAGER_ROLES: Role[] = ["admin", "commercial_lead"];
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inviteUrl(token: string): string {
  const base = (process.env.FRONTEND_URL ?? "https://crm.electroconceptoi.com")
    .split(",")[0].trim().replace(/\/$/, "");
  return `${base}/#/accept-invite/${encodeURIComponent(token)}`;
}

// ─── Support interne (les actions n'ont pas ctx.db) ──────────────────────────

export const managerActor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const actor = await requireRole(ctx, MANAGER_ROLES);
    return actor._id;
  },
});

export const emailInUse = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .collect();
    return rows.some((u) => u.deletedAt === undefined);
  },
});

export const storeInvitation = internalMutation({
  args: {
    email: v.string(), name: v.string(), role: roleValidator, team: v.optional(teamValidator),
    phone: v.optional(v.string()), token: v.string(), invitedById: v.id("users"),
    expiresAt: v.number(), now: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"userInvitations">> => {
    // Révoque toute invitation pending pour ce même email.
    const prior = await ctx.db
      .query("userInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    for (const p of prior) {
      if (p.status === "pending") await ctx.db.patch(p._id, { status: "revoked" });
    }
    return await ctx.db.insert("userInvitations", {
      email: args.email, name: args.name, role: args.role,
      ...(args.team !== undefined ? { team: args.team } : {}),
      ...(args.phone !== undefined ? { phone: args.phone } : {}),
      token: args.token, status: "pending", invitedById: args.invitedById, expiresAt: args.expiresAt,
    });
  },
});

export const retokenInvitation = internalMutation({
  args: { invitationId: v.id("userInvitations"), token: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const inv = await ctx.db.get(args.invitationId);
    if (!inv) throw new Error("Invitation introuvable");
    if (inv.status !== "pending") throw new Error("Invitation déjà traitée ou révoquée");
    await ctx.db.patch(args.invitationId, { token: args.token, expiresAt: args.expiresAt });
    return null;
  },
});

// ─── Actions (génèrent le token aléatoire) ───────────────────────────────────

export const createInvitation = action({
  args: {
    email: v.string(), name: v.string(), role: roleValidator,
    team: v.optional(teamValidator), phone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ invitationId: Id<"userInvitations">; token: string; inviteUrl: string }> => {
    const invitedById = await ctx.runQuery(internal.invitations.managerActor, {});
    const email = args.email.trim().toLowerCase();
    if (await ctx.runQuery(internal.invitations.emailInUse, { email })) {
      throw new Error(`Email ${email} déjà utilisé`);
    }
    const token = randomToken();
    const now = Date.now();
    const invitationId = await ctx.runMutation(internal.invitations.storeInvitation, {
      email, name: args.name.trim(), role: args.role, team: args.team,
      phone: args.phone?.trim() || undefined, token, invitedById,
      expiresAt: now + INVITE_TTL_MS, now,
    });
    return { invitationId, token, inviteUrl: inviteUrl(token) };
  },
});

export const regenerateInvitation = action({
  args: { invitationId: v.id("userInvitations") },
  handler: async (ctx, args): Promise<{ token: string; inviteUrl: string }> => {
    await ctx.runQuery(internal.invitations.managerActor, {});
    const token = randomToken();
    await ctx.runMutation(internal.invitations.retokenInvitation, {
      invitationId: args.invitationId, token, expiresAt: Date.now() + INVITE_TTL_MS,
    });
    return { token, inviteUrl: inviteUrl(token) };
  },
});

// ─── Queries / mutations ─────────────────────────────────────────────────────

export const listInvitations = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, MANAGER_ROLES);
    return await ctx.db.query("userInvitations").order("desc").take(100);
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("userInvitations") },
  handler: async (ctx, args) => {
    await requireRole(ctx, MANAGER_ROLES);
    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.status !== "pending") return null;
    await ctx.db.patch(args.invitationId, { status: "revoked" });
    return null;
  },
});

// L'invité s'est inscrit via Convex Auth (user créé, rôle défaut). Il réclame
// ici son rôle/équipe : l'email de l'invitation doit correspondre au sien.
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const inv = await ctx.db
      .query("userInvitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!inv) throw new Error("Invitation introuvable");
    if (inv.status !== "pending") throw new Error("Invitation déjà utilisée ou annulée");
    const now = Date.now();
    // Note : on ne peut pas marquer `expired` ET throw dans la même mutation
    // (le throw annule le patch). On rejette seulement ; l'invitation périmée
    // reste inexploitable (expiresAt < now).
    if (inv.expiresAt < now) throw new Error("Invitation expirée");
    if ((user.email ?? "").trim().toLowerCase() !== inv.email) {
      throw new Error("Cette invitation ne correspond pas à votre compte");
    }
    await ctx.db.patch(user._id, {
      role: inv.role,
      ...(inv.team !== undefined ? { team: inv.team } : {}),
      ...(inv.phone !== undefined ? { phone: inv.phone } : {}),
      active: true,
      emailVerified: true,
    });
    await ctx.db.patch(inv._id, { status: "accepted", acceptedUserId: user._id, acceptedAt: now });
    return { userId: user._id };
  },
});

// Réactive un utilisateur désactivé (repasse active=true, rôle/équipe/email
// optionnellement mis à jour). L'auth Convex gère la reconnexion.
export const renewUser = mutation({
  args: {
    userId: v.id("users"),
    role: v.optional(roleValidator),
    team: v.optional(teamValidator),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, MANAGER_ROLES);
    const target = await ctx.db.get(args.userId);
    if (!target || target.deletedAt !== undefined) throw new Error("Utilisateur introuvable");
    await ctx.db.patch(args.userId, {
      active: true,
      emailVerified: false,
      ...(args.role !== undefined ? { role: args.role } : {}),
      ...(args.team !== undefined ? { team: args.team } : {}),
      ...(args.email !== undefined ? { email: args.email.trim().toLowerCase() } : {}),
      ...(args.name !== undefined ? { name: args.name.trim() } : {}),
      ...(args.phone !== undefined ? { phone: args.phone } : {}),
    });
    return null;
  },
});
