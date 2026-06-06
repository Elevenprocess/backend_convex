import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { LeadResponse, UserResponse, ProjectResponse, ProjectDetailResponse } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))

const useLeadsMock = vi.fn()
const useRdvListMock = vi.fn()
const useUsersMock = vi.fn()
const useLeadDebriefsMock = vi.fn()
vi.mock('../lib/hooks', () => ({
  useLeads: (...a: unknown[]) => useLeadsMock(...a),
  useRdvList: (...a: unknown[]) => useRdvListMock(...a),
  useUsers: (...a: unknown[]) => useUsersMock(...a),
  useLeadDebriefs: (...a: unknown[]) => useLeadDebriefsMock(...a),
}))

const listProjectsByLeadMock = vi.fn()
const getProjectDetailMock = vi.fn()
vi.mock('../lib/api', () => ({
  listProjectsByLead: (...a: unknown[]) => listProjectsByLeadMock(...a),
  getProjectDetail: (...a: unknown[]) => getProjectDetailMock(...a),
  attachmentRawUrl: (id: string) => `/raw/${id}`,
  downloadDevisPdf: vi.fn(),
}))

const authStateRef = { user: { id: 'admin-1', name: 'Admin', role: 'admin', active: true } as UserResponse }
vi.mock('../lib/auth', () => ({
  useAuth: (selector: (s: { user?: UserResponse }) => unknown) => selector(authStateRef),
}))

import { FicheCompletePage } from './SuiviFiche'

const lead: LeadResponse = {
  id: 'lead-1',
  firstName: 'Jean',
  lastName: 'Dupont',
  status: 'signe',
  city: 'Saint-Denis',
} as LeadResponse

const commercial: UserResponse = { id: 'com-1', name: 'Alice Commercial', role: 'commercial', active: true } as UserResponse

const project: ProjectResponse = {
  id: 'proj-1',
  leadId: 'lead-1',
  commercialId: 'com-1',
  name: 'Installation 8 kWc',
  addressLine: null,
  postalCode: null,
  city: null,
  status: 'devis_en_cours' as ProjectResponse['status'],
  notes: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
}

const projectDetail: ProjectDetailResponse = {
  ...project,
  devis: [
    { id: 'dev-1', filename: 'devis.pdf', devisNumber: '2605-0393', status: 'valide', montantTtc: 19425 } as unknown as ProjectDetailResponse['devis'][number],
  ],
  debriefs: [],
  attachments: [
    { id: 'att-1', projectId: 'proj-1', uploadedById: 'com-1', kind: 'document', label: 'Mandat', filename: 'mandat.pdf', contentType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-05-02T10:00:00.000Z' },
  ],
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/suivi/:id/fiche" element={<FicheCompletePage />} />
        <Route path="/overview" element={<div>OVERVIEW</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authStateRef.user = { id: 'admin-1', name: 'Admin', role: 'admin', active: true } as UserResponse
  useLeadsMock.mockReturnValue({ data: [lead], loading: false })
  useRdvListMock.mockReturnValue({ data: [], loading: false })
  useUsersMock.mockReturnValue({ data: [commercial] })
  useLeadDebriefsMock.mockReturnValue({ data: [] })
  listProjectsByLeadMock.mockResolvedValue([project])
  getProjectDetailMock.mockResolvedValue(projectDetail)
})

describe('FicheCompletePage', () => {
  it('affiche la fiche client et les dossiers groupés par projet', async () => {
    renderAt('/suivi/lead-1/fiche')

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument()
    const projectHeading = await screen.findByText('Installation 8 kWc')
    expect(projectHeading).toBeInTheDocument()
    expect(await screen.findByText('2605-0393')).toBeInTheDocument()
    expect(await screen.findByText('Mandat')).toBeInTheDocument()
  })

  it('affiche « Dossier introuvable » pour un id inconnu', async () => {
    renderAt('/suivi/inconnu/fiche')
    expect(await screen.findByText('Dossier introuvable.')).toBeInTheDocument()
  })

  it('redirige un rôle non autorisé vers /overview', async () => {
    authStateRef.user = { id: 'com-1', name: 'Alice', role: 'commercial', active: true } as UserResponse
    renderAt('/suivi/lead-1/fiche')
    expect(await screen.findByText('OVERVIEW')).toBeInTheDocument()
  })
})
