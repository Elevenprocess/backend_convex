/**
 * Pont « acteur de service » de l'API agents.
 *
 * Les fonctions métier de Velora (leads.list, rdv.create, …) sont gardées par
 * requireUser()/requireRole() sur la session Convex Auth. Une httpAction n'a
 * pas de session : ce pont invoque le handler enregistré (`fn._handler`, la
 * même couture que convex-test) sur un ctx d'invocation portant un
 * ServiceActor (model/access.ts). Résultat : mêmes règles métier, mêmes
 * effets (GHL, notifications), même journal d'activité — sans dupliquer la
 * logique, et sans toucher aux modules existants.
 *
 * - Acteur par défaut : compte de service admin « Agent API » (isService),
 *   créé à la volée. `actingAs` (header X-Acting-As) emprunte un utilisateur
 *   réel : ses droits s'appliquent, la trace indique « via Clé API : <nom> ».
 * - Seules les fonctions PUBLIQUES (query/mutation) des modules listés sont
 *   invocables ; les actions (agenda GHL, invitations, sync ads) ont leur
 *   propre chemin (voir routes du domaine).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { withServiceActor, type ServiceActor } from "../model/access";
import { validateArgs } from "./validate";

import * as leads from "../leads";
import * as rdv from "../rdv";
import * as callLogs from "../callLogs";
import * as debriefs from "../debriefs";
import * as devis from "../devis";
import * as projects from "../projects";
import * as workflowSteps from "../workflowSteps";
import * as workflowSubsteps from "../workflowSubsteps";
import * as documents from "../documents";
import * as projectAttachments from "../projectAttachments";
import * as clients from "../clients";
import * as payments from "../payments";
import * as ads from "../ads";
import * as adDeposits from "../adDeposits";
import * as analytics from "../analytics";
import * as simulatorStats from "../simulatorStats";
import * as users from "../users";
import * as invitations from "../invitations";
import * as notifications from "../notifications";
import * as commercialObjectives from "../commercialObjectives";
import * as referrers from "../referrers";
import * as activityLog from "../activityLog";

type Registered = {
  isQuery?: boolean;
  isMutation?: boolean;
  isInternal?: boolean;
  exportArgs?: () => string;
  _handler?: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const MODULES: Record<string, Record<string, unknown>> = {
  leads, rdv, callLogs, debriefs, devis, projects, workflowSteps, workflowSubsteps,
  documents, projectAttachments, clients, payments, ads, adDeposits, analytics,
  simulatorStats, users, invitations, notifications, commercialObjectives, referrers,
  activityLog,
};

/** `module.fn` → fonction publique query/mutation. */
export const REGISTRY: Record<string, Registered> = {};
for (const [mod, exportsOf] of Object.entries(MODULES)) {
  for (const [name, fn] of Object.entries(exportsOf)) {
    if (typeof fn !== "function") continue;
    const r = fn as unknown as Registered;
    if (r.isInternal) continue;
    if ((r.isQuery || r.isMutation) && typeof r._handler === "function") REGISTRY[`${mod}.${name}`] = r;
  }
}

export function kindOf(fn: string): "query" | "mutation" {
  const r = REGISTRY[fn];
  if (!r) throw new Error(`Fonction non exposée : ${fn}`);
  return r.isMutation ? "mutation" : "query";
}

export const SERVICE_EMAIL = "api@velora.local";
export const SERVICE_NAME = "Agent API";

export const actorValidator = v.object({
  source: v.string(),
  serviceUserId: v.id("users"),
  actingAsUserId: v.optional(v.id("users")),
});
export type ActorArgs = { source: string; serviceUserId: Id<"users">; actingAsUserId?: Id<"users"> };

async function resolveActor(ctx: QueryCtx | MutationCtx, a: ActorArgs): Promise<ServiceActor> {
  if (a.actingAsUserId) {
    const u = await ctx.db.get(a.actingAsUserId);
    if (!u || u.deletedAt !== undefined) throw new Error("X-Acting-As : utilisateur introuvable");
    if (u.active === false) throw new Error("X-Acting-As : compte désactivé");
    if (u.isService) throw new Error("X-Acting-As : compte de service non autorisé");
    return { user: u, source: a.source };
  }
  const svc = await ctx.db.get(a.serviceUserId);
  if (!svc || !svc.isService) throw new Error("Compte de service introuvable");
  return { user: svc, source: a.source };
}

/** Crée (une fois) le compte de service admin et renvoie son id. */
export const ensureServiceUser = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const existing = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", SERVICE_EMAIL)).unique();
    if (existing) {
      if (existing.deletedAt !== undefined || existing.active === false || !existing.isService || existing.role !== "admin") {
        await ctx.db.patch(existing._id, { deletedAt: undefined, active: true, isService: true, role: "admin" });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      email: SERVICE_EMAIL,
      emailVerified: true,
      name: SERVICE_NAME,
      role: "admin",
      team: "admin",
      active: true,
      isService: true,
    });
  },
});

export const invokeQuery = internalQuery({
  args: { fn: v.string(), args: v.any(), actor: actorValidator },
  handler: async (ctx, { fn, args, actor }) => {
    const r = REGISTRY[fn];
    if (!r || !r.isQuery) throw new Error(`Query non exposée : ${fn}`);
    if (r.exportArgs) validateArgs(r.exportArgs(), args ?? {});
    const a = await resolveActor(ctx, actor);
    return await r._handler!(withServiceActor(ctx, a), args ?? {});
  },
});

export const invokeMutation = internalMutation({
  args: { fn: v.string(), args: v.any(), actor: actorValidator },
  handler: async (ctx, { fn, args, actor }) => {
    const r = REGISTRY[fn];
    if (!r || !r.isMutation) throw new Error(`Mutation non exposée : ${fn}`);
    if (r.exportArgs) validateArgs(r.exportArgs(), args ?? {});
    const a = await resolveActor(ctx, actor);
    return await r._handler!(withServiceActor(ctx, a), args ?? {});
  },
});

export type ServiceUser = Doc<"users">;
