/**
 * Étapes de workflow délivrabilité (une par phase).
 * Portage de WorkflowStepsService (NestJS) : lecture scopée par rôle,
 * update avec garde-fous fins + audit, resolveProblem.
 *
 * Parité NestJS : le statut d'un step est une SAISIE — seul le client est
 * re-dérivé après mutation (recomputeClientStatus), jamais le step depuis
 * ses substeps ici.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  workflowStatusValidator,
  workflowPhaseValidator,
  problemReasonValidator,
} from "./model/enums";
import { requireRole } from "./model/access";
import { WORKFLOW_ROLES, WORKFLOW_VIEW_ROLES } from "./clients";
import { can, canEditStep, visibleClientIds } from "./model/delivrabilitePermissions";
import { recomputeClientStatus } from "./model/ensureDossier";
import { insertAudit } from "./model/audit";

export const list = query({
  args: {
    clientId: v.optional(v.id("clients")),
    phase: v.optional(workflowPhaseValidator),
    status: v.optional(workflowStatusValidator),
    responsableId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    let rows: Doc<"workflowSteps">[];
    if (args.clientId !== undefined) {
      rows = await ctx.db
        .query("workflowSteps")
        .withIndex("by_client", (q) => q.eq("clientId", args.clientId!))
        .collect();
    } else if (args.status !== undefined) {
      rows = await ctx.db
        .query("workflowSteps")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      rows = await ctx.db.query("workflowSteps").collect();
    }
    const visible = await visibleClientIds(ctx, user);
    return rows
      .filter((s) => visible === null || visible.has(s.clientId))
      .filter((s) => args.phase === undefined || s.phase === args.phase)
      .filter((s) => args.status === undefined || s.status === args.status)
      .filter((s) => args.responsableId === undefined || s.responsableId === args.responsableId)
      .sort((a, b) => a.clientId.localeCompare(b.clientId) || a._creationTime - b._creationTime);
  },
});

export const get = query({
  args: { stepId: v.id("workflowSteps") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    const row = await ctx.db.get(args.stepId);
    if (!row) return null;
    const visible = await visibleClientIds(ctx, user);
    // Hors périmètre → null (le 404 NestJS ne fuit pas l'existence).
    if (visible !== null && !visible.has(row.clientId)) return null;
    return row;
  },
});

// Champs effaçables : null → champ retiré (parité `'x' in dto` NestJS).
type StepUpdateArgs = {
  status?: Doc<"workflowSteps">["status"];
  datePlanifiee?: string | null;
  dateRealisee?: string | null;
  deadline?: string | null;
  responsableId?: Id<"users"> | null;
  notes?: string | null;
  problemReason?: Doc<"workflowSteps">["problemReason"] | null;
  problemNotes?: string | null;
  metadata?: unknown;
};

async function applyStepUpdate(
  ctx: MutationCtx,
  stepId: Id<"workflowSteps">,
  args: StepUpdateArgs,
): Promise<Doc<"workflowSteps">> {
  const user = await requireRole(ctx, WORKFLOW_ROLES);
  const before = await ctx.db.get(stepId);
  if (!before) throw new Error(`Workflow step ${stepId} introuvable`);

  const client = await ctx.db.get(before.clientId);
  const clientTechnicienVtId = client?.technicienVtId ?? null;
  const role = user.role ?? "setter";

  if (!canEditStep(user, { phase: before.phase, clientTechnicienVtId })) {
    throw new Error(`Rôle ${role} non autorisé à modifier une étape ${before.phase}`);
  }
  const reassigns =
    args.responsableId !== undefined && (args.responsableId ?? undefined) !== before.responsableId;
  if (reassigns && !can(role, "assign")) {
    throw new Error(`Rôle ${role} non autorisé à (ré)assigner une étape`);
  }
  const nextStatus = args.status ?? before.status;
  if (
    before.status === "probleme" &&
    nextStatus !== "probleme" &&
    !can(role, "resolve_problem", before.phase)
  ) {
    throw new Error(`Rôle ${role} non autorisé à résoudre un problème en phase ${before.phase}`);
  }

  const patch: Record<string, unknown> = {};
  if (args.status !== undefined) patch.status = args.status;
  if (args.datePlanifiee !== undefined) patch.datePlanifiee = args.datePlanifiee ?? undefined;
  if (args.dateRealisee !== undefined) patch.dateRealisee = args.dateRealisee ?? undefined;
  if (args.deadline !== undefined) patch.deadline = args.deadline ?? undefined;
  if (args.responsableId !== undefined) patch.responsableId = args.responsableId ?? undefined;
  if (args.notes !== undefined) patch.notes = args.notes ?? undefined;
  if (args.problemReason !== undefined) patch.problemReason = args.problemReason ?? undefined;
  if (args.problemNotes !== undefined) patch.problemNotes = args.problemNotes ?? undefined;
  if (args.metadata !== undefined) patch.metadata = args.metadata;
  if (before.status === "probleme" && nextStatus !== "probleme") patch.problemResolvedAt = Date.now();

  await ctx.db.patch(stepId, patch);

  if (args.status !== undefined && args.status !== before.status) {
    await insertAudit(ctx, {
      userId: user._id,
      action: "workflow_status_changed",
      entityType: "workflow_step",
      entityId: stepId,
      before: { status: before.status },
      after: { status: args.status },
    });
  }

  await recomputeClientStatus(ctx, before.clientId);
  return (await ctx.db.get(stepId))!;
}

export const update = mutation({
  args: {
    stepId: v.id("workflowSteps"),
    status: v.optional(workflowStatusValidator),
    datePlanifiee: v.optional(v.union(v.null(), v.string())),
    dateRealisee: v.optional(v.union(v.null(), v.string())),
    deadline: v.optional(v.union(v.null(), v.string())),
    responsableId: v.optional(v.union(v.null(), v.id("users"))),
    notes: v.optional(v.union(v.null(), v.string())),
    problemReason: v.optional(v.union(v.null(), problemReasonValidator)),
    problemNotes: v.optional(v.union(v.null(), v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, { stepId, ...rest }) => applyStepUpdate(ctx, stepId, rest),
});

export const resolveProblem = mutation({
  args: { stepId: v.id("workflowSteps"), status: workflowStatusValidator },
  handler: async (ctx, args) =>
    applyStepUpdate(ctx, args.stepId, { status: args.status, problemReason: null }),
});
