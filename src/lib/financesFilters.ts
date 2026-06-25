import type { AcompteResponse } from './types'

/**
 * Filtre côté client les ventes (AcompteResponse[]) par date d'encaissement.
 * Conserve une vente si elle a ≥ 1 tranche `encaisse` dont la `dateEncaissement`
 * tombe dans [from, to] (inclusif). Si from ou to est null/vide, la borne est ouverte.
 *
 * @param rows  liste brute (toutes les ventes)
 * @param from  borne inférieure YYYY-MM-DD incluse, ou null
 * @param to    borne supérieure YYYY-MM-DD incluse, ou null
 */
export function filterAcomptesByEncaissementDate(
  rows: AcompteResponse[],
  from: string | null,
  to: string | null,
): AcompteResponse[] {
  // Si aucun filtre, retourner tout
  if (!from && !to) return rows

  return rows.filter((a) =>
    a.echeances.some((e) => {
      if (e.statut !== 'encaisse') return false
      const d = e.dateEncaissement
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    }),
  )
}
