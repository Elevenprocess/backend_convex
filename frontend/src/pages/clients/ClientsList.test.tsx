import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { LeadResponse, UserResponse } from '../../lib/types'

// La page tire AppShell (→ Blobs/WebGL via ogl) et Topbar : on les neutralise
// pour rester en jsdom et tester uniquement le câblage « Donner à… ».
vi.mock('../../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

const assignLeadMock = vi.fn()
const useLeadsMock = vi.fn()
const useUsersMock = vi.fn()
vi.mock('../../lib/hooks', () => ({
  useLeads: (...a: unknown[]) => useLeadsMock(...a),
  useLeadsProgressive: (...a: unknown[]) => useLeadsMock(...a),
  useUsers: (...a: unknown[]) => useUsersMock(...a),
  assignLead: (...a: unknown[]) => assignLeadMock(...a),
}))

// Stores zustand (sélecteurs) : on rend un état figé.
const authStateRef = { user: undefined as UserResponse | undefined }
vi.mock('../../lib/auth', () => ({
  useAuth: (selector: (s: { user?: UserResponse }) => unknown) => selector(authStateRef),
}))
vi.mock('../../lib/leadSidebar', () => ({
  useLeadSidebar: (selector: (s: { selectedLeadId: string | null; selectLead: () => void; sidebarOpen: boolean }) => unknown) =>
    selector({ selectedLeadId: null, selectLead: () => {}, sidebarOpen: false }),
}))

import { ClientsList } from './ClientsList'

function makeUser(id: string, name: string, role: UserResponse['role']): UserResponse {
  return { id, name, role, active: true } as UserResponse
}

const client = {
  id: 'lead-1',
  firstName: 'Jean',
  lastName: 'Dupont',
  phone: '0600000000',
  status: 'en_attente',
  assignedToId: 'u-alice',
  createdAt: '2026-05-01T10:00:00.000Z',
  transferredAt: null,
} as unknown as LeadResponse

const alice = makeUser('u-alice', 'Alice Martin', 'commercial')
const bob = makeUser('u-bob', 'Bob Durand', 'commercial')

beforeEach(() => {
  assignLeadMock.mockReset()
  useLeadsMock.mockReturnValue({ data: [client], loading: false, error: null })
  useUsersMock.mockReturnValue({ data: [alice, bob], loading: false, error: null })
})

describe('ClientsList — action « Donner à… »', () => {
  it("n'affiche pas l'action pour un commercial simple", () => {
    authStateRef.user = makeUser('u-alice', 'Alice Martin', 'commercial')
    render(<ClientsList />)
    expect(screen.queryByRole('button', { name: /Donner ce client à un commercial/i })).not.toBeInTheDocument()
  })

  it('affiche l\'action pour le responsable commercial et ouvre la modale', () => {
    authStateRef.user = makeUser('u-boss', 'Chef Vente', 'commercial_lead')
    render(<ClientsList />)
    const trigger = screen.getByRole('button', { name: /Donner ce client à un commercial/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('heading', { name: /Donner ce client à un commercial/i })).toBeInTheDocument()
  })

  it('transfère le client au commercial choisi via assignLead', async () => {
    authStateRef.user = makeUser('u-boss', 'Chef Vente', 'commercial_lead')
    assignLeadMock.mockResolvedValue({ ...client, assignedToId: 'u-bob' })
    render(<ClientsList />)

    fireEvent.click(screen.getByRole('button', { name: /Donner ce client à un commercial/i }))
    const dialog = screen.getByRole('heading', { name: /Donner ce client à un commercial/i }).closest('div')!.parentElement!
    fireEvent.click(within(dialog).getByText('Bob Durand'))
    fireEvent.click(within(dialog).getByRole('button', { name: /Donner le client/i }))

    await waitFor(() => expect(assignLeadMock).toHaveBeenCalledWith('lead-1', 'u-bob'))
  })
})

describe('ClientsList — verrouillage technicien', () => {
  it('redirige un technicien vers /mes-interventions', () => {
    authStateRef.user = makeUser('tech-1', 'Tech Un', 'technicien')
    useLeadsMock.mockReturnValue({ data: [], loading: false, error: null })
    render(
      <MemoryRouter initialEntries={['/client']}>
        <Routes>
          <Route path="/client" element={<ClientsList />} />
          <Route path="/mes-interventions" element={<div>VUE TECHNICIEN</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('VUE TECHNICIEN')).toBeInTheDocument()
  })
})

describe('ClientsList — replier une section = exclure le filtre', () => {
  it('réactive les clients exclus quand on replie la section Statut', () => {
    window.localStorage.clear()
    authStateRef.user = makeUser('u-alice', 'Alice Martin', 'commercial')
    render(<ClientsList />)

    // Le client (statut « en_attente ») est visible au départ.
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument()

    // On filtre sur un autre statut → le client disparaît.
    fireEvent.click(screen.getByText('En cours de signature'))
    expect(screen.queryByText('Jean Dupont')).not.toBeInTheDocument()

    // Replier la section Statut remet le filtre à « Tout » → le client revient.
    fireEvent.click(screen.getByRole('button', { name: 'Statut' }))
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument()
  })
})
