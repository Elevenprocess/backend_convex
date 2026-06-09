import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { LeadResponse, RdvResponse } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))

vi.mock('../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string; id: string } }) => unknown) => sel({ user: { role: 'commercial', id: 'me-1' } }),
}))
vi.mock('../lib/role', () => ({ useDisplayUser: () => ({ firstName: 'Alex' }) }))

const rdv = (over: Partial<RdvResponse>): RdvResponse => ({
  id: 'r', leadId: 'lead-x', scheduledAt: '2026-06-05T10:00:00.000Z',
  status: 'honore', result: null, montantTotal: null, locationType: 'domicile',
  debriefFilledAt: '2026-06-05T12:00:00.000Z', notes: null,
  ...over,
} as RdvResponse)

const RDVS: RdvResponse[] = [
  rdv({ id: 'r1', leadId: 'lead-1', scheduledAt: '2026-06-05T10:00:00.000Z', status: 'honore', result: 'signe', montantTotal: '15000' }),
  rdv({ id: 'r2', leadId: 'lead-2', scheduledAt: '2026-06-06T10:00:00.000Z', status: 'honore', result: 'perdu' }),
  rdv({ id: 'r5', leadId: 'lead-5', scheduledAt: '2026-06-07T10:00:00.000Z', status: 'honore', result: 'signe', montantTotal: '5000' }),
  rdv({ id: 'r4', leadId: 'lead-4', scheduledAt: '2026-06-04T09:00:00.000Z', status: 'honore', result: null, debriefFilledAt: null, notes: null }),
  rdv({ id: 'r3', leadId: 'lead-3', scheduledAt: '2026-06-20T08:00:00.000Z', status: 'planifie', result: null, debriefFilledAt: null, notes: null }),
]

const lead = (id: string, firstName: string, lastName: string, city: string): LeadResponse =>
  ({ id, firstName, lastName, city, phone: '0692000000' } as LeadResponse)

const LEADS: LeadResponse[] = [
  lead('lead-3', 'Marie', 'Curie', 'Saint-Pierre'),
  lead('lead-4', 'Paul', 'Dirac', 'Saint-Denis'),
]

vi.mock('../lib/hooks', () => ({
  useRdvList: () => ({ data: RDVS, loading: false, error: null }),
  useLeads: () => ({ data: LEADS, loading: false, error: null }),
}))

import { Overview } from './Overview'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-15T06:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Overview — Mon espace (commercial individuel)', () => {
  const renderPage = () => render(<MemoryRouter><Overview /></MemoryRouter>)

  it('affiche les 4 KPIs perso', () => {
    renderPage()
    expect(screen.getByText('CA signé')).toBeInTheDocument()
    expect(screen.getByText('Closing')).toBeInTheDocument()
    expect(screen.getByText('Panier moyen')).toBeInTheDocument()
    expect(screen.getByText('RDV honorés')).toBeInTheDocument()
  })

  it('calcule les KPIs sur la période (CA, closing, panier dérivés des RDV)', () => {
    renderPage()
    expect(screen.getByText('20k€')).toBeInTheDocument()
    expect(screen.getByText('10k€')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('affiche le nom du prospect dans « Mes RDV à venir »', () => {
    renderPage()
    expect(screen.getByText('Marie Curie')).toBeInTheDocument()
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
