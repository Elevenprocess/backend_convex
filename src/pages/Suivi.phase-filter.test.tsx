import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ClientResponse, LeadResponse, WorkflowPhase } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))
// La carte dossier réelle est riche (workflow, badges…) : on ne teste ici que le
// filtrage de la liste, donc on la réduit au nom du lead.
vi.mock('../components/suivi/DossierCard', () => ({
  DossierCard: ({ dossier }: { dossier: { lead: { firstName: string | null; lastName: string | null } } }) => (
    <div>{`${dossier.lead.firstName ?? ''} ${dossier.lead.lastName ?? ''}`.trim()}</div>
  ),
}))
vi.mock('../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string; id: string } }) => unknown) =>
    sel({ user: { role: 'delivrabilite', id: 'u1' } }),
}))

const lead = (id: string, firstName: string): LeadResponse => ({
  id,
  firstName,
  lastName: 'Test',
  phone: '0692000000',
  status: 'signe',
  updatedAt: '2026-06-10T10:00:00.000Z',
} as unknown as LeadResponse)

const client = (leadId: string, currentPhase: WorkflowPhase, statusGlobal = 'en_cours'): ClientResponse => ({
  id: `c-${leadId}`, leadId, rdvId: null,
  lead: { fullName: `x`, city: null, phone: null },
  technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
  statusGlobal, blocked: false, missingDocsCount: 0,
  signedAt: '2026-06-05', currentPhase, steps: {},
} as unknown as ClientResponse)

const LEADS = [lead('l1', 'Aline'), lead('l2', 'Bruno'), lead('l3', 'Chloé')]
const CLIENTS = [client('l1', 'racco'), client('l2', 'vt'), client('l3', 'racco', 'cloture')]

vi.mock('../lib/hooks', () => ({
  useLeads: () => ({ data: LEADS, loading: false, error: null }),
  useRdvList: () => ({ data: [], loading: false, error: null }),
  useUsers: () => ({ data: [], loading: false, error: null }),
  useClients: () => ({ data: CLIENTS, loading: false, error: null }),
}))

import { Suivi } from './Suivi'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/suivi" element={<Suivi />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Arrivée depuis le funnel Overview : /suivi?phase=racco doit montrer UNIQUEMENT
// les dossiers actuellement en raccordement (clôturés exclus), pas tous les dossiers.
describe('Suivi — filtre ?phase= depuis le funnel Overview', () => {
  it('sans paramètre, tous les dossiers signés sont listés', () => {
    renderAt('/suivi')
    expect(screen.getByText('Aline Test')).toBeTruthy()
    expect(screen.getByText('Bruno Test')).toBeTruthy()
  })

  it('?phase=racco ne montre que le dossier en raccordement (dossier clôturé exclu)', () => {
    renderAt('/suivi?phase=racco')
    expect(screen.getByText('Aline Test')).toBeTruthy()
    expect(screen.queryByText('Bruno Test')).toBeNull()
    expect(screen.queryByText('Chloé Test')).toBeNull()
  })

  it('affiche un chip de filtre retirable qui restaure la liste complète', () => {
    renderAt('/suivi?phase=racco')
    const chip = screen.getByRole('button', { name: /Raccordement/ })
    fireEvent.click(chip)
    expect(screen.getByText('Aline Test')).toBeTruthy()
    expect(screen.getByText('Bruno Test')).toBeTruthy()
  })
})
