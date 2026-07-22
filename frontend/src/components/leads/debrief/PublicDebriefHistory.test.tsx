import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PublicDebriefHistory, type ExistingDebrief } from './PublicDebriefWizard'

const rdv = { id: 'r1', scheduledAt: '2026-07-22T08:00:00.000Z', status: 'honore', alreadyDebriefed: true }
const client = { firstName: 'Eric', lastName: 'Hamon', email: null, phone: null }

describe('PublicDebriefHistory', () => {
  it('vente : confirmation d’envoi + récap montant/kits', () => {
    const debrief: ExistingDebrief = {
      sentAt: Date.UTC(2026, 6, 22, 8, 31),
      outcome: 'vente',
      montantTotal: 15000,
      kits: '2x Kit 6 kWc',
      acceptanceFactors: ['prix_convenable'],
      notes: 'RAS',
    }
    render(<PublicDebriefHistory client={client} commercialName="Maroasy ELIE" rdv={rdv} debrief={debrief} />)
    expect(screen.getByText('Débrief déjà envoyé ✅')).toBeInTheDocument()
    expect(screen.getByText(/Envoyé le/)).toBeInTheDocument()
    expect(screen.getByText('Vente réalisée')).toBeInTheDocument()
    expect(screen.getByText(/15 000|15 000/)).toBeInTheDocument()
    expect(screen.getByText('2x Kit 6 kWc')).toBeInTheDocument()
    expect(screen.getByText('Prix convenable')).toBeInTheDocument()
    expect(screen.getByText('RAS')).toBeInTheDocument()
    // Pas de formulaire : aucune pill « Vente réalisée » cliquable, pas de bouton Continuer
    expect(screen.queryByRole('button', { name: /Continuer/i })).not.toBeInTheDocument()
  })

  it('non-vente : raison et objection traduites', () => {
    const debrief: ExistingDebrief = {
      sentAt: null,
      outcome: 'non_vente',
      nonSaleReason: 'suivi_prevu',
      objection: 'partenaire',
    }
    render(<PublicDebriefHistory client={client} commercialName={null} rdv={rdv} debrief={debrief} />)
    expect(screen.getByText('Vente non réalisée')).toBeInTheDocument()
    expect(screen.getByText('Suivi prévu')).toBeInTheDocument()
    expect(screen.getByText('Partenaire')).toBeInTheDocument()
    expect(screen.queryByText(/Envoyé le/)).not.toBeInTheDocument()
  })
})
