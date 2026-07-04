import type { WorkflowPhase } from './types'
import { PHASE_LABEL } from './suivi-board'
import type { PriorityRow } from './deliveryOverview'

export type PhaseGuideEntry = {
  /** Ce que la phase accomplit, en une phrase. */
  objectif: string
  /** Pièces attendues pendant la phase (libellés lisibles, cf. DOC_TYPE_LABEL). */
  docs: string[]
  /** Ce qui clôture la phase. */
  cloture: string
  /** Prochaine action attendue quand un dossier est à cette phase (file de travail). */
  action: string
  suivante: WorkflowPhase | null
}

/**
 * Guide statique du workflow délivrabilité, à destination des nouveaux :
 * alimente les popovers « ? » (tunnel Overview, sections WorkflowBoard) et les
 * libellés « prochaine action » de la file de travail. L'ordre des phases reste
 * porté par DELIVERY_PHASES / PHASE_ORDER — ici uniquement du texte.
 */
export const PHASE_GUIDE: Record<WorkflowPhase, PhaseGuideEntry> = {
  vt: {
    objectif: 'Vérifier la faisabilité technique du projet chez le client (visite technique).',
    docs: ['Rapport de VT'],
    cloture: 'VT validée par le technicien — sinon dossier bloqué / vente annulée.',
    action: 'Planifier ou valider la VT',
    suivante: 'dp',
  },
  dp: {
    objectif: "Obtenir l'accord d'urbanisme de la mairie (déclaration préalable), en parallèle du raccordement.",
    docs: ['Récépissé de DP', 'Certificat de non-opposition'],
    cloture: 'DP validée : certificat de non-opposition reçu.',
    action: 'Faire avancer la DP en mairie',
    suivante: 'racco',
  },
  racco: {
    objectif: "Demander le raccordement de l'installation au réseau Enedis, en parallèle de la DP.",
    docs: ['Récépissé de raccordement', 'CRAE'],
    cloture: 'Raccordement validé : CRAE reçu (en mode dépôt seul, cette étape est simplifiée).',
    action: 'Faire avancer le raccordement',
    suivante: 'installation',
  },
  installation: {
    objectif: 'Poser le matériel chez le client — date, heure et technicien(s) planifiés.',
    docs: [],
    cloture: "Installation effectuée — déclenche l'alerte du solde à encaisser.",
    action: "Planifier ou réaliser l'installation",
    suivante: 'consuel',
  },
  consuel: {
    objectif: "Faire certifier la conformité électrique de l'installation (après la pose).",
    docs: ['Attestation Consuel'],
    cloture: 'Attestation Consuel reçue.',
    action: 'Envoyer ou relancer le Consuel',
    suivante: 'mes',
  },
  mes: {
    objectif: "Mettre l'installation en service : le dossier est livré.",
    docs: [],
    cloture: 'Mise en service réalisée — le dossier passe en livré.',
    action: 'Réaliser la mise en service',
    suivante: null,
  },
}

/** Libellé « prochaine action » d'une ligne de la file de travail délivrabilité. */
export function nextActionLabel(row: PriorityRow): string {
  const phase = row.client.currentPhase
  if (row.reason === 'blocked') return `Débloquer — ${PHASE_LABEL[phase]}`
  if (row.reason === 'missing_docs') {
    const n = Math.max(1, row.client.missingDocsCount)
    return n > 1 ? `Compléter ${n} documents` : 'Compléter 1 document'
  }
  return PHASE_GUIDE[phase].action
}
