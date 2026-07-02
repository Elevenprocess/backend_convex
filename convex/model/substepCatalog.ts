import type { WorkflowPhase, WorkflowSubstepKey, DocumentType } from "./enums";

export type { WorkflowSubstepKey, DocumentType };

export interface SubstepDef {
  phase: WorkflowPhase;
  key: WorkflowSubstepKey;
  /** Ordre relatif À LA PHASE (1..n). */
  position: number;
  label: string;
  /** Libellé du bouton de validation, propre à chaque sous-étape. */
  actionLabel: string;
  /** Documents attendus (badge « pièce manquante » si manquants). Vide = aucun. */
  expectedDocs: DocumentType[];
  optional: boolean;
  /** Clés à `fait` pour « déverrouiller » (gating souple, non bloquant). */
  prerequisites: WorkflowSubstepKey[];
  /** Si défini : quand CETTE sous-étape passe `fait`, pose deadline +28j sur la cible. */
  slaTargetKey?: WorkflowSubstepKey;
  /**
   * Module « dépôt seul » : sa seule finalité est de recevoir une pièce. Le
   * pop-up masque Date / Notes / Technicien (rien que la zone de dépôt) et la
   * date de réalisation se renseigne au jour de l'upload.
   */
  depositOnly?: boolean;
}

/** Nombre de jours du délai SLA « ~4 semaines ». */
export const SLA_DAYS = 28;

/**
 * Catalogue aligné sur le Google Sheet "SUIVIS ADMINISTRATIVES".
 * Source fonctionnelle : colonnes PHOTO, STATUT DP, DATE DÉPOT DP,
 * Récépissé de dépôt (DP mairie), Prolongation, DP VALIDE (mairie),
 * Statut Raccordement, Date Dépot Raccordement, CONSUEL,
 * DATE DE DEPOT CONSUEL, CONSUEL reçu, ETAT DU DOSSIER, SOLTEO,
 * DOCUMENTS MANQUANTS.
 */
export const SUBSTEP_CATALOG: SubstepDef[] = [
  // ── Amont / VT ──
  { phase: 'vt', key: 'vt_planifie', position: 1, label: 'VT planifiée', actionLabel: 'Marquer planifiée', expectedDocs: [], optional: false, prerequisites: [] },
  { phase: 'vt', key: 'vt_attribuee', position: 2, label: 'Technicien attribué', actionLabel: 'Attribuer le technicien', expectedDocs: [], optional: false, prerequisites: [] },
  { phase: 'vt', key: 'vt_validee', position: 3, label: 'VT validée', actionLabel: 'Valider la VT', expectedDocs: ['rapport_vt'], optional: false, prerequisites: [] },

  // ── Déclaration préalable ──
  { phase: 'dp', key: 'dp_envoyee_mairie', position: 1, label: 'DP envoyée à la mairie / récépissé de dépôt', actionLabel: 'Marquer DP envoyée', expectedDocs: ['recepisse_dp'], optional: false, prerequisites: [], slaTargetKey: 'dp_validee' },
  { phase: 'dp', key: 'dp_validee', position: 2, label: 'DP validée / refusée — CNO ou retour mairie', actionLabel: 'Valider la DP / signaler un refus', expectedDocs: ['cno_dp'], optional: false, prerequisites: [] },

  // ── Raccordement ──
  { phase: 'racco', key: 'racco_envoye', position: 1, label: 'Raccordement envoyé / récépissé de raccordement', actionLabel: 'Marquer raccordement envoyé', expectedDocs: ['recepisse_racco'], optional: false, prerequisites: [], slaTargetKey: 'racco_validee' },
  { phase: 'racco', key: 'racco_validee', position: 2, label: 'Raccordement validé — CRAE', actionLabel: 'Marquer CRAE reçu', expectedDocs: ['crae'], optional: false, prerequisites: [], depositOnly: true },

  // ── Installation puis Consuel ──
  { phase: 'installation', key: 'install_a_faire', position: 1, label: 'Installation planifiée', actionLabel: "Planifier l'installation", expectedDocs: [], optional: false, prerequisites: [] },
  { phase: 'installation', key: 'install_effectuee', position: 2, label: 'Installé', actionLabel: 'Marquer installé', expectedDocs: [], optional: false, prerequisites: [] },

  // ── Consuel (après installation) ──
  { phase: 'consuel', key: 'consuel_a_faire', position: 1, label: 'Consuel envoyé', actionLabel: 'Marquer Consuel envoyé', expectedDocs: [], optional: false, prerequisites: [], slaTargetKey: 'consuel_valide' },
  { phase: 'consuel', key: 'consuel_valide', position: 2, label: 'Consuel validé', actionLabel: 'Marquer Consuel validé', expectedDocs: ['attestation_consuel'], optional: false, prerequisites: [] },

  // ── Mise en service / clôture ──
  { phase: 'mes', key: 'enquete_satisfaction', position: 1, label: 'ETAT DU DOSSIER / SOLTEO / DOCUMENTS MANQUANTS', actionLabel: 'Marquer mise en service réalisée', expectedDocs: [], optional: false, prerequisites: [] },
];

const BY_KEY: Map<WorkflowSubstepKey, SubstepDef> = new Map(
  SUBSTEP_CATALOG.map((def) => [def.key, def]),
);

export function catalogByKey(key: WorkflowSubstepKey): SubstepDef | undefined {
  return BY_KEY.get(key);
}

export function substepsForPhase(phase: WorkflowPhase): SubstepDef[] {
  return SUBSTEP_CATALOG.filter((def) => def.phase === phase).sort(
    (a, b) => a.position - b.position,
  );
}
