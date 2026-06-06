import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentsHub } from './DocumentsHub'
import type { SubstepResponse } from '../../lib/types'

vi.mock('../../lib/api', () => ({
  uploadSubstepDocuments: vi.fn().mockResolvedValue([]),
  deleteSubstepDocument: vi.fn().mockResolvedValue({ ok: true }),
  substepDocumentRawUrl: (id: string) => `/documents/${id}/raw`,
}))

function sub(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: 'x', stepId: 's', clientId: 'c', key: 'consuel_valide', position: 1,
    label: 'Consuel', actionLabel: 'A', phase: 'consuel', status: 'a_faire', optional: false,
    dateRealisee: null, deadline: null, responsableId: null, notes: null, problemReason: null,
    problemNotes: null, problemResolvedAt: null, metadata: {}, unlocked: true, missingDocument: false,
    expectedDocs: [], documents: [], createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('DocumentsHub', () => {
  const substeps = [
    sub({ id: 's1', phase: 'vt', label: 'VT', expectedDocs: ['autre'], documents: [{ id: 'd1', type: 'autre', filename: 'vt.pdf', mimeType: 'application/pdf', sizeBytes: 2048, uploadedAt: '' }] }),
    sub({ id: 's2', phase: 'consuel', label: 'Consuel', expectedDocs: ['consuel'], documents: [] }),
  ]

  it('affiche le compteur global présentes/attendues', () => {
    render(<DocumentsHub substeps={substeps} today="2026-06-02" onDocsChanged={vi.fn()} />)
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('liste les pièces présentes et les manquantes', () => {
    render(<DocumentsHub substeps={substeps} today="2026-06-02" onDocsChanged={vi.fn()} />)
    expect(screen.getByText('vt.pdf')).toBeInTheDocument()
    expect(screen.getAllByText(/manquante/i).length).toBeGreaterThan(0)
  })

  it('le filtre « manquantes » masque les pièces présentes', () => {
    render(<DocumentsHub substeps={substeps} today="2026-06-02" onDocsChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /manquantes/i }))
    expect(screen.queryByText('vt.pdf')).not.toBeInTheDocument()
  })
})
