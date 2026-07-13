import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RdvLeadSummary, RdvResponse } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))

vi.mock('../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string; id: string } }) => unknown) => sel({ user: { role: 'commercial', id: 'me-1' } }),
}))
vi.mock('../lib/role', () => ({ useDisplayUser: () => ({ firstName: 'Alex' }) }))

const lead = (id: string, firstName: string, lastName: string, city: string): RdvLeadSummary =>
  ({ id, firstName, lastName, city, phone: '0692000000', email: null, setterId: null })

const rdv = (over: Partial<RdvResponse>): RdvResponse => ({
  id: 'r', leadId: 'lead-x', scheduledAt: '2026-06-05T10:00:00.000Z',
  status: 'honore', result: null, montantTotal: null, locationType: 'domicile',
  debriefFilledAt: '2026-06-05T12:00:00.000Z', notes: null, lead: null,
  ...over,
} as RdvResponse)

// Le lead est désormais embarqué dans le RDV (backend toRdvResponse), plus de
// requête /leads séparée.
const RDVS: RdvResponse[] = [
  rdv({ id: 'r1', leadId: 'lead-1', scheduledAt: '2026-06-05T10:00:00.000Z', status: 'honore', result: 'signe', montantTotal: '15000' }),
  rdv({ id: 'r2', leadId: 'lead-2', scheduledAt: '2026-06-06T10:00:00.000Z', status: 'honore', result: 'perdu' }),
  rdv({ id: 'r5', leadId: 'lead-5', scheduledAt: '2026-06-07T10:00:00.000Z', status: 'honore', result: 'signe', montantTotal: '5000' }),
  rdv({ id: 'r4', leadId: 'lead-4', scheduledAt: '2026-06-04T09:00:00.000Z', status: 'honore', result: null, debriefFilledAt: null, notes: null, lead: lead('lead-4', 'Paul', 'Dirac', 'Saint-Denis') }),
  rdv({ id: 'r3', leadId: 'lead-3', scheduledAt: '2026-06-20T08:00:00.000Z', status: 'planifie', result: null, debriefFilledAt: null, notes: null, lead: lead('lead-3', 'Marie', 'Curie', 'Saint-Pierre') }),
]

vi.mock('../lib/hooks', () => ({
  useRdvList: () => ({ data: RDVS, loading: false, error: null }),
  useLeads: () => ({ data: [], loading: false, error: null }),
}))

import { Overview } from './Overview'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T06:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Overview — Mon espace (commercial individuel, vue épurée)', () => {
  const renderPage = () => render(<MemoryRouter><Overview /></MemoryRouter>)

  it('affiche le seul KPI « RDV honorés » et masque CA / closing / panier', () => {
    renderPage()
    expect(screen.getByText('RDV honorés')).toBeInTheDocument()
    expect(screen.queryByText('CA signé')).not.toBeInTheDocument()
    expect(screen.queryByText('Closing')).not.toBeInTheDocument()
    expect(screen.queryByText('Panier moyen')).not.toBeInTheDocument()
  })

  it('compte les RDV honorés sur la période (4 honorés en juin)', () => {
    renderPage()
    // r1, r2, r5, r4 sont honorés en juin ; r3 est planifié.
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('ne montre plus le bloc « Mes RDV à venir »', () => {
    renderPage()
    expect(screen.queryByText('Mes RDV à venir')).not.toBeInTheDocument()
    expect(screen.queryByText('Marie Curie')).not.toBeInTheDocument()
  })

  it('liste les débriefs à remplir avec le nom du prospect', () => {
    renderPage()
    expect(screen.getByText('Paul Dirac')).toBeInTheDocument()
  })

  it('rend le sélecteur de période', () => {
    renderPage()
    expect(screen.getByLabelText('Période')).toBeInTheDocument()
  })
})
