import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MassDepositAssigner } from './MassDepositAssigner'
import type { SubstepResponse } from '../../lib/types'
import { uploadSubstepDocuments } from '../../lib/api'

vi.mock('../../lib/api', () => ({ uploadSubstepDocuments: vi.fn().mockResolvedValue([]) }))

function sub(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: 'x', stepId: 's', clientId: 'c', key: 'consuel_valide', position: 1,
    label: 'Consuel', actionLabel: 'A', phase: 'consuel', status: 'a_faire', optional: false,
    dateRealisee: null, deadline: null, responsableId: null, notes: null, problemReason: null,
    problemNotes: null, problemResolvedAt: null, metadata: {}, unlocked: true, missingDocument: false,
    expectedDocs: ['consuel'], documents: [], createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('MassDepositAssigner', () => {
  const targets = [sub({ id: 's1', label: 'VT', phase: 'vt' }), sub({ id: 's2', label: 'Consuel', phase: 'consuel' })]
  const files = [new File(['a'], 'photo.jpg', { type: 'image/jpeg' })]

  it('upload chaque fichier vers la sous-étape choisie puis appelle onDone', async () => {
    const onDone = vi.fn()
    render(<MassDepositAssigner files={files} targets={targets} onCancel={vi.fn()} onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(/photo\.jpg/i), { target: { value: 's2' } })
    fireEvent.click(screen.getByRole('button', { name: /déposer/i }))
    await waitFor(() => expect(uploadSubstepDocuments).toHaveBeenCalledWith('s2', [files[0]]))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
