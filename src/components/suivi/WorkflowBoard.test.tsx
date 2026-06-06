import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkflowBoard } from './WorkflowBoard'
import type { SubstepResponse } from '../../lib/types'

function sub(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: over.key ?? 'x', stepId: 's', clientId: 'c', key: 'vt_planifie', position: 1,
    label: over.key ?? 'L', actionLabel: 'A', phase: 'vt', status: 'a_faire', optional: false,
    dateRealisee: null, deadline: null, responsableId: null, notes: null, problemReason: null,
    problemNotes: null, problemResolvedAt: null, metadata: {}, unlocked: true, missingDocument: false,
    expectedDocs: [], documents: [],
    createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('WorkflowBoard', () => {
  const substeps = [
    sub({ key: 'vt_planifie', phase: 'vt', position: 1 }),
    sub({ key: 'dp_a_faire', phase: 'dp', position: 1 }),
    sub({ key: 'racco_a_faire', phase: 'racco', position: 1 }),
    sub({ key: 'consuel_valide', phase: 'consuel', position: 2 }),
    sub({ key: 'install_a_faire', phase: 'installation', position: 1 }),
  ]

  it('rend les 3 sections et les 2 colonnes back-office', () => {
    render(<WorkflowBoard substeps={substeps} onMutate={vi.fn()} today="2026-06-02" />)
    expect(screen.getByText(/Préparation/i)).toBeInTheDocument()
    expect(screen.getByText(/Démarches administratives/i)).toBeInTheDocument()
    expect(screen.getByText('Déclaration préalable')).toBeInTheDocument()
    expect(screen.getByText('Raccordement → Consuel')).toBeInTheDocument()
    expect(screen.getByText(/Installation & clôture/i)).toBeInTheDocument()
  })

  it('affiche chaque sous-étape par son label', () => {
    render(<WorkflowBoard substeps={substeps} onMutate={vi.fn()} today="2026-06-02" />)
    expect(screen.getByText('vt_planifie')).toBeInTheDocument()
    expect(screen.getByText('dp_a_faire')).toBeInTheDocument()
    expect(screen.getByText('consuel_valide')).toBeInTheDocument()
  })
})
