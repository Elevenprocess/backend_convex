import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ClientResponse, WorkflowPhase } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))
vi.mock('../components/analytics/DebriefAnalytics', () => ({ DebriefAnalytics: () => null }))
vi.mock('../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string; id: string; name: string } }) => unknown) =>
    sel({ user: { role: 'delivrabilite', id: 'u1', name: 'Déliv' } }),
}))

const client = (id: string, currentPhase: WorkflowPhase, steps: ClientResponse['steps'] = {}): ClientResponse => ({
  id, leadId: `lead-${id}`, rdvId: null,
  lead: { fullName: `Client ${id}`, city: 'Saint-Denis', phone: null },
  technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
  statusGlobal: 'en_cours', blocked: false, missingDocsCount: 0,
  signedAt: '2026-06-05', currentPhase, steps,
} as unknown as ClientResponse)

// Dates de réalisation dans le MOIS COURANT pour tester le récap mensuel.
const now = new Date()
const thisMonth = (day: number) => new Date(now.getFullYear(), now.getMonth(), day).toISOString()
const phaseStep = (dateRealisee: string) => ({
  status: 'fait', datePlanifiee: null, dateRealisee, problemReason: null, responsableId: null,
}) as NonNullable<ClientResponse['steps']['vt']>

const CLIENTS: ClientResponse[] = [
  client('a', 'racco', { vt: phaseStep(thisMonth(10)) }),
  client('b', 'consuel', { vt: phaseStep(thisMonth(3)), installation: phaseStep(thisMonth(20)) }),
]

vi.mock('../lib/hooks', () => ({
  useLeads: () => ({ data: [], loading: false, error: null }),
  useRdvList: () => ({ data: [], loading: false, error: null }),
  useClients: () => ({ data: CLIENTS, loading: false, error: null }),
  useAnalyticsSummary: () => ({ data: null, loading: false, error: null }),
  prefetchAnalyticsSummary: () => Promise.resolve(null),
}))

import { Analytics } from './Analytics'

// La vue Analytics délivrabilité doit montrer TOUTES les étapes du workflow
// (dont Raccordement et Consuel, absentes de l'ancienne version codée en dur),
// avec les comptes réels issus des dossiers.
describe('Analytics — vue délivrabilité (pipeline complet)', () => {
  it('affiche les 6 phases du pipeline, dont Raccordement et Consuel', () => {
    render(<MemoryRouter><Analytics /></MemoryRouter>)
    for (const label of ['Visite technique', 'Déclaration préalable', 'Raccordement', 'Installation', 'Consuel', 'Mise en service']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('compte les dossiers en tunnel cumulatif (2 en VT/DP/racco, 1 en consuel)', () => {
    render(<MemoryRouter><Analytics /></MemoryRouter>)
    // racco atteint par les 2 dossiers ; consuel par un seul ; mes par aucun.
    const raccoRow = screen.getByText('Raccordement').closest('[data-phase]') ?? screen.getByText('Raccordement').parentElement?.parentElement
    expect(raccoRow?.textContent).toContain('2 dossiers')
    const consuelRow = screen.getByText('Consuel').closest('[data-phase]') ?? screen.getByText('Consuel').parentElement?.parentElement
    expect(consuelRow?.textContent).toContain('1 dossier')
  })
})

describe('Analytics — récap mensuel « Réalisé ce mois-ci »', () => {
  it('affiche la carte avec les VT et poses du mois courant', () => {
    render(<MemoryRouter><Analytics /></MemoryRouter>)
    expect(screen.getByText('Réalisé ce mois-ci')).toBeTruthy()
    expect(screen.getByText(/VT réalisées \(2\)/)).toBeTruthy()
    expect(screen.getByText(/Poses réalisées \(1\)/)).toBeTruthy()
  })
})
