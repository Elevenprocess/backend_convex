// Moyennes d'activité setter pour l'Analytics admin.
// Calcul 100 % à partir des vraies lignes `setters` du backend
// (AnalyticsAdminSummary.setters), déjà scopées à la période sélectionnée.
// Aucun chiffre inventé : moyenne = somme réelle ÷ nombre de setters actifs.

import type { AnalyticsSetterPerf } from './types'

export type SetterAverages = {
  /** Setters ayant réellement travaillé sur la période (appels, leads traités ou RDV). */
  activeSetters: number
  /** Tous les setters connus, actifs ou non. */
  totalSetters: number
  /** Somme des appels logiques (réels + déduits) sur la période. */
  totalCalls: number
  /** Somme des RDV pris sur la période. */
  totalRdv: number
  /** Appels moyens par setter actif. */
  avgCallsPerSetter: number
  /** RDV moyens par setter actif. */
  avgRdvPerSetter: number
  /** Appels moyens par setter actif et par jour de la période. */
  avgCallsPerSetterPerDay: number
  /** RDV moyens par setter actif et par jour de la période. */
  avgRdvPerSetterPerDay: number
  /** Transformation moyenne appel → RDV (%) sur l'ensemble des setters actifs. */
  rdvPerCallRate: number
}

/** Un setter compte comme actif s'il a au moins un appel, un lead traité ou un RDV. */
function isActiveSetter(s: AnalyticsSetterPerf): boolean {
  return (s.calls ?? 0) > 0 || (s.classified ?? 0) > 0 || (s.rdvPris ?? 0) > 0
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function computeSetterAverages(setters: AnalyticsSetterPerf[], days: number): SetterAverages {
  const active = setters.filter(isActiveSetter)
  const n = active.length
  const safeDays = Math.max(1, Math.round(days || 0))
  const totalCalls = active.reduce((sum, s) => sum + (s.calls ?? 0), 0)
  const totalRdv = active.reduce((sum, s) => sum + (s.rdvPris ?? 0), 0)
  const avgCallsPerSetter = n > 0 ? totalCalls / n : 0
  const avgRdvPerSetter = n > 0 ? totalRdv / n : 0

  return {
    activeSetters: n,
    totalSetters: setters.length,
    totalCalls,
    totalRdv,
    avgCallsPerSetter: round1(avgCallsPerSetter),
    avgRdvPerSetter: round1(avgRdvPerSetter),
    avgCallsPerSetterPerDay: round1(avgCallsPerSetter / safeDays),
    avgRdvPerSetterPerDay: round1(avgRdvPerSetter / safeDays),
    rdvPerCallRate: totalCalls > 0 ? round1((totalRdv / totalCalls) * 100) : 0,
  }
}
