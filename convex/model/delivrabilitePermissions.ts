/**
 * Permissions du module délivrabilité.
 * Portage de delivrabilite-permissions.ts (NestJS) ; les filtres SQL
 * visible*Where deviennent un resolver d'ids (visibleClientIds).
 */

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { WorkflowPhase } from "./enums";
import { roleOf } from "./access";

export type DeliveryAction = "view" | "edit" | "assign" | "resolve_problem" | "cancel_sale";
export type DeliveryRole = "admin" | "responsable_technique" | "back_office" | "technicien" | "commercial";

// Phases terrain pilotées par le technicien (le reste = paperasse).
const FIELD_PHASES: WorkflowPhase[] = ["vt", "installation"];

/**
 * Normalise un rôle texte vers un rôle délivrabilité connu.
 * `delivrabilite` est déprécié (split responsable_technique + back_office)
 * mais conservé dans l'enum : traité comme responsable_technique.
 * Renvoie null pour tout rôle hors module (setter, finances, …).
 */
export function normalizeRole(role: string): DeliveryRole | null {
  switch (role) {
    case "admin":
      return "admin";
    case "responsable_technique":
    case "delivrabilite": // @deprecated
      return "responsable_technique";
    case "back_office":
      return "back_office";
    case "technicien":
      return "technicien";
    // Commercial (vendeur) et commercial_lead : accès LECTURE SEULE au suivi.
    // Le scoping « ses propres clients » vs « tous » se fait sur le rôle brut
    // dans visibleClientIds.
    case "commercial":
    case "commercial_lead":
      return "commercial";
    default:
      return null;
  }
}

/**
 * Capacité STATIQUE : ce rôle peut-il faire `action` (sur `phase` si pertinent) ?
 * Le scoping dynamique du technicien (assignation) est appliqué par canEditStep.
 */
export function can(role: string, action: DeliveryAction, phase?: WorkflowPhase): boolean {
  const r = normalizeRole(role);
  if (r === null) return false;
  // admin, responsable_technique et back_office : full write sur tout le module.
  if (r === "admin" || r === "responsable_technique" || r === "back_office") return true;
  // commercial / commercial_lead : LECTURE SEULE.
  if (r === "commercial") return action === "view";
  // technicien : terrain uniquement (vt/installation), scopé via canEditStep.
  switch (action) {
    case "view":
      return true;
    case "edit":
      return phase ? FIELD_PHASES.includes(phase) : false;
    default:
      return false;
  }
}

/** Capacité + scoping : ce user peut-il éditer une étape de CE dossier ? */
export function canEditStep(
  user: { _id: Id<"users">; role?: string },
  step: { phase: WorkflowPhase; clientTechnicienVtId: Id<"users"> | null },
): boolean {
  const role = user.role ?? "setter";
  if (!can(role, "edit", step.phase)) return false;
  if (normalizeRole(role) === "technicien") {
    return step.clientTechnicienVtId === user._id;
  }
  return true;
}

/** Droits d'édition d'une sous-étape = droits de SA phase parente. */
export const canEditSubstep = canEditStep;

/**
 * Visibilité des dossiers — source UNIQUE partagée par clients.ts (list/
 * getByProject/getByLead/vtCalendar) ET workflowSteps/Substeps. null = tout voir.
 *
 * Technicien : dossiers actifs où il est technicien VT (scalaire) OU responsable
 * d'une étape `installation` (il pose sans forcément avoir fait la VT). Commercial
 * (pas commercial_lead : supervision d'équipe) : dossiers actifs de SES leads.
 *
 * Avant, clients.ts et ce module avaient deux définitions divergentes : un
 * technicien de pose voyait le dossier dans la liste mais pas ses étapes. Unifié.
 */
export async function visibleClientIds(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<Set<Id<"clients">> | null> {
  const role = roleOf(user);
  if (normalizeRole(role) === "technicien") {
    const out = new Set<Id<"clients">>();
    const rows = await ctx.db.query("clients").collect();
    for (const c of rows) {
      if (c.deletedAt === undefined && c.technicienVtId === user._id) out.add(c._id);
    }
    // Responsable d'une pose (étape installation) sur un dossier qu'il n'a pas en VT.
    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_responsable", (q) => q.eq("responsableId", user._id))
      .collect();
    for (const s of steps) if (s.phase === "installation") out.add(s.clientId);
    return out;
  }
  if (role === "commercial") {
    const rows = await ctx.db.query("clients").collect();
    const out = new Set<Id<"clients">>();
    for (const c of rows) {
      if (c.deletedAt !== undefined) continue;
      const lead = await ctx.db.get(c.leadId);
      if (lead?.assignedToId === user._id) out.add(c._id);
    }
    return out;
  }
  return null;
}
