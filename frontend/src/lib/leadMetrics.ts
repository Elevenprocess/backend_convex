// Métriques cliquables de la courbe d'évolution (Overview admin).
// Source de vérité unique pour cartes + courbe + tooltip + axe Y.

export type LeadEvolutionPoint = {
  key: string
  t: number
  date: string
  label: string
  leads: number
  calls: number
  rdv: number
  signed: number
}

export type LeadMetricKey = 'leads' | 'calls' | 'rdv' | 'signed' | 'closing'
export type MetricFormat = 'count' | 'percent'

export function closingRate(signed: number, rdv: number): number {
  return rdv > 0 ? Math.round((signed / rdv) * 1000) / 10 : 0
}

/** Plus petite « échelle ronde » 1/2/5 × 10ⁿ supérieure ou égale à `value` (min 1).
 *  Ceiling pur, sans cas particulier : 7→10, 23→50, 230→500, 400→500, 3→5. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1
  const exp = Math.floor(Math.log10(value))
  const base = Math.pow(10, exp)
  const frac = value / base
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return niceFrac * base
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1000) {
    const v = n / 1000
    return `${(Math.round(v * 10) / 10).toString().replace('.', ',')} k`
  }
  return `${Math.round(n)}`
}

export function formatMetricValue(value: number, format: MetricFormat): string {
  if (format === 'percent') return `${(Math.round(value * 10) / 10).toString().replace('.', ',')} %`
  return fmtCompact(value)
}

export const LEAD_METRICS: Record<LeadMetricKey, {
  label: string
  color: string
  format: MetricFormat
  valueOf: (p: LeadEvolutionPoint) => number
}> = {
  leads: { label: 'Prospects', color: '#1F7857', format: 'count', valueOf: (p) => p.leads },
  calls: { label: 'Appels', color: '#3DA86A', format: 'count', valueOf: (p) => p.calls },
  rdv: { label: 'RDV', color: '#3E9A6F', format: 'count', valueOf: (p) => p.rdv },
  signed: { label: 'Ventes', color: '#145A41', format: 'count', valueOf: (p) => p.signed },
  closing: { label: 'Taux de vente', color: '#7C6A46', format: 'percent', valueOf: (p) => closingRate(p.signed, p.rdv) },
}

export const LEAD_METRIC_ORDER: LeadMetricKey[] = ['leads', 'calls', 'rdv', 'signed', 'closing']
