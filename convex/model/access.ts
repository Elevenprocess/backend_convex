import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { Role } from "./enums";

type Ctx = QueryCtx | MutationCtx;

export function roleOf(user: Doc<"users">): Role {
  return (user.role ?? "setter") as Role;
}

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Non authentifié");
  if (user.active === false) throw new Error("Compte désactivé");
  return user;
}

export async function requireRole(ctx: Ctx, allowed: Role[]): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (!allowed.includes(roleOf(user))) {
    throw new Error(`Accès refusé : rôle ${roleOf(user)} non autorisé`);
  }
  return user;
}

const COMMERCIAL_ROLES: Role[] = ["admin", "commercial", "commercial_lead"];

// Rôles autorisés à faire « bouger » un lead (statut/qualification/appel).
// Exclut technicien / back_office / responsable_technique / finances / delivrabilite,
// qui n'ont pas à modifier l'état commercial d'un lead.
export const LEAD_WRITE_ROLES: Role[] = [
  "admin", "setter", "setter_lead", "commercial", "commercial_lead",
];

export async function requireLeadWriteRole(ctx: Ctx): Promise<Doc<"users">> {
  return await requireRole(ctx, LEAD_WRITE_ROLES);
}

export async function assertCommercialRole(ctx: Ctx, userId: Id<"users">): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Commercial introuvable");
  if (!COMMERCIAL_ROLES.includes(roleOf(user))) {
    throw new Error("L'utilisateur n'a pas un rôle commercial");
  }
  return user;
}
