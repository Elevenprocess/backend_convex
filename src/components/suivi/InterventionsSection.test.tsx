import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { InterventionResponse } from '../../lib/types'

const intervention = (over: Partial<InterventionResponse>): InterventionResponse => ({
  id: 'i1',
  clientId: 'c1',
  type: 'reparation',
  status: 'realisee',
  motif: 'Onduleur remplacé',
  observations: 'RAS après test de production',
  technicienId: null,
  technicienName: 'Théo Tech',
  datePlanifiee: null,
  heure: null,
  dateRealisee: '2026-06-20T09:00:00.000Z',
  createdAt: '2026-06-18T10:00:00.000Z',
  files: [],
  client: { leadId: 'l1', fullName: 'Jean Livré', city: 'Saint-Denis' },
  ...over,
})

const ROWS: InterventionResponse[] = [
  intervention({
    id: 'i1',
    files: [{ id: 'f1', filename: 'photo-chantier.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 }],
  }),
]

vi.mock('../../lib/hooks', () => ({
  useInterventions: () => ({ data: ROWS, loading: false, error: null, refetch: () => {} }),
}))

import { InterventionsSection } from './InterventionsSection'

describe('InterventionsSection — historique SAV du dossier', () => {
  it('affiche motif, observations et statut', () => {
    render(<InterventionsSection clientId="c1" canManage />)
    expect(screen.getByText('Onduleur remplacé')).toBeTruthy()
    expect(screen.getByText('RAS après test de production')).toBeTruthy()
    expect(screen.getByText('Réalisée')).toBeTruthy()
  })

  it('affiche les photos en vignette <img>', () => {
    render(<InterventionsSection clientId="c1" canManage />)
    const img = screen.getByAltText('photo-chantier.jpg')
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toContain('/interventions/i1/files/f1/raw')
  })

  it('canManage=false → pas de zone de dépôt de fichiers', () => {
    render(<InterventionsSection clientId="c1" canManage={false} />)
    expect(screen.queryByText(/Déposer/)).toBeNull()
  })
})
