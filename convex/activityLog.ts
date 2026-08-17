/**
 * Journal d'activité — lecture (page « Historique »). L'écriture passe par
 * model/activity.ts (logActivity / logSystemActivity).
 *
 * Périmètre de lecture par rôle :
 *   admin, commercial_lead                    → tout
 *   setter_lead                               → setting + system (leads GHL) + ses actions
 *   responsable_technique/delivrabilite/back_office → delivrabilite + ses actions
 *   finances                                  → finances + delivrabilite + ses actions
 *   setter, commercial, technicien            → uniquement ses propres actions
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser, roleOf } from "./model/access";
import { ACTIVITY_DOMAINS, activityDomainValidator, type ActivityDomain, type Role } from "./model/enums";

type Scope = { kind: "all" } | { kind: "domains"; domains: ActivityDomain[] } | { kind: "own" };

export function scopeForRole(role: Role): Scope {
  switch (role) {
    case "admin":
    case "commercial_lead":
      return { kind: "all" };
    case "setter_lead":
      return { kind: "domains", domains: ["setting", "system"] };
    case "responsable_technique":
    case "delivrabilite":
    case "back_office":
      return { kind: "domains", domains: ["delivrabilite"] };
    case "finances":
      return { kind: "domains", domains: ["finances", "delivrabilite"] };
    default:
      return { kind: "own" };
  }
}

const listArgs = {
  paginationOpts: paginationOptsValidator,
  from: v.optional(v.number()), // ms inclus
  to: v.optional(v.number()), // ms inclus
  actorId: v.optional(v.id("users")),
  domain: v.optional(activityDomainValidator),
  entityType: v.optional(v.string()),
  // Filtre « type » de l'UI : famille de rôle de l'auteur (setter/commercial/délivrabilité…).
  actorRoles: v.optional(v.array(v.string())),
  leadId: v.optional(v.id("leads")),
  clientId: v.optional(v.id("clients")),
  search: v.optional(v.string()),
};

export const list = query({
  args: listArgs,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scope = scopeForRole(roleOf(user));

    // Périmètre : un non-manager ne voit que ses actions ; un manager d'équipe
    // ne voit que ses domaines (ou ses propres actions, quel que soit le domaine).
    let actorId = args.actorId;
    let allowedDomains: ActivityDomain[] | null = null;
    if (scope.kind === "own") {
      actorId = user._id;
    } else if (scope.kind === "domains") {
      const ownOnly = args.actorId !== undefined && args.actorId === user._id;
      if (!ownOnly) {
        allowedDomains = scope.domains;
        if (args.domain !== undefined && !scope.domains.includes(args.domain)) {
          // Domaine hors périmètre → rien.
          return { page: [], isDone: true, continueCursor: "" };
        }
      }
    }
    const domain: ActivityDomain | undefined =
      args.domain ?? (allowedDomains && allowedDomains.length === 1 ? allowedDomains[0] : undefined);

    const from = args.from ?? 0;
    const to = args.to ?? Number.MAX_SAFE_INTEGER;
    const search = args.search?.trim();

    // Prédicat résiduel (ce que l'index choisi ne couvre pas).
    const keep = (row: Doc<"activityLog">): boolean => {
      if (row.at < from || row.at > to) return false;
      if (actorId !== undefined && row.actorId !== actorId) return false;
      if (domain !== undefined && row.domain !== domain) return false;
      if (allowedDomains && !allowedDomains.includes(row.domain)) return false;
      if (args.entityType !== undefined && row.entityType !== args.entityType) return false;
      if (args.actorRoles !== undefined && !args.actorRoles.includes(row.actorRole ?? "")) return false;
      if (args.leadId !== undefined && row.leadId !== args.leadId) return false;
      if (args.clientId !== undefined && row.clientId !== args.clientId) return false;
      return true;
    };

    if (search) {
      const result = await ctx.db
        .query("activityLog")
        .withSearchIndex("search_summary", (q) => {
          let s = q.search("summary", search);
          if (domain !== undefined) s = s.eq("domain", domain);
          if (actorId !== undefined) s = s.eq("actorId", actorId);
          if (args.entityType !== undefined) s = s.eq("entityType", args.entityType);
          return s;
        })
        .paginate(args.paginationOpts);
      return { ...result, page: result.page.filter(keep) };
    }

    let q;
    if (actorId !== undefined) {
      const a = actorId;
      q = ctx.db.query("activityLog").withIndex("by_actor_at", (ix) => ix.eq("actorId", a).gte("at", from).lte("at", to));
    } else if (args.leadId !== undefined) {
      const l = args.leadId;
      q = ctx.db.query("activityLog").withIndex("by_lead_at", (ix) => ix.eq("leadId", l).gte("at", from).lte("at", to));
    } else if (args.clientId !== undefined) {
      const c = args.clientId;
      q = ctx.db.query("activityLog").withIndex("by_client_at", (ix) => ix.eq("clientId", c).gte("at", from).lte("at", to));
    } else if (domain !== undefined) {
      const d = domain;
      q = ctx.db.query("activityLog").withIndex("by_domain_at", (ix) => ix.eq("domain", d).gte("at", from).lte("at", to));
    } else {
      q = ctx.db.query("activityLog").withIndex("by_at", (ix) => ix.gte("at", from).lte("at", to));
    }
    const result = await q.order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.filter(keep) };
  },
});

/**
 * Historique d'une entité précise (fiche prospect / dossier) — borné, récent
 * d'abord. Même périmètre de rôle que `list`.
 */
export const forLead = query({
  args: { leadId: v.id("leads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const scope = scopeForRole(roleOf(user));
    const rows = await ctx.db
      .query("activityLog")
      .withIndex("by_lead_at", (ix) => ix.eq("leadId", args.leadId))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 500));
    if (scope.kind === "all") return rows;
    if (scope.kind === "own") return rows.filter((r) => r.actorId === user._id);
    return rows.filter((r) => r.actorId === user._id || scope.domains.includes(r.domain));
  },
});

/** Ce que le user connecté a le droit de voir — pilote les filtres du front. */
export const myScope = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const scope = scopeForRole(roleOf(user));
    const domains: ActivityDomain[] =
      scope.kind === "all" ? [...ACTIVITY_DOMAINS] : scope.kind === "domains" ? scope.domains : [];
    return {
      kind: scope.kind,
      domains,
      userId: user._id as Id<"users">,
    };
  },
});
