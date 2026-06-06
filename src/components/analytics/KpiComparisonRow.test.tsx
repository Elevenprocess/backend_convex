import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiComparisonRow } from './KpiComparisonRow'
import type { PeriodComparison } from './usePeriodComparison'

const comp: PeriodComparison = {
  leads: { value: 120, previousValue: 100, deltaPct: 20 },
  calls: { value: 50, previousValue: 50, deltaPct: 0 },
  rdv: { value: 10, previousValue: 20, deltaPct: -50 },
  ventes: { value: 5, previousValue: 0, deltaPct: null },
  ca: { value: 12000, previousValue: 10000, deltaPct: 20 },
  loading: false,
}

describe('KpiComparisonRow', () => {
  it('affiche les 4 KPI funnel', () => {
    render(<KpiComparisonRow comparison={comp} series={{ leads: [1, 2], calls: [1], rdv: [1], ventes: [1] }} />)
    expect(screen.getByText('Leads')).toBeInTheDocument()
    expect(screen.getByText('Appels')).toBeInTheDocument()
    expect(screen.getByText('RDV')).toBeInTheDocument()
    expect(screen.getByText('Ventes')).toBeInTheDocument()
  })

  it('affiche le delta positif et "—" quand pas de comparaison', () => {
    render(<KpiComparisonRow comparison={comp} series={{ leads: [1, 2], calls: [1], rdv: [1], ventes: [1] }} />)
    expect(screen.getAllByText(/↗\s*20\s*%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
