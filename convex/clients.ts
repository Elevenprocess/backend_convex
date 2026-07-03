/**
 * Dossiers délivrabilité (table clients) — queries de lecture.
 * Portage de ClientsController/ClientsService (NestJS), périmètre 6a :
 * list / getByProject / getByLead. Décor riche (missingDocs, gating,
 * currentStep détaillé) différé en 6b/6d.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  clientStatusValidator,
  workflowPhaseValidator,
  type Role,
} from "./model/enums";
import { requireRole } from "./model/access";

// ─── Rôles (portés de roles.decorator.ts + clients.controller.ts) ────────────

/** Équipe ops/délivrabilité (le rôle `delivrabilite` est deprecated mais conservé). */
export const DELIVRABILITE_ROLES: Role[] = [
  "delivrabilite",
  "responsable_technique",
  "back_office",
];

/** Écriture workflow : admin + délivrabilité + technicien. */
export const WORKFLOW_ROLES: Role[] = [
  "admin",
  ...DELIVRABILITE_ROLES,
  "technicien",
];

/** Lecture élargie : + finances et commerciaux (suivi de leurs clients signés). */
export const WORKFLOW_VIEW_ROLES: Role[] = [
  ...WORKFLOW_ROLES,
  "finances",
  "commercial",
  "commercial_lead",
];

/** Initialisation d'un dossier : écriture du module, hors technicien. */
export const BOOTSTRAP_ROLES: Role[] = ["admin", ...DELIVRABILITE_ROLES];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isActive(c: Doc<"clients">): boolean {
  return c.deletedAt === undefined;
}

async function findActiveByProject(
  ctx: QueryCtx,
  projectId: Doc<"projects">["_id"],
): Promise<Doc<"clients"> | null> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return rows.find(isActive) ?? null;
}

async function findActiveByLead(
  ctx: QueryCtx,
  leadId: Doc<"leads">["_id"],
): Promise<Doc<"clients"> | null> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  return rows.find(isActive) ?? null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    return await findActiveByProject(ctx, args.projectId);
  },
});

export const getByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    return await findActiveByLead(ctx, args.leadId);
  },
});

export const list = query({
  args: {
    leadId: v.optional(v.id("leads")),
    projectId: v.optional(v.id("projects")),
    phase: v.optional(workflowPhaseValidator),
    statusGlobal: v.optional(clientStatusValidator),
    blocked: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, WORKFLOW_VIEW_ROLES);

    // Choisir l'index le plus sélectif disponible, filtrer le reste en mémoire.
    let rows: Doc<"clients">[];
    if (args.projectId !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .collect();
    } else if (args.leadId !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_lead", (q) => q.eq("leadId", args.leadId!))
        .collect();
    } else if (args.statusGlobal !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_status", (q) => q.eq("statusGlobal", args.statusGlobal!))
        .collect();
    } else if (args.phase !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_phase", (q) => q.eq("currentPhase", args.phase!))
        .collect();
    } else if (args.blocked !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_blocked", (q) => q.eq("blocked", args.blocked!))
        .collect();
    } else {
      rows = await ctx.db.query("clients").collect();
    }

    return rows
      .filter(isActive)
      .filter((c) => args.statusGlobal === undefined || c.statusGlobal === args.statusGlobal)
      .filter((c) => args.phase === undefined || c.currentPhase === args.phase)
      .filter((c) => args.blocked === undefined || c.blocked === args.blocked)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});
