import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ClientResponse, UserResponse } from '../../lib/types'

vi.mock('../../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

const useClientsMock = vi.fn()
vi.mock('../../lib/hooks', () => ({
  useClients: (...a: unknown[]) => useClientsMock(...a),
}))

const authStateRef = { user: undefined as UserResponse | undefined }
vi.mock('../../lib/auth', () => ({
  useAuth: (selector: (s: { user?: UserResponse }) => unknown) => selector(authStateRef),
}))

import { MesInterventions } from './MesInterventions'

const ME = 'tech-1'

function makeClient(over: Partial<ClientResponse> & { id: string; name: string }): ClientResponse {
  return {
    id: over.id,
    leadId: `lead-${over.id}`,
    rdvId: null,
    lead: { fullName: over.name, city: 'Lyon', phone: '0600000000' },
    technicienVtId: over.technicienVtId ?? null,
    poseTeamLeadId: null,
    adminReferentId: null,
    statusGlobal: 'nouveau',
    currentPhase: 'vt',
    blocked: false,
    signedAt: '2026-06-01T00:00:00.000Z',
    steps: over.steps ?? {},
  } as ClientResponse
}

const vtClient = makeClient({ id: 'c-vt', name: 'Client VT', technicienVtId: ME })
const installClient = makeClient({
  id: 'c-install',
  name: 'Client Install',
  steps: { installation: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: ME } },
})

function renderPage() {
  return render(
    <MemoryRouter>
      <MesInterventions />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  authStateRef.user = { id: ME, name: 'Tech Un', role: 'technicien', active: true } as UserResponse
  useClientsMock.mockReturnValue({ data: [vtClient, installClient], loading: false, error: null })
})

describe('MesInterventions', () => {
  it('répartit les dossiers entre Mes VT et Mes installations', () => {
    renderPage()
    const vtSection = screen.getByRole('region', { name: /Mes VT/i })
    const installSection = screen.getByRole('region', { name: /Mes installations/i })
    expect(within(vtSection).getByText('Client VT')).toBeInTheDocument()
    expect(within(vtSection).queryByText('Client Install')).not.toBeInTheDocument()
    expect(within(installSection).getByText('Client Install')).toBeInTheDocument()
    expect(within(installSection).queryByText('Client VT')).not.toBeInTheDocument()
  })

  it('redirige un rôle non autorisé', () => {
    authStateRef.user = { id: 'x', name: 'Setter', role: 'setter', active: true } as UserResponse
    renderPage()
    expect(screen.queryByRole('region', { name: /Mes VT/i })).not.toBeInTheDocument()
  })
})
