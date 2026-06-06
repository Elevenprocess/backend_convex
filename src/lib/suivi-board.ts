import type { IconName } from '../components/Icon'
import type { ClientResponse, SubstepDocument, SubstepResponse, WorkflowPhase } from './types'

export type BoardColumn = { key: string; title: string; phases: WorkflowPhase[] }
export type BoardSection = {
  key: 'amont' | 'backoffice' | 'aval'
  title: string
  eyebrow: string
  layout: 'single' | 'parallel'
  phases?: WorkflowPhase[]
  columns?: BoardColumn[]
}

const PHASE_ORDER: WorkflowPhase[] = ['vt', 'dp', 'racco', 'consuel', 'installation', 'mes']

export const SUIVI_SECTIONS: BoardSection[] = [
  { key: 'amont', eyebrow: 'Technique', title: 'Préparation (VT + mandat)', layout: 'single', phases: ['vt'] },
  {
    key: 'backoffice', eyebrow: 'Back-office', title: 'Démarches administratives (en parallèle)', layout: 'parallel',
    columns: [
      { key: 'dp', title: 'Déclaration préalable', phases: ['dp'] },
      { key: 'racco_consuel', title: 'Raccordement → Consuel', phases: ['racco', 'consuel'] },
    ],
  },
  { key: 'aval', eyebrow: 'Technique', title: 'Installation & clôture', layout: 'single', phases: ['installation', 'mes'] },
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
  backoffice: { dp: SubstepResponse[]; racco_consuel: SubstepResponse[] }
  aval: SubstepResponse[]
}

export function groupSubsteps(subs: SubstepResponse[]): GroupedSubsteps {
  return {
    amont: inPhases(subs, ['vt']),
    backoffice: { dp: inPhases(subs, ['dp']), racco_consuel: inPhases(subs, ['racco', 'consuel']) },
    aval: inPhases(subs, ['installation', 'mes']),
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
}

/** Résumé pour la carte de la vue d'ensemble, dérivé du ClientResponse backend. */
export function clientCardSummary(client: ClientResponse | undefined): CardSummary | null {
  if (!client) return null
  return {
    phaseLabel: PHASE_LABEL[client.currentPhase],
    blocked: client.blocked,
    missingDocsCount: client.missingDocsCount ?? 0,
    delivered: client.steps?.mes?.status === 'fait',
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
