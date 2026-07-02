/**
 * Helpers purs de dérivation délivrabilité.
 * Portage verbatim de :
 *   - derive-status.ts       → WORKFLOW_PHASE_ORDER, deriveClientStatus
 *   - derive-phase-status.ts → derivePhaseStatus
 *
 * Fonctions pures (pas de ctx/db) : testables directement sans convex-test.
 * Les types réutilisent ceux de ./enums (WorkflowPhase / WorkflowStatus /
 * ClientStatus) qui sont identiques aux types NestJS.
 */

import type { WorkflowPhase, WorkflowStatus, ClientStatus } from "./enums";

// ─── WORKFLOW_PHASE_ORDER ──────────────────────────────────────────────────────
// Ordre FONCTIONNEL de dérivation (install AVANT consuel — diffère de l'ordre
// de déclaration du pgEnum Postgres du backend).
export const WORKFLOW_PHASE_ORDER: readonly WorkflowPhase[] = [
  "vt",
  "dp",
  "racco",
  "installation",
  "consuel",
  "mes",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowStepForStatus = {
  phase: WorkflowPhase;
  status: WorkflowStatus;
};

export type SubstepForStatus = {
  status: WorkflowStatus;
  optional: boolean;
};

export type DerivedClientStatus = {
  statusGlobal: ClientStatus;
  currentPhase: WorkflowPhase;
  blocked: boolean;
};

// ─── deriveClientStatus ───────────────────────────────────────────────────────

export function deriveClientStatus(
  steps: WorkflowStepForStatus[],
): DerivedClientStatus {
  const byPhase = Object.fromEntries(
    steps.map((step) => [step.phase, step]),
  ) as Partial<Record<WorkflowPhase, WorkflowStepForStatus>>;

  const blocked = steps.some((step) => step.status === "probleme");
  const currentPhase =
    WORKFLOW_PHASE_ORDER.find((phase) => byPhase[phase]?.status !== "fait") ??
    "mes";

  let statusGlobal: ClientStatus;
  if (steps.some((step) => step.status === "annule")) {
    statusGlobal = "annule";
  } else if (
    WORKFLOW_PHASE_ORDER.every((phase) => byPhase[phase]?.status === "fait")
  ) {
    statusGlobal = "cloture";
  } else if (byPhase.installation?.status === "fait") {
    statusGlobal = "installe_en_attente_mes";
  } else if (byPhase.installation?.status === "planifie") {
    statusGlobal = "installation_planifiee";
  } else if (blocked) {
    statusGlobal = "bloque";
  } else if (byPhase.vt?.status === "fait") {
    statusGlobal = "administratif_en_cours";
  } else if (
    byPhase.vt?.status === "a_faire" ||
    byPhase.vt?.status === "planifie"
  ) {
    statusGlobal = "vt_a_faire";
  } else {
    statusGlobal = "nouveau";
  }

  return { statusGlobal, currentPhase, blocked };
}

// ─── derivePhaseStatus ────────────────────────────────────────────────────────
/**
 * Rollup pur des sous-étapes vers le statut de la phase parente.
 * Priorité : annule > probleme > en_attente > fait > en_cours > a_faire.
 * `annule` est TERMINAL (VT non validée → vente annulée) : une seule sous-étape
 * annulée annule la phase, ce qui bascule tout le dossier en `annule` via
 * deriveClientStatus. Les sous-étapes optionnelles restées `a_faire` sont
 * ignorées pour « tout fait ».
 */
export function derivePhaseStatus(substeps: SubstepForStatus[]): WorkflowStatus {
  if (substeps.length === 0) return "a_faire";
  if (substeps.some((s) => s.status === "annule")) return "annule";
  if (substeps.some((s) => s.status === "probleme")) return "probleme";
  if (substeps.some((s) => s.status === "en_attente")) return "en_attente";

  const required = substeps.filter((s) => !s.optional);
  const meaningful = required.length > 0 ? required : substeps;

  if (meaningful.every((s) => s.status === "fait")) return "fait";
  if (substeps.some((s) => s.status === "fait" || s.status === "en_cours")) {
    return "en_cours";
  }
  return "a_faire";
}
