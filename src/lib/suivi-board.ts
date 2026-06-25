import type { IconName } from '../components/Icon'
import type { ClientResponse, SubstepDocument, SubstepResponse, WorkflowPhase, WorkflowSubstepKey } from './types'

export type BoardColumn = { key: string; title: string; phases: WorkflowPhase[] }
export type BoardSection = {
  key: 'amont' | 'backoffice' | 'aval'
  title: string
  eyebrow: string
  layout: 'single' | 'parallel'
  phases?: WorkflowPhase[]
  columns?: BoardColumn[]
}

const PHASE_ORDER: WorkflowPhase[] = ['vt', 'dp', 'racco', 'installation', 'consuel', 'mes']

export const SUIVI_SECTIONS: BoardSection[] = [
  { key: 'amont', eyebrow: 'Technique', title: 'Préparation (VT + mandat)', layout: 'single', phases: ['vt'] },
  {
    key: 'backoffice', eyebrow: 'Back-office', title: 'Démarches administratives (en parallèle)', layout: 'parallel',
    columns: [
      { key: 'dp', title: 'Déclaration préalable', phases: ['dp'] },
      { key: 'racco', title: 'Raccordement EDF', phases: ['racco'] },
    ],
  },
  { key: 'aval', eyebrow: 'Technique', title: 'Installation & clôture', layout: 'single', phases: ['installation', 'consuel', 'mes'] },
]

export const PHASE_ICON: Record<WorkflowPhase, IconName> = {
  vt: 'home', dp: 'mail', racco: 'shield', consuel: 'check', installation: 'settings', mes: 'sparkles',
}

function sortByPhaseThenPosition(a: SubstepResponse, b: SubstepResponse): number {
  const pa = PHASE_ORDER.indexOf(a.phase)
  const pb = PHASE_ORDER.indexOf(b.phase)
  return pa !== pb ? pa - pb : a.position - b.position
}

function inPhases(subs: SubstepResponse[], phases: WorkflowPhase[]): SubstepResponse[] {
  return subs.filter((s) => phases.includes(s.phase)).sort(sortByPhaseThenPosition)
}

export type GroupedSubsteps = {
  amont: SubstepResponse[]
  backoffice: { dp: SubstepResponse[]; racco: SubstepResponse[] }
  aval: SubstepResponse[]
}

export function groupSubsteps(subs: SubstepResponse[]): GroupedSubsteps {
  return {
    amont: inPhases(subs, ['vt']),
    backoffice: { dp: inPhases(subs, ['dp']), racco: inPhases(subs, ['racco']) },
    aval: inPhases(subs, ['installation', 'consuel', 'mes']),
  }
}

export type SlaGauge = { daysLeft: number; label: string; tone: 'ok' | 'soon' | 'late' }

export function slaGaugeInfo(deadline: string | null, today: string): SlaGauge | null {
  if (!deadline) return null
  const d = Date.parse(`${deadline}T00:00:00Z`)
  const t = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(d) || Number.isNaN(t)) return null
  const daysLeft = Math.round((d - t) / 86_400_000)
  let label: string
  if (daysLeft > 0) label = `J-${daysLeft}`
  else if (daysLeft === 0) label = "Aujourd'hui"
  else label = `Retard J+${-daysLeft}`
  const tone: SlaGauge['tone'] = daysLeft > 7 ? 'ok' : daysLeft > 0 ? 'soon' : 'late'
  return { daysLeft, label, tone }
}

export function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Description propre à chaque module du workflow, affichée dans son pop-up.
 * Permet à l'équipe délivrabilité de savoir précisément ce qu'attend l'étape —
 * chaque sous-étape (notamment back-office DP / racco / consuel) a la sienne.
 */
