import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SubstepCard } from './SubstepCard'
import type { SubstepResponse } from '../../lib/types'

function sub(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: 'sub-1', stepId: 's', clientId: 'c', key: 'dp_envoyee_mairie', position: 2,
    label: 'DP envoyée à la mairie', actionLabel: 'Marquer envoyée', phase: 'dp',
    status: 'a_faire', optional: false, dateRealisee: null, deadline: null,
    responsableId: null, notes: null, problemReason: null, problemNotes: null,
    problemResolvedAt: null, metadata: {}, unlocked: true, missingDocument: false,
    expectedDocs: [], documents: [],
    createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('SubstepCard (nœud workflow)', () => {
  it('ouvre le pop-up au clic sur le nœud', () => {
    const onOpen = vi.fn()
    render(<SubstepCard substep={sub({})} today="2026-06-02" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /DP envoyée à la mairie/i }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('affiche le badge pièce manquante quand missingDocument', () => {
    render(<SubstepCard substep={sub({ missingDocument: true })} today="2026-06-02" onOpen={vi.fn()} />)
    expect(screen.getByText(/pièce manquante/i)).toBeInTheDocument()
  })

  it('affiche la jauge SLA J-x quand deadline', () => {
    render(<SubstepCard substep={sub({ deadline: '2026-06-30' })} today="2026-06-02" onOpen={vi.fn()} />)
    expect(screen.getByText('J-28')).toBeInTheDocument()
  })

  it('désactive le nœud et affiche « en attente » quand verrouillé', () => {
    render(<SubstepCard substep={sub({ unlocked: false })} today="2026-06-02" onOpen={vi.fn()} />)
    expect(screen.getByText(/en attente/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DP envoyée à la mairie/i })).toBeDisabled()
  })

  it('affiche un résumé pièces et le technicien attribué', () => {
    const s = sub({
      responsableId: 'u1',
      expectedDocs: ['consuel', 'autre'],
      documents: [{ id: 'd', type: 'consuel', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1024, uploadedAt: '' }],
    })
    render(<SubstepCard substep={s} users={[{ id: 'u1', name: 'Jean Tech', role: 'technicien' } as never]} today="2026-06-02" onOpen={vi.fn()} />)
    expect(screen.getByText(/1\/2 pièces/i)).toBeInTheDocument()
    expect(screen.getByText('Jean Tech')).toBeInTheDocument()
  })
})
