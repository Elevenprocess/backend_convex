import { MagicKpi, type DeltaTone } from '../kpi/MagicKpi'
import type { Delta, PeriodComparison } from './usePeriodComparison'

type Series = { leads: number[]; calls: number[]; rdv: number[]; ventes: number[] }

function deltaLabel(d: Delta): string {
  if (d.deltaPct === null) return '—'
  const arrow = d.deltaPct > 0 ? '↗' : d.deltaPct < 0 ? '↘' : '→'
  return `${arrow} ${Math.abs(d.deltaPct)} %`
}

function deltaTone(d: Delta): DeltaTone {
  if (d.deltaPct === null || d.deltaPct === 0) return 'info'
  return d.deltaPct > 0 ? 'success' : 'danger'
}

function fmt(n: number): string {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}
function fmtEur(n: number): string {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n) + ' €'
}

export function KpiComparisonRow({ comparison, series }: { comparison: PeriodComparison; series: Series }) {
  const cards: { label: string; d: Delta; icon: 'inbox' | 'phone' | 'calendar' | 'trophy'; trend: number[] }[] = [
    { label: 'Leads', d: comparison.leads, icon: 'inbox', trend: series.leads },
    { label: 'Appels', d: comparison.calls, icon: 'phone', trend: series.calls },
    { label: 'RDV', d: comparison.rdv, icon: 'calendar', trend: series.rdv },
    { label: 'Ventes', d: comparison.ventes, icon: 'trophy', trend: series.ventes },
  ]
  return (
    <div>
      <div className="kpi-comparison-row">
        {cards.map((c) => (
          <MagicKpi key={c.label} size="sm" accent="green" icon={c.icon}
            label={c.label} value={fmt(c.d.value)}
            delta={deltaLabel(c.d)} deltaTone={deltaTone(c.d)} trend={c.trend} />
        ))}
      </div>
      <p className="kpi-comparison-secondary">
        CA signé : <strong>{fmtEur(comparison.ca.value)}</strong>{' '}
        {comparison.ca.deltaPct !== null && <>({deltaLabel(comparison.ca)} vs période précédente)</>}
      </p>
    </div>
  )
}
