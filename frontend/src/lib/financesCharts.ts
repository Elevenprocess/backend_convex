import type { AcompteResponse } from './types'

export type MonthPoint = {
  /** YYYY-MM */
  month: string
  /** Σ cumulatif des encaissements jusqu'à ce mois (inclus). */
  cumulEncaisse: number
  /** Σ restant à encaisser après les encaissements cumulés du mois. */
  resteTotal: number
}

function toNumber(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function monthKey(date: string | null | undefined): string | null {
  if (!date || date.length < 7) return null
  return date.slice(0, 7)
}

function addMonths(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(year, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(start: string, end: string): string[] {
  const out: string[] = []
  let cursor = start
  for (let guard = 0; cursor <= end && guard < 180; guard += 1) {
    out.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return out
}

/**
 * Construit une courbe financière logique à partir des vraies échéances :
 *
 * - `cumulEncaisse` additionne les tranches réellement encaissées, groupées par
 *   mois de `dateEncaissement`.
 * - `resteTotal` part du total prévu et diminue avec le cumul encaissé.
 * - La série contient tous les mois entre le début et la fin de période, même
 *   s'il n'y a aucun encaissement sur un mois, pour éviter des courbes cassées
 *   ou trompeuses.
 * - Si une période est sélectionnée, on affiche la fenêtre demandée, mais le
 *   cumul tient compte des encaissements antérieurs afin que le reste démarre au
 *   bon niveau.
 */
export function buildEncaissementSeries(
  rows: AcompteResponse[],
  from?: string | null,
  to?: string | null,
): MonthPoint[] {
  if (rows.length === 0) return []

  const encaisseByMonth: Map<string, number> = new Map()
  const allMonths = new Set<string>()
  let totalPlanned = 0

  for (const a of rows) {
    const echeancesTotal = a.echeances.reduce((sum, e) => {
      if (e.statut === 'annule') return sum
      return sum + toNumber(e.montantPrevu)
    }, 0)
    totalPlanned += echeancesTotal || toNumber(a.montantTotal)

    for (const e of a.echeances) {
      if (e.statut !== 'encaisse') continue
      const paidMonth = monthKey(e.dateEncaissement)
      if (!paidMonth) continue
      const montant = toNumber(e.montantReel) || toNumber(e.montantPrevu)
      encaisseByMonth.set(paidMonth, (encaisseByMonth.get(paidMonth) ?? 0) + montant)
      allMonths.add(paidMonth)
    }
  }

  if (totalPlanned <= 0 && encaisseByMonth.size === 0) return []

  const todayMonth = new Date().toISOString().slice(0, 7)
  const fromMonth = monthKey(from)
  const toMonth = monthKey(to)
  const sortedDataMonths = [...allMonths].sort()
  const startMonth = fromMonth ?? sortedDataMonths[0] ?? todayMonth
  const endMonth = toMonth ?? sortedDataMonths[sortedDataMonths.length - 1] ?? todayMonth
  const months = (fromMonth || toMonth) ? monthRange(startMonth, endMonth) : sortedDataMonths

  let cumulBeforeWindow = 0
  for (const [month, montant] of encaisseByMonth.entries()) {
    if (month < startMonth) cumulBeforeWindow += montant
  }

  let cumul = cumulBeforeWindow
  return months.map((month) => {
    cumul += encaisseByMonth.get(month) ?? 0
    return {
      month,
      cumulEncaisse: cumul,
      resteTotal: Math.max(0, totalPlanned - cumul),
    }
  })
}
