// Moyennes d'activité setter pour l'Analytics admin.
// Calcul 100 % à partir des vraies lignes `setters` du backend
// (AnalyticsAdminSummary.setters), déjà scopées à la période sélectionnée.
// Aucun chiffre inventé : moyenne = somme réelle ÷ nombre de setters actifs.
// Le job du setter = appeler puis QUALIFIER (pas prendre le RDV), donc l'output
// mesuré est `qualified`, pas `rdvPris`.

import type { AnalyticsSetterPerf } from './types'

export type SetterAverages = {
  /** Setters ayant réellement travaillé sur la période (appels ou leads traités). */
  activeSetters: number
  /** Tous les setters connus, actifs ou non. */
  totalSetters: number
  /** Somme des appels logiques (réels + déduits) sur la période. */
  totalCalls: number
  /** Somme des leads qualifiés sur la période. */
  totalQualified: number
  /** Appels moyens par setter actif. */
  avgCallsPerSetter: number
  /** Qualifiés moyens par setter actif. */
  avgQualifiedPerSetter: number
  /** Appels moyens par setter actif et par jour de la période. */
  avgCallsPerSetterPerDay: number
  /** Qualifiés moyens par setter actif et par jour de la période. */
  avgQualifiedPerSetterPerDay: number
  /** Transformation moyenne appel → qualifié (%) sur l'ensemble des setters actifs. */
  qualifiedPerCallRate: number
}

/** Un setter compte comme actif s'il a au moins un appel ou un lead traité. */
function isActiveSetter(s: AnalyticsSetterPerf): boolean {
  return (s.calls ?? 0) > 0 || (s.classified ?? 0) > 0
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function computeSetterAverages(setters: AnalyticsSetterPerf[], days: number): SetterAverages {
  const active = setters.filter(isActiveSetter)
  const n = active.length
  const safeDays = Math.max(1, Math.round(days || 0))
  const totalCalls = active.reduce((sum, s) => sum + (s.calls ?? 0), 0)
  const totalQualified = active.reduce((sum, s) => sum + (s.qualified ?? 0), 0)
  const avgCallsPerSetter = n > 0 ? totalCalls / n : 0
  const avgQualifiedPerSetter = n > 0 ? totalQualified / n : 0

  return {
    activeSetters: n,
    totalSetters: setters.length,
    totalCalls,
    totalQualified,
    avgCallsPerSetter: round1(avgCallsPerSetter),
    avgQualifiedPerSetter: round1(avgQualifiedPerSetter),
    avgCallsPerSetterPerDay: round1(avgCallsPerSetter / safeDays),
    avgQualifiedPerSetterPerDay: round1(avgQualifiedPerSetter / safeDays),
    qualifiedPerCallRate: totalCalls > 0 ? round1((totalQualified / totalCalls) * 100) : 0,
  }
}
