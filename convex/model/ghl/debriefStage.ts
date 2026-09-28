/**
 * Étape GHL visée après un débrief. Les commerciaux ne déplacent presque jamais
 * l'opportunité après le RDV : elle reste sur « RDV Planifié » alors que Velora
 * a le lead « à relancer ». Seul le débrief « suivi prévu / en réflexion » est
 * poussé (vers « Retour aux Setters ») ; vente et non-vente définitive ne le
 * sont PAS : leurs étapes GHL (Devis Signé, No-Show, Pas qualifié…) déclenchent
 * des workflows GHL côté client/CAPI qu'on ne doit pas lancer à l'aveugle.
 *
 * Fonction pure → testable seule.
 */
import type { DebriefNonSaleReason, DebriefOutcome } from "../enums";
import { RETOUR_SETTERS_STAGE } from "./stageMapper";

/** Étapes « RDV à venir » que le débrief rend périmées. Toute autre étape
 *  (Devis en attente, No-Show, Signé…) a été posée par un humain : on n'y touche pas. */
export const STALE_RDV_STAGES = ["5. RDV Planifié 📅", "8. RDV Reprogrammé 🔁"] as const;

export function debriefTargetStage(
  outcome: DebriefOutcome,
  nonSaleReason: DebriefNonSaleReason | null | undefined,
): string | null {
  if (outcome === "en_reflexion" || outcome === "suivi_prevu") return RETOUR_SETTERS_STAGE;
  if (outcome === "non_vente" && nonSaleReason === "suivi_prevu") return RETOUR_SETTERS_STAGE;
  return null;
}

function normalize(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isStaleRdvStage(stageName: string | null | undefined): boolean {
  return !!stageName && STALE_RDV_STAGES.some((s) => normalize(s) === normalize(stageName));
}
