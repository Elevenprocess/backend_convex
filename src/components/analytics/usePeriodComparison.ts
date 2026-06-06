import { useAnalyticsSummary, useAnalyticsFunnel } from '../../lib/hooks'
import { previousRange, type PeriodRange } from '../../lib/period'

export type Delta = { value: number; previousValue: number; deltaPct: number | null }

export function computeDelta(value: number, previousValue: number): Delta {
  if (!previousValue) return { value, previousValue, deltaPct: null }
  return { value, previousValue, deltaPct: Math.round(((value - previousValue) / previousValue) * 100) }
}

export type PeriodComparison = {
  leads: Delta
  calls: Delta
  rdv: Delta
  ventes: Delta
  ca: Delta
  loading: boolean
}

function metricsOf(
  summary: ReturnType<typeof useAnalyticsSummary>['data'],
  funnel: ReturnType<typeof useAnalyticsFunnel>['data'],
) {
  const admin = summary?.admin ?? null
  const totals = funnel?.totals ?? null
  return {
    leads: admin?.classified ?? totals?.qualified ?? 0,
    calls: admin?.calls ?? totals?.calls ?? 0,
    rdv: admin?.rdvPris ?? totals?.rdv ?? 0,
    ventes: admin?.signed ?? 0,
    ca: admin?.ca ?? 0,
  }
}

export function usePeriodComparison(range: PeriodRange): PeriodComparison {
  const prev = previousRange(range)
  const curSummary = useAnalyticsSummary({ from: range.from, to: range.to })
  const curFunnel = useAnalyticsFunnel({ from: range.from, to: range.to })
  const prevSummary = useAnalyticsSummary({ from: prev.from, to: prev.to })
  const prevFunnel = useAnalyticsFunnel({ from: prev.from, to: prev.to })

  const c = metricsOf(curSummary.data, curFunnel.data)
  const p = metricsOf(prevSummary.data, prevFunnel.data)

  return {
    leads: computeDelta(c.leads, p.leads),
    calls: computeDelta(c.calls, p.calls),
    rdv: computeDelta(c.rdv, p.rdv),
    ventes: computeDelta(c.ventes, p.ventes),
    ca: computeDelta(c.ca, p.ca),
    loading: curSummary.loading || curFunnel.loading,
  }
}
