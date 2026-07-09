import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ClientResponse, InterventionResponse, UserResponse } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))

const authStateRef = { user: undefined as UserResponse | undefined }
vi.mock('../lib/auth', () => ({
  useAuth: (sel: (s: { user?: UserResponse }) => unknown) => sel(authStateRef),
}))

const intervention = (over: Partial<InterventionResponse>): InterventionResponse => ({
  id: 'i1',
  clientId: 'c1',
  type: 'reparation',
  status: 'planifiee',
  motif: 'Onduleur en défaut',
  observations: null,
  technicienId: null,
  technicienName: null,
  datePlanifiee: '2026-07-05T08:00:00.000Z',
  heure: '08:00',
  dateRealisee: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  files: [],
  client: { leadId: 'l1', fullName: 'Jean Livré', city: 'Saint-Denis' },
  ...over,
})

const INTERVENTIONS: InterventionResponse[] = [
  intervention({ id: 'i1', motif: 'Onduleur en défaut', status: 'planifiee', technicienId: 'tech-1', technicienName: 'Théo Tech' }),
  intervention({ id: 'i2', motif: 'Panneau fissuré', status: 'realisee', observations: 'Remplacé sous garantie', client: { leadId: 'l2', fullName: 'Marie Posée', city: 'Saint-Pierre' } }),
]

const CLIENTS: ClientResponse[] = [
  {
    id: 'cl1', leadId: 'lead-9', projectId: null, rdvId: null,
    lead: { fullName: 'Paul Futur', city: 'Le Tampon', phone: null },
    technicienVtId: null, techniciens: [{ id: 't9', name: 'Vito VT' }],
    poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'vt_a_faire', currentPhase: 'vt', blocked: false,
    missingDocsCount: 0, signedAt: null,
    steps: {
      vt: { status: 'planifie', datePlanifiee: '2026-07-15', dateRealisee: null, problemReason: null, responsableId: null },
      installation: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null },
    },
  },
]

vi.mock('../lib/hooks', () => ({
  useInterventions: () => ({ data: INTERVENTIONS, loading: false, error: null, refetch: () => {} }),
  useClients: () => ({ data: CLIENTS, loading: false, error: null }),
  useUsers: () => ({ data: [], loading: false, error: null }),
}))

import { Interventions } from './Interventions'

function renderPage(role: UserResponse['role'], id = 'u-1') {
  authStateRef.user = { id, name: 'Test', role, active: true } as UserResponse
  return render(<MemoryRouter><Interventions /></MemoryRouter>)
}

beforeEach(() => {
  authStateRef.user = undefined
})

describe('Interventions — page SAV', () => {
  it('équipe délivrabilité : liste + bouton « Nouvelle intervention »', () => {
    renderPage('delivrabilite')
    expect(screen.getByText('Onduleur en défaut')).toBeTruthy()
    expect(screen.getByText('Jean Livré')).toBeTruthy()
    expect(screen.getByText('Panneau fissuré')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Nouvelle intervention/ })).toBeTruthy()
  })

  it('technicien : pas de création, mais bouton « Clôturer » sur son intervention planifiée', () => {
    renderPage('technicien', 'tech-1')
    expect(screen.queryByRole('button', { name: /Nouvelle intervention/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Clôturer/ })).toBeTruthy()
  })

  it('filtre statut : « Réalisées » ne montre que les interventions réalisées', () => {
    renderPage('delivrabilite')
    fireEvent.click(screen.getByRole('button', { name: /^Réalisées/ }))
    expect(screen.queryByText('Onduleur en défaut')).toBeNull()
    expect(screen.getByText('Panneau fissuré')).toBeTruthy()
    expect(screen.getByText('Remplacé sous garantie')).toBeTruthy()
  })

  it('interventions terrain : la VT planifiée du dossier apparaît avec son technicien', () => {
    renderPage('delivrabilite')
    expect(screen.getByText('Visite technique')).toBeTruthy()
    expect(screen.getAllByText('Paul Futur').length).toBeGreaterThan(0)
    expect(screen.getByText(/Vito VT/)).toBeTruthy()
  })

  it('filtre « À venir » : montre l’installation pas encore commencée, masque le reste', () => {
    renderPage('delivrabilite')
    fireEvent.click(screen.getByRole('button', { name: /^À venir/ }))
    expect(screen.getByText('Installation')).toBeTruthy()
    expect(screen.getByText('Pas encore planifiée')).toBeTruthy()
    expect(screen.queryByText('Visite technique')).toBeNull()
    expect(screen.queryByText('Onduleur en défaut')).toBeNull()
  })
})
