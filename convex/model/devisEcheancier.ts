// ─── Échéancier issu du DEVIS signé ──────────────────────────────────────────
// Le devis Solteo (OCR) porte les conditions de règlement réelles :
// `echeancier[{label, phase, montant}]`. Quand un devis signé en dispose,
// c'est LUI la source de vérité du plan de tranches — pas le template
// générique 40/20/20/20 (cf. acompteEcheancier.ts, qui reste le fallback).
// Chaque tranche du devis est rattachée au jalon workflow (workflow_substeps)
// correspondant par mots-clés, pour que le suivi dossier déclenche le passage
// « à encaisser » exactement comme pour les templates.

import { WorkTemplate, EcheanceJalonOrNull } from "./acompteEcheancier";

// Ligne brute d'échéancier telle que stockée dans devis.echeancier (v.any()) :
// issue du LLM, tout est optionnel/à valider.
export type DevisEcheanceRow = {
  label?: unknown;
  phase?: unknown;
  montant?: unknown;
  [k: string]: unknown;
};

// Normalisation accents/casse pour le matching mots-clés.
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Mappe une échéance de devis (label + phase libres) vers un jalon workflow.
 * Vocabulaire Solteo/transcription : « à la signature », « validation
 * technique », « réception du CNO », « fin de pose »… Retourne null si aucun
 * jalon reconnu (tranche suivie manuellement, statut en_attente par défaut).
 * L'ordre des tests va du plus spécifique au plus générique (ex. « planification
 * de pose » doit matcher avant « pose »).
 */
export function jalonFromDevisEcheance(
  label: string | null,
  phase: string | null,
): EcheanceJalonOrNull {
  const text = fold([label ?? "", phase ?? ""].join(" "));
  if (!text.trim()) return null;

  // Signature / commande / acompte à la commande → dû d'emblée.
  if (/signature|commande|acompte initial|a la reservation/.test(text)) {
    return "signature";
  }
  // Visite / validation technique.
  if (/\bvt\b|visite technique|validation technique/.test(text)) {
    return "vt_validee";
  }
  // Urbanisme : réception CNO / DP validée / accord mairie.
  if (/\bcno\b|non[- ]opposition|dp validee|accord mairie|acceptation mairie|autorisation (d')?urbanisme/.test(text)) {
    return "dp_validee";
  }
  // Envoi DP mairie (avant validation).
  if (/\bdp\b|declaration prealable|depot mairie/.test(text)) {
    return "dp_envoyee_mairie";
  }
  // Planification de la pose (avant travaux).
  if (/planification|debut (de |des )?(pose|travaux|chantier)|demarrage/.test(text)) {
    return "install_a_faire";
  }
  // Fin de pose / installation / livraison / fin de chantier.
  if (/pose|installation|travaux|chantier|livraison/.test(text)) {
    return "install_effectuee";
  }
  // Raccordement / mise en service / consuel / EDF.
  if (/raccordement|racco|mise en service|consuel|recepisse|edf/.test(text)) {
    return "racco_validee";
  }
  return null;
}

// Montant LLM : number attendu, mais on tolère la string numérique ("4 500,00").
function parseMontant(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.,-]/g, "").replace(/,/g, "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Construit les WorkTemplate depuis l'échéancier extrait d'un devis signé.
 *
 * Règles de robustesse (données LLM) :
 *  - chaque ligne doit avoir un montant > 0 ; UNE seule ligne invalide →
 *    échéancier inexploitable → [] (l'appelant retombe sur le template).
 *  - si Σ montants ≈ montantTotal du débrief (±1 € ou ±0,5 %) → montants du
 *    devis repris tels quels (montantOverride).
 *  - sinon (devis en TTC vs débrief en net, prime déduite…) → on conserve les
 *    PROPORTIONS du devis, appliquées au montantTotal via percent (la dernière
 *    tranche absorbe les arrondis côté assembleEcheancier).
 *  - pas de montantTotal connu → montants du devis tels quels.
 */
export function templatesFromDevisEcheancier(
  echeancier: unknown,
  montantTotal: number | null,
): WorkTemplate[] {
  if (!Array.isArray(echeancier) || echeancier.length === 0) return [];

  const rows: Array<{ label: string; jalonKey: EcheanceJalonOrNull; montant: number }> = [];
  for (let i = 0; i < echeancier.length; i++) {
    const raw = echeancier[i] as DevisEcheanceRow | null;
    if (raw === null || typeof raw !== "object") return [];
    const montant = parseMontant(raw.montant);
    if (montant === null || montant <= 0) return [];
    const label =
      typeof raw.label === "string" && raw.label.trim()
        ? raw.label.trim()
        : `Échéance ${i + 1}`;
    const phase = typeof raw.phase === "string" ? raw.phase : null;
    rows.push({ label, jalonKey: jalonFromDevisEcheance(label, phase), montant });
  }

  const sum = rows.reduce((acc, r) => acc + r.montant, 0);
  if (sum <= 0) return [];

  const matchesTotal =
    montantTotal != null &&
    montantTotal > 0 &&
    Math.abs(sum - montantTotal) <= Math.max(1, montantTotal * 0.005);
  const useRawAmounts = montantTotal == null || montantTotal <= 0 || matchesTotal;

  return rows.map((r, idx) => {
    const percent = Math.round((r.montant / sum) * 100 * 100) / 100;
    return {
      ordre: idx + 1,
      label: r.label,
      jalonKey: r.jalonKey,
      percent,
      ...(useRawAmounts ? { montantOverride: r.montant } : {}),
    };
  });
}
