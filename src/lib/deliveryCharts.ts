import type { ClientResponse, WorkflowPhase } from './types'
import { DELIVERY_PHASES } from './deliveryOverview'
import { PHASE_LABEL } from './suivi-board'

// Palette séquentielle vert → cuivre alignée sur le thème Velora : chaque phase
// du tunnel a sa teinte, la mise en service (livré) reprend le vert « succès ».
export const PHASE_COLOR: Record<WorkflowPhase, string> = {
  vt: '#145A41',
  dp: '#1F7857',
  racco: '#3E9A6F',
  installation: '#B59241',
  consuel: '#CFB063',
  mes: '#3DA86A',
}

const TERMINAL_STATUSES = new Set(['annule', 'cloture'])

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export type PhaseSlice = { phase: WorkflowPhase; label: string; count: number; color: string }

/**
 * Répartition NON cumulative des dossiers actifs par phase COURANTE (annulés /
 * clôturés exclus) — pour le donut « où en sont les dossiers ». À distinguer du
 * tunnel cumulatif de buildDeliveryPipeline (chaque phase franchie compte).
 */
export function currentPhaseDistribution(clients: ClientResponse[]): PhaseSlice[] {
  const counts = Object.fromEntries(DELIVERY_PHASES.map((p) => [p, 0])) as Record<WorkflowPhase, number>
  for (const c of clients) {
    if (TERMINAL_STATUSES.has(c.statusGlobal)) continue
    if (counts[c.currentPhase] != null) counts[c.currentPhase] += 1
  }
  return DELIVERY_PHASES.map((phase) => ({
    phase,
    label: PHASE_LABEL[phase],
    count: counts[phase],
    color: PHASE_COLOR[phase],
  }))
}

export type MonthlyDelivery = { month: string; label: string; installed: number; delivered: number }

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

/**
 * Série mensuelle sur les `monthsBack` derniers mois (borne = `now`) :
 * installations posées (steps.installation.dateRealisee) et mises en service
 * (steps.mes.dateRealisee). Buckets pré-initialisés → mois vides à zéro, ordre
 * chronologique croissant. Terminaux inclus : une livraison passée reste une
 * livraison même si le dossier est clôturé depuis.
 */
export function deliveriesByMonth(
  clients: ClientResponse[],
  monthsBack: number,
  now: Date,
): MonthlyDelivery[] {
  const buckets = new Map<string, MonthlyDelivery>()
  const order: string[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    buckets.set(key, { month: key, label: monthLabel(d), installed: 0, delivered: 0 })
    order.push(key)
  }
  const bump = (value: string | null | undefined, field: 'installed' | 'delivered') => {
    const d = parseDate(value)
    if (!d) return
    const bucket = buckets.get(monthKey(d))
    if (bucket) bucket[field] += 1
  }
  for (const c of clients) {
    bump(c.steps?.installation?.dateRealisee, 'installed')
    bump(c.steps?.mes?.dateRealisee, 'delivered')
  }
  return order.map((k) => buckets.get(k)!)
}
