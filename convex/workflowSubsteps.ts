/**
 * Sous-étapes de workflow délivrabilité.
 * Portage de SubstepsService (NestJS), hors documents/import (6d) :
 * lecture scopée + flag unlocked, update avec garde-fous fins (dont
 * cancel_sale), audit, chaîne recompute substep → step → client.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { workflowStatusValidator, workflowPhaseValidator, problemReasonValidator } from "./model/enums";
import { requireRole } from "./model/access";
import { WORKFLOW_ROLES, WORKFLOW_VIEW_ROLES } from "./clients";
import { can, canEditSubstep, visibleClientIds } from "./model/delivrabilitePermissions";
import { recomputePhase, recomputeClientStatus } from "./model/ensureDossier";
import { catalogByKey } from "./model/substepCatalog";
import { isSubstepUnlocked, computeSlaDeadline, missingDocuments } from "./model/substepGating";
import { activeDocsOfSubstep, toDocumentSummary } from "./documents";
import { insertAudit } from "./model/audit";
import { shouldNotifyVtDateChange } from "./model/notifMessages";
import { notifyAcompte, notifyVtDateChange } from "./model/notify";

/** Décore une substep : unlocked (sœurs), documents actifs et badge pièce manquante. */
async function decorate(ctx: QueryCtx, row: Doc<"workflowSubsteps">) {
  const siblings = await ctx.db
    .query("workflowSubsteps")
    .withIndex("by_client", (q) => q.eq("clientId", row.clientId))
    .collect();
  const unlocked = isSubstepUnlocked(
    row.key,
    siblings.map((s) => ({ key: s.key, status: s.status })),
  );
  const docs = await activeDocsOfSubstep(ctx, row._id);
  const missingDocument = missingDocuments(row.key, docs.map((d) => d.type));
  return { ...row, unlocked, documents: docs.map(toDocumentSummary), missingDocument };
}

