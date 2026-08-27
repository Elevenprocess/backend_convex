/**
 * Note contact GHL « débrief » : texte lisible poussé sur la fiche du prospect
 * à chaque débrief saisi dans Velora (in-app ou lien WhatsApp). Les
 * commerciaux et setters vivent dans GHL : l'info doit y être centralisée.
 * Rendu PUR (testable) — les libellés FR sont dupliqués du front
 * (frontend/src/lib/types.ts) pour ne pas dépendre de lui côté Convex.
 */
import { formatRdvForCommercial, cleanRemarkText } from "./prospectRemark";

const OUTCOME_LABEL: Record<string, string> = {
  vente: "VENTE",
  non_vente: "NON-VENTE",
  en_reflexion: "EN RÉFLEXION",
  suivi_prevu: "SUIVI PRÉVU",
};

const NON_SALE_REASON_LABEL: Record<string, string> = {
  suivi_prevu: "Suivi prévu",
  non_qualifie: "Non qualifié",
  no_show: "No-show",
  contact_annule: "Contact annulé",
  annulation_administrative: "Annulation administrative",
  pas_interesse: "Pas intéressé",
};

const REFLEXION_REASON_LABEL: Record<string, string> = {
  besoin_reflechir: "Besoin de réfléchir",
  consulter_partenaire: "Consulter conjoint·e / famille",
  comparer_concurrence: "Comparer avec la concurrence",
  budget_a_revoir: "Budget à revoir",
  attente_info_technique: "Attente info technique",
  delai_a_confirmer: "Délai à confirmer",
  autre: "Autre",
};

const SUIVI_REASON_LABEL: Record<string, string> = {
  rappel_programme: "Rappel programmé",
  pas_le_bon_moment: "Pas le bon moment",
  attend_devis_detaille: "Attend devis détaillé",
  besoin_info_technique: "Besoin info technique",
  autre: "Autre",
};

const ACCEPTANCE_FACTOR_LABEL: Record<string, string> = {
  prix_convenable: "Prix convenable",
  confiance_commercial: "Confiance commerciale",
  roi_rapide: "ROI rapide",
  garanties: "Garanties rassurantes",
  recommandation: "Recommandation",
  batterie_autonomie: "Batterie / autonomie",
  financement_attractif: "Financement attractif",
  aides_etat: "Aides d'État",
  engagement_ecolo: "Engagement écologique",
  autre: "Autre",
};

const FINANCING_TYPE_LABEL: Record<string, string> = {
  comptant: "Comptant",
  financement: "Financement",
  financement_sans_apport: "Financement sans apport",
  apport_financement: "Apport + financement",
  paiement_10x: "Paiement 10x",
  paiement_12x: "Paiement 12x",
};

const PAYMENT_SUB_METHOD_LABEL: Record<string, string> = {
  cheque: "Chèque",
  especes: "Espèces",
  virement: "Virement",
};

const FINANCING_ORG_LABEL: Record<string, string> = { cmoi: "CMOI", sofider: "Sofider" };

function lbl(map: Record<string, string>, value: string | null | undefined): string | null {
  if (!value) return null;
  return map[value] ?? value;
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

export type DebriefNoteInput = {
  outcome: string;
  nonSaleReason?: string | null;
  reflexionReason?: string | null;
  suiviReason?: string | null;
  objection?: string | null;
  acceptanceFactors?: string[] | null;
  notes?: string | null;
  montantTotal?: number | null;
  financingType?: string | null;
  paymentSubMethod?: string | null;
  financingOrg?: string | null;
  kits?: string | null;
  signedAt?: number | null;
  commercialName?: string | null;
  /** Date de saisie du débrief (ms epoch). */
  filledAt: number;
  /** Date du RDV débriefé (ms epoch), si rattaché à un RDV. */
  rdvAt?: number | null;
  /** True quand la note remplace une version précédente (débrief modifié). */
  updated?: boolean;
};

/** Texte multi-blocs de la note GHL (≤ 5000 caractères). */
export function buildDebriefNote(input: DebriefNoteInput): string {
  const header = [
    `DÉBRIEF RDV — Velora${input.updated ? " (mis à jour)" : ""}`,
    input.commercialName ? `Commercial : ${cleanRemarkText(input.commercialName)}` : null,
    `Saisi le : ${formatRdvForCommercial(input.filledAt)}`,
    input.rdvAt != null ? `RDV du : ${formatRdvForCommercial(input.rdvAt)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const isVente = input.outcome === "vente";
  const resultBits: string[] = [];
  if (isVente && input.montantTotal != null) resultBits.push(fmtEur(input.montantTotal));
  if (isVente) {
    const fin = [
      lbl(FINANCING_TYPE_LABEL, input.financingType),
      lbl(PAYMENT_SUB_METHOD_LABEL, input.paymentSubMethod) ?? lbl(FINANCING_ORG_LABEL, input.financingOrg),
    ].filter(Boolean);
    if (fin.length) resultBits.push(fin.join(" · "));
  }
  const resultLine = `RÉSULTAT : ${OUTCOME_LABEL[input.outcome] ?? input.outcome.toUpperCase()}${
    resultBits.length ? ` — ${resultBits.join(", ")}` : ""
  }`;

  const reason =
    input.outcome === "non_vente"
      ? lbl(NON_SALE_REASON_LABEL, input.nonSaleReason)
      : input.outcome === "en_reflexion"
        ? lbl(REFLEXION_REASON_LABEL, input.reflexionReason)
        : input.outcome === "suivi_prevu"
          ? lbl(SUIVI_REASON_LABEL, input.suiviReason)
          : null;
  const factors = (input.acceptanceFactors ?? []).map((f) => lbl(ACCEPTANCE_FACTOR_LABEL, f)).filter(Boolean);

  const details = [
    resultLine,
    reason ? `Motif : ${reason}` : null,
    input.objection ? `Objection : ${cleanRemarkText(input.objection)}` : null,
    factors.length ? `Facteurs d'acceptation : ${factors.join(", ")}` : null,
    input.kits ? `Kits : ${cleanRemarkText(input.kits)}` : null,
    isVente && input.signedAt != null ? `Signé le : ${formatRdvForCommercial(input.signedAt)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const notes = cleanRemarkText(input.notes);
  const blocks = [header, details, notes ? `REMARQUES DU COMMERCIAL\n${notes}` : null].filter(
    (b): b is string => Boolean(b && b.trim()),
  );
  return blocks.join("\n\n").trim().slice(0, 5000);
}