export const SUBSTEP_DESCRIPTION: Record<WorkflowSubstepKey, string> = {
  vt_planifie: "Planifier la visite technique (idéalement sous 72h) et prévenir le technicien.",
  vt_attribuee: "Attribuer la VT à un technicien : il appelle le client avant de se déplacer.",
  vt_validee: "Le technicien réalise la VT et confirme la faisabilité. Si non validée → devis perdu.",
  vt_mandat: "Faire signer le mandat de représentation pour les démarches administratives.",
  dp_a_faire: "Préparer la déclaration préalable de travaux (DP) à déposer en mairie.",
  dp_envoyee_mairie: "DP déposée/envoyée à la mairie ; déposer ici le récépissé de dépôt.",
  dp_validee: "Certificat de non-opposition (CNO) reçu de la mairie. Si refus → devis perdu.",
  dp_prolongation: "Optionnel : prolongation du délai d'instruction de la DP si la mairie le demande.",
  racco_a_faire: "Demande de raccordement EDF (Enedis) à constituer : prise de notes et dépôt des documents.",
  racco_envoye: "Récépissé de dépôt : déposer ici le récépissé de dépôt de la demande de raccordement.",
  racco_validee: "Raccordement EDF validé : déposer le CRAE (contrat de raccordement, accès exploitation).",
  racco_completude: "Attestation de complétude du raccordement : déposer le document.",
  consuel_a_faire: "Consuel envoyé à l'organisme — délai ~4 semaines avant validation.",
  consuel_valide: "Consuel validé (contrôle de conformité après installation) : déposer l'attestation Consuel.",
  install_a_faire: "Planifier l'installation avec l'équipe de pose. Planifiable sans attendre DP/Consuel.",
  install_effectuee: "Installation réalisée (début/fin de pose) ; point client effectué.",
  enquete_satisfaction: "Enquête de satisfaction après mise en service et clôture qualité du dossier.",
}

export const PHASE_LABEL: Record<WorkflowPhase, string> = {
  vt: 'Visite technique',
  dp: 'Déclaration préalable',
  racco: 'Raccordement',
  consuel: 'Consuel',
  installation: 'Installation',
  mes: 'Mise en service',
}

export type CardSummary = {
  phaseLabel: string
  blocked: boolean
  missingDocsCount: number
  delivered: boolean
  installed: boolean
}

/** Résumé pour la carte de la vue d'ensemble, dérivé du ClientResponse backend. */
export function clientCardSummary(client: ClientResponse | undefined): CardSummary | null {
  if (!client) return null
  return {
    phaseLabel: PHASE_LABEL[client.currentPhase],
    blocked: client.blocked,
    missingDocsCount: client.missingDocsCount ?? 0,
    delivered: client.steps?.mes?.status === 'fait',
    installed: client.steps?.installation?.status === 'fait',
  }
}

export type WorkflowProgress = { pct: number; done: number; total: number; phaseLabel: string }

/**
 * Progression du workflow délivrabilité d'un projet, dérivée du dossier
 * (ClientResponse). Basée sur les 6 phases : une phase compte comme faite
 * quand son statut est `fait`. Léger (pas de substeps) — pour les cartes projet.
 */
export function workflowPhaseProgress(client: ClientResponse | undefined): WorkflowProgress | null {
  if (!client) return null
  const total = PHASE_ORDER.length
  const done = PHASE_ORDER.reduce((n, ph) => (client.steps?.[ph]?.status === 'fait' ? n + 1 : n), 0)
  return {
    pct: total ? Math.round((done / total) * 100) : 0,
    done,
    total,
    phaseLabel: PHASE_LABEL[client.currentPhase],
  }
}

export type FileKind = 'pdf' | 'image' | 'doc'

/** Catégorie d'aperçu déduite du mimeType (vignette du hub documentaire). */
export function fileKind(mimeType: string): FileKind {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  return 'doc'
}

export type DocStatus = { present: SubstepDocument[]; missingTypes: string[] }

/** Pour une sous-étape : pièces présentes + types attendus encore absents. */
export function substepDocStatus(substep: SubstepResponse): DocStatus {
  const presentTypes = new Set(substep.documents.map((d) => d.type))
  return {
    present: substep.documents,
    missingTypes: substep.expectedDocs.filter((t) => !presentTypes.has(t)),
  }
}
