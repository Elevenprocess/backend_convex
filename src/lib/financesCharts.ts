import type { AcompteResponse } from './types'

export type MonthPoint = {
  /** YYYY-MM */
  month: string
  /** Σ cumulatif des encaissements jusqu'à ce mois (inclus). */
  cumulEncaisse: number
  /** Σ des montants non-encaissés à ce mois (tranches a_encaisser / en_retard / en_attente). */
  resteTotal: number
}

/**
 * Construit deux séries mensuelles à partir des AcompteResponse :
 * - cumulEncaisse : cumul croissant des montantReel des tranches `encaisse`,
 *   bucketé par mois de dateEncaissement.
 * - resteTotal : Σ resteAPayer de toutes les ventes (global, pas par mois) —
 *   affiché comme ligne plate représentant le restant dû total.
 *
 * Les mois sont déduits des dateEncaissement existantes + le mois courant.
 * Triés chronologiquement.
 */
export function buildEncaissementSeries(rows: AcompteResponse[]): MonthPoint[] {
  // Accumule les encaissements par mois YYYY-MM
  const byMonth: Map<string, number> = new Map()

  for (const a of rows) {
    for (const e of a.echeances) {
      if (e.statut !== 'encaisse' || !e.dateEncaissement) continue
      const month = e.dateEncaissement.slice(0, 7) // YYYY-MM
      const montant = Number(e.montantReel ?? e.montantPrevu ?? 0) || 0
      byMonth.set(month, (byMonth.get(month) ?? 0) + montant)
    }
  }

  if (byMonth.size === 0) return []

  // Trier les mois et calculer le cumul
  const months = [...byMonth.keys()].sort()

  // Reste total = Σ resteAPayer de toutes les ventes
  const resteTotal = rows.reduce((sum, a) => sum + (Number(a.resteAPayer ?? 0) || 0), 0)

  let cumul = 0
  return months.map((month) => {
    cumul += byMonth.get(month) ?? 0
    return { month, cumulEncaisse: cumul, resteTotal }
  })
}
