import { DebriefOutcome, DebriefNonSaleReason, LeadStatus } from "./enums";

// Portage verbatim de debrief-effects.ts (deriveLeadStatusFromDebrief).
// Retourne toujours un LeadStatus valide (signe | perdu | a_rappeler).
export function deriveLeadStatusFromDebrief(
  outcome: DebriefOutcome,
  nonSaleReason: DebriefNonSaleReason | null | undefined,
): Extract<LeadStatus, "signe" | "perdu" | "a_rappeler"> {
  if (outcome === "vente") return "signe";
  if (outcome === "en_reflexion" || outcome === "suivi_prevu") return "a_rappeler";
  // non_vente
  if (nonSaleReason === "suivi_prevu") return "a_rappeler";
  return "perdu";
}
