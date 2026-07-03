/**
 * Dossiers délivrabilité (table clients) — queries de lecture.
 * Portage de ClientsController/ClientsService (NestJS), périmètre 6a :
 * list / getByProject / getByLead. Décor riche (missingDocs, gating,
 * currentStep détaillé) différé en 6b/6d.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  clientStatusValidator,
  workflowPhaseValidator,
  type Role,
} from "./model/enums";
import { requireRole } from "./model/access";
import { ensureDossier, recomputeClientStatus } from "./model/ensureDossier";
import { can } from "./model/delivrabilitePermissions";
import { newlyAddedTechs } from "./model/vtCalendar";
import { vtAssignedMessage } from "./model/notifMessages";
import { createNotification } from "./model/notify";

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

/** Techniciens de la jonction, avec noms (ordre d'insertion). */
export async function techniciensOf(
  ctx: QueryCtx,
  clientId: Id<"clients">,
): Promise<Array<{ id: Id<"users">; name: string }>> {
  const rows = await ctx.db
    .query("vtTechniciens")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  const out: Array<{ id: Id<"users">; name: string }> = [];
  for (const r of rows) {
    const u = await ctx.db.get(r.userId);
    out.push({ id: r.userId, name: u?.name ?? "" });
  }
  return out;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Attribution multi-techniciens VT (portage PATCH /clients/:id).
 * `technicienVtIds` prioritaire ; repli sur le scalaire `technicienVtId` ;
 * set vide = désassignation. Le scalaire clients.technicienVtId = premier du
 * set (rétro-compat, pilote le scoping steps/substeps). Notifie uniquement
 * les techniciens NOUVELLEMENT assignés.
 */
export const assignTechniciens = mutation({
  args: {
    clientId: v.id("clients"),
    technicienVtIds: v.optional(v.array(v.id("users"))),
    technicienVtId: v.optional(v.union(v.null(), v.id("users"))),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    if (!can(user.role ?? "setter", "assign")) {
      throw new Error(`Rôle ${user.role} non autorisé à attribuer un technicien`);
    }
    const existing = await ctx.db.get(args.clientId);
    if (!existing || existing.deletedAt !== undefined) {
      throw new Error(`Client ${args.clientId} introuvable`);
    }

    // Normalisation : liste prioritaire, repli scalaire, sinon désassignation.
    const nextIds =
      args.technicienVtIds && args.technicienVtIds.length > 0
        ? args.technicienVtIds
        : args.technicienVtId
          ? [args.technicienVtId]
          : [];
    const primaryTechId = nextIds[0];

    // Remplacement complet du set (seule écriture de la jonction → unicité garantie).
    const currentRows = await ctx.db
      .query("vtTechniciens")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    const previousIds = currentRows.map((r) => r.userId as string);
    for (const r of currentRows) await ctx.db.delete(r._id);
    for (const userId of nextIds) {
      await ctx.db.insert("vtTechniciens", { clientId: args.clientId, userId });
    }
    await ctx.db.patch(args.clientId, { technicienVtId: primaryTechId ?? undefined });

    await recomputeClientStatus(ctx, args.clientId);

    // Notifie chaque technicien NOUVELLEMENT assigné (best-effort).
    const newTechs = newlyAddedTechs(previousIds, nextIds as string[]);
    if (newTechs.length > 0) {
      const lead = await ctx.db.get(existing.leadId);
      const leadName =
        [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Client";
      const { title, body } = vtAssignedMessage({ leadName, city: lead?.city ?? null });
      for (const userId of newTechs) {
        await createNotification(ctx, {
          userId: userId as Id<"users">,
          type: "vt_assigned",
          title,
          body,
          payload: { clientId: args.clientId, leadId: existing.leadId },
        });
      }
    }

    const updated = (await ctx.db.get(args.clientId))!;
    return { ...updated, techniciens: await techniciensOf(ctx, args.clientId) };
  },
});

/**
 * Initialisation manuelle d'un dossier délivrabilité (portage de
 * POST /clients/bootstrap). projectId fourni → dossier scopé au projet
 * (leadId résolu depuis le projet) ; sinon dossier legacy scopé au lead.
 * Idempotent via ensureDossier.
 */
export const bootstrap = mutation({
  args: {
    leadId: v.optional(v.id("leads")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, BOOTSTRAP_ROLES);

    if (args.leadId === undefined && args.projectId === undefined) {
      throw new Error("leadId ou projectId requis");
    }

    let leadId = args.leadId;
    if (args.projectId !== undefined) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.deletedAt !== undefined) {
        throw new Error(`Projet ${args.projectId} introuvable`);
      }
      leadId = leadId ?? project.leadId;
    }

    const lead = await ctx.db.get(leadId!);
    if (!lead || lead.deletedAt !== undefined) {
      throw new Error(`Lead ${leadId} introuvable`);
    }

    return await ensureDossier(ctx, {
      leadId: leadId!,
      projectId: args.projectId,
      actorId: actor._id,
    });
  },
});
