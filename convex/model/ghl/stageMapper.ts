/**
 * Mapping des 17 stages du pipeline GHL "1. CRM Vente 📊" vers le `LeadStatus`
 * du SaaS (10 valeurs). Réalité métier au 2026-05-15.
 *
 * Portage verbatim de `ECOI_backend/src/modules/webhooks/ghl-stage-mapper.ts`
 * (Tranche 8a). Le nom de stage GHL brut est aussi conservé en clair sur
 * `leads.ghlStageName` pour préserver la granularité côté UI (kanban 17
 * colonnes possible) sans polluer l'enum métier.
 *
 * Fonction pure → testable seule. Pas d'I/O.
 */

import type { LeadStatus } from "../enums";

/**
 * Drapeau optionnel propagé au caller pour qu'il puisse, en plus du status,
 * marquer le rdv lié (no_show / reporté) ou archiver le lead.
 */
export type GhlStageSideEffect = "rdv_no_show" | "rdv_reporte" | "archived";

export interface GhlStageMapping {
  readonly status: LeadStatus;
  readonly sideEffect?: GhlStageSideEffect;
}

// Référence : pipeline GHL `pw8ROH6ho0I4QhYZgbmV` location `djBlEHfSx8UmYXjUqhCS`.
export const GHL_STAGE_MAP: Record<string, GhlStageMapping> = {
  "0. Nouveaux Prospects 🌱": { status: "nouveau" },
  "1. Prospects Archivés 📦": { status: "perdu", sideEffect: "archived" },
  "2. Suivi & Relance 🔄": { status: "relance" },
  "3. Pas Qualifiés ❌": { status: "pas_qualifie" },
  "(BIS) Retour à l'Assistant 🔙": { status: "nouveau" },
  "4. Qualification Commerciale 📋": { status: "qualifie" },
  "(BIS) Prospects Attribués 🫴": { status: "qualifie" },
  "(BIS) En cours de traitement": { status: "qualifie" },
  "5. RDV Planifié 📅": { status: "rdv_pris" },
  "🙅‍♂️ (BIS) No-Show": {
    status: "perdu",
    sideEffect: "rdv_no_show",
  },
  "6. RDV Annulé 🛑": { status: "perdu" },
  "7. RDV Pas Qualifié ⚠️": { status: "perdu" },
  "8. RDV Reprogrammé 🔁": {
    status: "rdv_pris",
    sideEffect: "rdv_reporte",
  },
  "9. Relance Long Terme ⏳": { status: "perdu" },
  "10. Devis En Attente 📝": { status: "rdv_honore" },
  "10.5 Devis En Cours De Signature ✍️": { status: "signature_en_cours" },
  "11. Devis Signé ✍️": { status: "signe" },
  "12. Devis Perdu 💔": { status: "perdu" },
};

/**
 * Normalise un libellé GHL : trim + NFC + compresse les whitespaces internes.
 * Tolère ainsi `"  5. RDV  Planifié 📅 "` → `"5. RDV Planifié 📅"`.
 */
function normalize(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim();
}

const NORMALIZED_MAP: Map<string, GhlStageMapping> = new Map(
  Object.entries(GHL_STAGE_MAP).map(([k, v]) => [normalize(k), v]),
);

/**
 * Stages GHL « chemin positif » à partir du RDV planifié → population de la page
 * client. Exclut volontairement les RDV ratés (No-Show, RDV Annulé, RDV Pas
 * Qualifié) et la Relance Long Terme : un lead n'est « client » que sur ce chemin.
 */
export const CLIENT_VISIBLE_STAGES = [
  "5. RDV Planifié 📅",
  "8. RDV Reprogrammé 🔁",
  "10. Devis En Attente 📝",
  "10.5 Devis En Cours De Signature ✍️",
  "11. Devis Signé ✍️",
  "12. Devis Perdu 💔",
] as const;

const CLIENT_VISIBLE_NORMALIZED: ReadonlySet<string> = new Set(
  CLIENT_VISIBLE_STAGES.map(normalize),
);

/**
 * True si le stage GHL place le lead dans la population « page client » (chemin
 * positif RDV planifié → devis). Normalise le libellé → tolère espaces/NFC.
 */
export function isClientVisibleStage(stageName?: string | null): boolean {
  return !!stageName && CLIENT_VISIBLE_NORMALIZED.has(normalize(stageName));
}

/**
 * Statuts internes (`LeadStatus`) correspondant aux CLIENT_VISIBLE_STAGES. Dérivé
 * du mapping → utilisé comme superset du pré-filtre `scope=clients` sans risque
 * de drift : si CLIENT_VISIBLE_STAGES évolue, ce superset suit automatiquement.
 */
export const CLIENT_VISIBLE_STATUSES: readonly LeadStatus[] = [
  ...new Set(CLIENT_VISIBLE_STAGES.map((stage) => GHL_STAGE_MAP[stage].status)),
];

export interface MapResult {
  status: LeadStatus | null;
  sideEffect?: GhlStageSideEffect;
  isKnown: boolean;
  normalizedName: string | null;
}

/**
 * Mappe un nom de stage GHL vers un `LeadStatus` SaaS.
 *
 * - Si le stage est connu → `{status, isKnown:true, sideEffect?}`
 * - Si le stage est inconnu (futur ajout côté GHL) ou vide → `{status:null, isKnown:false}`.
 *   Le caller doit alors NE PAS écraser `leads.status`, mais toujours mettre à jour
 *   `leads.ghlStageName` et logger un warning.
 */
export function mapGhlStageToStatus(
  stageName: string | null | undefined,
): MapResult {
  if (!stageName || typeof stageName !== "string" || !stageName.trim()) {
    return { status: null, isKnown: false, normalizedName: null };
  }
  const normalized = normalize(stageName);
  const mapping = NORMALIZED_MAP.get(normalized);
  if (!mapping) {
    return { status: null, isKnown: false, normalizedName: normalized };
  }
  return {
    status: mapping.status,
    sideEffect: mapping.sideEffect,
    isKnown: true,
    normalizedName: normalized,
  };
}
