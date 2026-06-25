import type { ClientPhaseStep, ClientResponse, WorkflowPhase } from './types'

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Généralise isVtEnRetard (technicienStats.ts) à n'importe quelle phase. */
export function isStepLate(step: ClientPhaseStep, now: Date): boolean {
  if (step.status === 'probleme') return true
  if (step.status !== 'planifie') return false
  const planned = parseDate(step.datePlanifiee)
  return planned != null && planned.getTime() < now.getTime()
}

export const DELIVERY_PHASES: WorkflowPhase[] = ['vt', 'dp', 'racco', 'installation', 'consuel', 'mes']

export type PhaseCounts = { count: number; late: number; missingDocs: number }
export type DeliveryPipeline = {
  phases: Record<WorkflowPhase, PhaseCounts>
  activeCount: number
  lateCount: number
  missingDocsCount: number
  toDeliverCount: number
}

type DateRange = { from: Date; to: Date }

// Dossiers HORS pipeline de livraison : annulés (VT non validée → vente annulée)
// et clôturés (déjà livrés). Ils ne comptent ni en « actifs » ni dans le tunnel.
const TERMINAL_STATUSES = new Set(['annule', 'cloture'])

function clientIsLate(c: ClientResponse, now: Date): boolean {
  return Object.values(c.steps).some((s) => s != null && isStepLate(s, now))
}

/**
 * Pipeline de livraison à partir de TOUS les dossiers délivrabilité actifs
 * (annulés/clôturés exclus, pas de filtre par date de signature). Le tunnel est
 * CUMULATIF : un dossier compte dans chaque phase qu'il a atteinte ou franchie
 * (jusqu'à sa phase courante incluse), pour un véritable entonnoir.
 */
export function buildDeliveryPipeline(clients: ClientResponse[], now: Date): DeliveryPipeline {
  const phases = Object.fromEntries(
    DELIVERY_PHASES.map((p) => [p, { count: 0, late: 0, missingDocs: 0 }]),
  ) as Record<WorkflowPhase, PhaseCounts>

  let activeCount = 0
  let lateCount = 0
  let missingDocsCount = 0
  let toDeliverCount = 0

  for (const c of clients) {
    if (TERMINAL_STATUSES.has(c.statusGlobal)) continue
    activeCount += 1

    // Tunnel cumulatif : +1 sur chaque phase jusqu'à la phase courante incluse.
    const curIdx = DELIVERY_PHASES.indexOf(c.currentPhase)
    for (let i = 0; i <= curIdx; i++) phases[DELIVERY_PHASES[i]].count += 1

    // Alertes (retard / docs) rattachées à la phase COURANTE (où le dossier est).
    const bucket = phases[c.currentPhase]
    const late = clientIsLate(c, now)
    if (late) { lateCount += 1; if (bucket) bucket.late += 1 }
    if (c.missingDocsCount > 0) { missingDocsCount += 1; if (bucket) bucket.missingDocs += 1 }

    const isDelivered = c.steps.mes?.status === 'fait'
    if ((c.currentPhase === 'installation' || c.currentPhase === 'mes') && !isDelivered) {
      toDeliverCount += 1
    }
  }

  return { phases, activeCount, lateCount, missingDocsCount, toDeliverCount }
}

export type PriorityReason = 'blocked' | 'late' | 'missing_docs'
export type PriorityRow = { client: ClientResponse; reason: PriorityReason; lateSince: number | null }

function earliestLateTime(c: ClientResponse, now: Date): number | null {
  let earliest: number | null = null
  for (const s of Object.values(c.steps)) {
    if (s == null || !isStepLate(s, now)) continue
    const d = parseDate(s.datePlanifiee)
    const t = d != null ? d.getTime() : now.getTime()
    if (earliest == null || t < earliest) earliest = t
  }
  return earliest
}

export function selectDeliveryPriorities(clients: ClientResponse[], now: Date): PriorityRow[] {
  const rows: PriorityRow[] = []
  for (const c of clients) {
    if (TERMINAL_STATUSES.has(c.statusGlobal)) continue
    const lateSince = earliestLateTime(c, now)
    if (c.blocked) rows.push({ client: c, reason: 'blocked', lateSince })
    else if (lateSince != null) rows.push({ client: c, reason: 'late', lateSince })
    else if (c.missingDocsCount > 0) rows.push({ client: c, reason: 'missing_docs', lateSince: null })
  }
  const rank: Record<PriorityReason, number> = { blocked: 0, late: 1, missing_docs: 2 }
  return rows.sort((a, b) => {
    if (rank[a.reason] !== rank[b.reason]) return rank[a.reason] - rank[b.reason]
    if (a.lateSince != null && b.lateSince != null) return a.lateSince - b.lateSince
    return b.client.missingDocsCount - a.client.missingDocsCount
  })
}

export function selectRecentDeliveries(clients: ClientResponse[], range: DateRange): ClientResponse[] {
  return clients
    .filter((c) => {
      if (c.currentPhase !== 'mes') return false
      const d = parseDate(c.steps.mes?.dateRealisee ?? null)
      return d != null && d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime()
    })
    .sort((a, b) => {
      const da = parseDate(a.steps.mes?.dateRealisee ?? null)?.getTime() ?? 0
      const db = parseDate(b.steps.mes?.dateRealisee ?? null)?.getTime() ?? 0
      return db - da
    })
}
