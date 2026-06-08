import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DossierCard } from './DossierCard'
import type { Dossier } from '../../lib/suivi'
import type { ClientResponse } from '../../lib/types'

const dossier = {
  id: 'l1', lead: { id: 'l1', firstName: 'Jean', lastName: 'Dupont', city: 'Lyon', status: 'signe' } as any,
  amount: 8200, signedAt: '2026-06-01', state: { statuses: {}, dates: {}, notes: {}, payMode: 'comptant', primeMode: 'revente_edf' },
  activeStep: 'mandat_dp', progress: 50,
} as unknown as Dossier

function client(over: Partial<ClientResponse>): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', rdvId: null, lead: { fullName: 'Jean Dupont', city: 'Lyon', phone: null },
    technicienVtId: null, poseTeamLeadId: null, adminReferentId: null, statusGlobal: 'en_cours',
    currentPhase: 'consuel', blocked: false, signedAt: null, steps: {}, missingDocsCount: 2, ...over,
  } as ClientResponse
}

describe('DossierCard enrichie', () => {
  it('affiche la phase active du backend', () => {
    render(<DossierCard dossier={dossier} client={client({})} onClick={vi.fn()} />)
    expect(screen.getByText('Consuel')).toBeInTheDocument()
  })
  it('affiche le compteur de pièces manquantes', () => {
    render(<DossierCard dossier={dossier} client={client({ missingDocsCount: 2 })} onClick={vi.fn()} />)
    expect(screen.getByText(/2 pièces/i)).toBeInTheDocument()
  })
  it('affiche le badge bloqué', () => {
    render(<DossierCard dossier={dossier} client={client({ blocked: true })} onClick={vi.fn()} />)
    expect(screen.getByText(/bloqué/i)).toBeInTheDocument()
  })
  it('fonctionne sans client (fallback)', () => {
    render(<DossierCard dossier={dossier} onClick={vi.fn()} />)
    expect(screen.getByText(/Dupont/)).toBeInTheDocument()
  })
})
