/**
 * Helpers ctx de création idempotente de dossier délivrabilité.
 * Portage de ClientsService.ensureDossier + recomputePhase/recomputeStatus (NestJS backend).
 *
 * Ces fonctions ÉCRIVENT en base : à appeler depuis des mutations uniquement.
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { FinancingType } from "./enums";
import {
  WORKFLOW_PHASE_ORDER,
  deriveClientStatus,
  derivePhaseStatus,
} from "./deriveDelivrabilite";
import { substepsForPhase } from "./substepCatalog";

// ─── Type de l'input ──────────────────────────────────────────────────────────

export type EnsureDossierInput = {
  leadId: Id<"leads">;
  projectId?: Id<"projects">;
  rdvId?: Id<"rdv">;
  /** Montant en euros (nombre, pas chaîne — contrairement au NestJS). */
  montantTotal?: number;
  typeFinancement?: FinancingType;
  kits?: string;
  /** Timestamp ms. Pas de Date.now() ici : vient de l'input ou est absent. */
  signedAt?: number;
  actorId?: Id<"users">;
};

// ─── ensureDossier ────────────────────────────────────────────────────────────

/**
 * Crée un dossier délivrabilité idempotent :
 * - Si un dossier actif (sans deletedAt) existe déjà pour le même projet (ou
 *   pour le même lead sans projet), le retourne en patchant les champs vente.
 * - Sinon, insère `clients` + 6 `workflowSteps` + 12 `workflowSubsteps` (tous
 *   `a_faire`) puis dérive les statuts (recomputePhase × 6 + recomputeClientStatus).
 */
export async function ensureDossier(
  ctx: MutationCtx,
  input: EnsureDossierInput,
): Promise<Id<"clients">> {
  // ── 1. IDEMPOTENCE ──────────────────────────────────────────────────────────
  if (input.projectId !== undefined) {
    // Clé d'idempotence : 1 dossier par projet
    const rows = await ctx.db
      .query("clients")
      .withIndex("by_project", (q) => q.eq("projectId", input.projectId!))
      .collect();
    const existing = rows.find((c) => c.deletedAt === undefined);
    if (existing) {
      await patchVenteFields(ctx, existing._id, input);
      return existing._id;
    }
  } else {
    // Clé d'idempotence : lead sans projet associé
    const rows = await ctx.db
      .query("clients")
      .withIndex("by_lead", (q) => q.eq("leadId", input.leadId))
      .collect();
    const existing = rows.find(
      (c) => c.projectId === undefined && c.deletedAt === undefined,
    );
    if (existing) {
      await patchVenteFields(ctx, existing._id, input);
      return existing._id;
    }
  }

  // ── 2. INSERTION ────────────────────────────────────────────────────────────
  const clientId = await ctx.db.insert("clients", {
    leadId: input.leadId,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.rdvId !== undefined ? { rdvId: input.rdvId } : {}),
    ...(input.montantTotal !== undefined
      ? { montantTotal: input.montantTotal }
      : {}),
    ...(input.typeFinancement !== undefined
      ? { typeFinancement: input.typeFinancement }
      : {}),
    ...(input.kits !== undefined ? { kits: input.kits } : {}),
    ...(input.signedAt !== undefined ? { signedAt: input.signedAt } : {}),
    // Dérivés initiaux (recalculés juste après le seed)
    statusGlobal: "nouveau",
    currentPhase: "vt",
    blocked: false,
  });

  // ── 3. SEEDING DU WORKFLOW ──────────────────────────────────────────────────
  const stepIds: Id<"workflowSteps">[] = [];
  for (const phase of WORKFLOW_PHASE_ORDER) {
    const stepId = await ctx.db.insert("workflowSteps", {
      clientId,
      phase,
      status: "a_faire",
    });
    stepIds.push(stepId);

    const defs = substepsForPhase(phase);
    for (const def of defs) {
      await ctx.db.insert("workflowSubsteps", {
        stepId,
        clientId,
        key: def.key,
        position: def.position,
        optional: def.optional,
        status: "a_faire",
      });
    }
  }

  // ── 4. DÉRIVATION INITIALE ──────────────────────────────────────────────────
  for (const stepId of stepIds) await recomputePhase(ctx, stepId);
  await recomputeClientStatus(ctx, clientId);

  return clientId;
}

// ─── recompute (scindé, parité NestJS) ───────────────────────────────────────
//
// Le statut d'un step n'est re-dérivé de ses substeps QUE quand une de ses
// substeps change (recomputePhase). Le client est TOUJOURS dérivé des statuts
// de steps STOCKÉS (recomputeClientStatus) — un step saisi/annulé à la main
// (ex. setSaleCancelled) ne doit jamais être écrasé par ses substeps.

/** Dérive le statut d'UN step depuis ses substeps et le patche. */
export async function recomputePhase(
  ctx: MutationCtx,
  stepId: Id<"workflowSteps">,
): Promise<void> {
  const substeps = await ctx.db
    .query("workflowSubsteps")
    .withIndex("by_step", (q) => q.eq("stepId", stepId))
    .collect();
  if (substeps.length === 0) return;
  const status = derivePhaseStatus(
    substeps.map((s) => ({ status: s.status, optional: s.optional })),
  );
  await ctx.db.patch(stepId, { status });
}

/** Dérive le client depuis les statuts de steps STOCKÉS (jamais re-dérivés ici). */
export async function recomputeClientStatus(
  ctx: MutationCtx,
  clientId: Id<"clients">,
): Promise<void> {
  const steps = await ctx.db
    .query("workflowSteps")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  const { statusGlobal, currentPhase, blocked } = deriveClientStatus(
    steps.map((s) => ({ phase: s.phase, status: s.status })),
  );
  await ctx.db.patch(clientId, { statusGlobal, currentPhase, blocked });
}

// ─── Helper privé ─────────────────────────────────────────────────────────────

/** Patch les champs vente fournis sans écraser les champs absents de l'input. */
async function patchVenteFields(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  input: EnsureDossierInput,
): Promise<void> {
  const patch: Partial<{
    montantTotal: number;
    typeFinancement: FinancingType;
    kits: string;
    signedAt: number;
  }> = {};
  if (input.montantTotal !== undefined) patch.montantTotal = input.montantTotal;
  if (input.typeFinancement !== undefined)
    patch.typeFinancement = input.typeFinancement;
  if (input.kits !== undefined) patch.kits = input.kits;
  if (input.signedAt !== undefined) patch.signedAt = input.signedAt;
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(clientId, patch);
  }
}
