import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { Role } from "./enums";

type Ctx = QueryCtx | MutationCtx;

export function roleOf(user: Doc<"users">): Role {
  return (user.role ?? "setter") as Role;
}

/**
 * Acteur de service (API agents /api/v1) : posé sur le ctx d'invocation par
 * convex/apiV1/bridge.ts, jamais par une session. `user` = compte de service
 * admin (ou l'utilisateur emprunté via X-Acting-As), `source` = libellé de la
 * clé pour le journal d'activité (« Clé API : Hermes »). Le ctx étant créé par
 * invocation, aucun état ne fuit entre requêtes.
 */
export type ServiceActor = { user: Doc<"users">; source: string };
const SERVICE_ACTOR = Symbol.for("velora.serviceActor");

export function getServiceActor(ctx: unknown): ServiceActor | null {
  return ((ctx as Record<symbol, unknown>)[SERVICE_ACTOR] as ServiceActor | undefined) ?? null;
}

export function withServiceActor<C extends object>(ctx: C, actor: ServiceActor): C {
  return Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, { [SERVICE_ACTOR]: actor }) as C;
}

// User RÉELLEMENT connecté (session auth), sans overlay « Explorer un profil ».
// À utiliser uniquement par la gestion de l'impersonation elle-même
// (users.setViewAs/clearViewAs/sessionContext). Un acteur de service (API
// agents) est traité comme le user réel.
export async function getRealUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const service = getServiceActor(ctx);
  if (service) return service.user;
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

// Règles d'impersonation — miroir du frontend (lib/auth.ts) :
//   admin → n'importe qui (écriture) ; commercial_lead → commercial (lecture
//   seule) ; commercial → setter (lecture seule).
export function impersonationAllowed(realRole: Role, targetRole: Role): boolean {
  return (
    realRole === "admin" ||
    (realRole === "commercial_lead" && targetRole === "commercial") ||
    (realRole === "commercial" && targetRole === "setter")
  );
}

function impersonationIsReadOnly(realRole: Role, targetRole: Role): boolean {
  return realRole !== "admin";
}

// Résout l'overlay d'un user réel : la cible si elle est valide et autorisée,
// sinon null (champ ignoré — un clearViewAs le nettoiera au prochain passage).
export async function resolveViewAs(ctx: Ctx, real: Doc<"users">): Promise<Doc<"users"> | null> {
  if (real.viewAsUserId === undefined) return null;
  const target = await ctx.db.get(real.viewAsUserId);
  if (!target || target.deletedAt !== undefined || target._id === real._id) return null;
  if (!impersonationAllowed(roleOf(real), roleOf(target))) return null;
  return target;
}

// Identité perçue par TOUTE l'app : l'overlay « Explorer un profil » s'il est
// actif, sinon le user de session. Les paires en lecture seule (non-admin) ne
// peuvent exécuter aucune mutation tant que l'exploration est active.
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const real = await getRealUser(ctx);
  if (!real) return null;
  const overlay = await resolveViewAs(ctx, real);
  if (!overlay) return real;
  const isMutation = typeof (ctx as MutationCtx).db.insert === "function";
  if (isMutation && impersonationIsReadOnly(roleOf(real), roleOf(overlay))) {
    throw new Error("Lecture seule : quittez le mode « Explorer un profil » pour modifier des données");
  }
  return overlay;
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