export const list = query({
  args: {
    clientId: v.optional(v.id("clients")),
    status: v.optional(workflowStatusValidator),
    responsableId: v.optional(v.id("users")),
    phase: v.optional(workflowPhaseValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    let rows: Doc<"workflowSubsteps">[];
    if (args.clientId !== undefined) {
      rows = await ctx.db
        .query("workflowSubsteps")
        .withIndex("by_client", (q) => q.eq("clientId", args.clientId!))
        .collect();
    } else if (args.status !== undefined) {
      rows = await ctx.db
        .query("workflowSubsteps")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      rows = await ctx.db.query("workflowSubsteps").collect();
    }
    const visible = await visibleClientIds(ctx, user);
    const filtered = rows
      .filter((s) => visible === null || visible.has(s.clientId))
      .filter((s) => args.status === undefined || s.status === args.status)
      .filter((s) => args.responsableId === undefined || s.responsableId === args.responsableId)
      .filter((s) => args.phase === undefined || catalogByKey(s.key)?.phase === args.phase)
      .sort((a, b) => a.clientId.localeCompare(b.clientId) || a.position - b.position);
    return await Promise.all(filtered.map((r) => decorate(ctx, r)));
  },
});

export const get = query({
  args: { substepId: v.id("workflowSubsteps") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    const row = await ctx.db.get(args.substepId);
    if (!row) return null;
    const visible = await visibleClientIds(ctx, user);
    if (visible !== null && !visible.has(row.clientId)) return null;
    return await decorate(ctx, row);
  },
});

// Champs effaçables : null → champ retiré (parité `'x' in dto` NestJS).
type SubstepUpdateArgs = {
  status?: Doc<"workflowSubsteps">["status"];
  dateRealisee?: string | null;
  heure?: string | null;
  responsableId?: Id<"users"> | null;
  notes?: string | null;
  problemReason?: Doc<"workflowSubsteps">["problemReason"] | null;
  problemNotes?: string | null;
  metadata?: unknown;
};

async function applySubstepUpdate(
  ctx: MutationCtx,
  substepId: Id<"workflowSubsteps">,
  args: SubstepUpdateArgs,
): Promise<Doc<"workflowSubsteps">> {
  const user = await requireRole(ctx, WORKFLOW_ROLES);
  const before = await ctx.db.get(substepId);
  if (!before) throw new Error(`Sous-étape ${substepId} introuvable`);

  const client = await ctx.db.get(before.clientId);
  const clientTechnicienVtId = client?.technicienVtId ?? null;
  const phase = catalogByKey(before.key)?.phase ?? "vt";
  const role = user.role ?? "setter";

  if (!canEditSubstep(user, { phase, clientTechnicienVtId })) {
    throw new Error(`Rôle ${role} non autorisé à modifier une sous-étape ${phase}`);
  }
  const reassigns =
    args.responsableId !== undefined && (args.responsableId ?? undefined) !== before.responsableId;
  if (reassigns && !can(role, "assign")) {
    throw new Error(`Rôle ${role} non autorisé à (ré)assigner`);
  }
  const nextStatus = args.status ?? before.status;
  if (before.status === "probleme" && nextStatus !== "probleme" && !can(role, "resolve_problem", phase)) {
    throw new Error(`Rôle ${role} non autorisé à résoudre un problème ${phase}`);
  }
  // (Dés)annuler la vente est réservé au back-office / resp. technique / admin.
  if ((nextStatus === "annule") !== (before.status === "annule") && !can(role, "cancel_sale")) {
    throw new Error(`Rôle ${role} non autorisé à (dés)annuler la vente`);
  }

  const patch: Record<string, unknown> = {};
  if (args.status !== undefined) patch.status = args.status;
  if (args.dateRealisee !== undefined) patch.dateRealisee = args.dateRealisee ?? undefined;
  if (args.heure !== undefined) patch.heure = args.heure ?? undefined;
  if (args.responsableId !== undefined) patch.responsableId = args.responsableId ?? undefined;
  if (args.notes !== undefined) patch.notes = args.notes ?? undefined;
  if (args.problemReason !== undefined) patch.problemReason = args.problemReason ?? undefined;
  if (args.problemNotes !== undefined) patch.problemNotes = args.problemNotes ?? undefined;
  if (args.metadata !== undefined) patch.metadata = args.metadata;
  if (before.status === "probleme" && nextStatus !== "probleme") patch.problemResolvedAt = Date.now();

  await ctx.db.patch(substepId, patch);
  const updated = (await ctx.db.get(substepId))!;

  // SLA : si la substep modifiée est un déclencheur, pose/efface la deadline
  // sur sa cible (même dossier). fait → dateRealisee + 28j, sinon effacée.
  const def = catalogByKey(before.key);
  if (def?.slaTargetKey) {
    const deadline =
      updated.status === "fait" ? computeSlaDeadline(updated.dateRealisee ?? null) : null;
    const target = await ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client_key", (q) =>
        q.eq("clientId", before.clientId).eq("key", def.slaTargetKey!),
      )
      .first();
    if (target) await ctx.db.patch(target._id, { deadline: deadline ?? undefined });
  }

  if (args.status !== undefined && args.status !== before.status) {
    await insertAudit(ctx, {
      userId: user._id,
      action: "workflow_substep_status_changed",
      entityType: "workflow_substep",
      entityId: substepId,
      before: { status: before.status },
      after: { status: updated.status },
    });
  }

  await recomputePhase(ctx, before.stepId);
  await recomputeClientStatus(ctx, before.clientId);

  // ── Effets jalon (best-effort, jamais bloquants) ────────────────────────────
  if (
    shouldNotifyVtDateChange({
      key: before.key,
      beforeDate: before.dateRealisee ?? null,
      nextDate: args.dateRealisee !== undefined ? args.dateRealisee : undefined,
    })
  ) {
    await notifyVtDateChange(ctx, before.clientId, updated.dateRealisee ?? null);
  }
  // Transition idempotente : uniquement au passage ≠fait → fait.
  if (
    before.status !== "fait" &&
    updated.status === "fait" &&
    (updated.key === "vt_validee" || updated.key === "install_effectuee")
  ) {
    await notifyAcompte(ctx, before.clientId, updated.key);
  }

  return updated;
}

export const update = mutation({
  args: {
    substepId: v.id("workflowSubsteps"),
    status: v.optional(workflowStatusValidator),
    dateRealisee: v.optional(v.union(v.null(), v.string())),
    heure: v.optional(v.union(v.null(), v.string())),
    responsableId: v.optional(v.union(v.null(), v.id("users"))),
    notes: v.optional(v.union(v.null(), v.string())),
    problemReason: v.optional(v.union(v.null(), problemReasonValidator)),
    problemNotes: v.optional(v.union(v.null(), v.string())),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, { substepId, ...rest }) => applySubstepUpdate(ctx, substepId, rest),
});

export const resolveProblem = mutation({
  args: { substepId: v.id("workflowSubsteps"), status: workflowStatusValidator },
  handler: async (ctx, args) =>
    applySubstepUpdate(ctx, args.substepId, { status: args.status, problemReason: null }),
});
