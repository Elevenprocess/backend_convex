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

describe('SubstepCard', () => {
  it('affiche le actionLabel et déclenche onMutate(status:fait) au clic', () => {
    const onMutate = vi.fn()
    render(<SubstepCard substep={sub({})} onMutate={onMutate} today="2026-06-02" />)
    fireEvent.click(screen.getByRole('button', { name: 'Marquer envoyée' }))
    expect(onMutate).toHaveBeenCalledWith('sub-1', expect.objectContaining({ status: 'fait', dateRealisee: '2026-06-02' }))
  })

  it("affiche 'Rouvrir' quand fait", () => {
    render(<SubstepCard substep={sub({ status: 'fait', dateRealisee: '2026-06-01' })} onMutate={vi.fn()} today="2026-06-02" />)
    expect(screen.getByRole('button', { name: 'Rouvrir' })).toBeInTheDocument()
  })

  it('affiche le badge pièce manquante quand missingDocument', () => {
    render(<SubstepCard substep={sub({ missingDocument: true })} onMutate={vi.fn()} today="2026-06-02" />)
    expect(screen.getByText(/pièce manquante/i)).toBeInTheDocument()
  })

  it('affiche la jauge SLA J-x quand deadline', () => {
    render(<SubstepCard substep={sub({ deadline: '2026-06-30' })} onMutate={vi.fn()} today="2026-06-02" />)
    expect(screen.getByText('J-28')).toBeInTheDocument()
  })

  it('grise et désactive le bouton quand verrouillé', () => {
    render(<SubstepCard substep={sub({ unlocked: false })} onMutate={vi.fn()} today="2026-06-02" />)
    expect(screen.getByText(/en attente/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marquer envoyée' })).toBeDisabled()
  })
})
