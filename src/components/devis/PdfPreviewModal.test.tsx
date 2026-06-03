import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PdfPreviewModal } from './PdfPreviewModal'

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  fetchDevisPdfObjectUrl: vi.fn(async () => 'blob:mock-url'),
}))

describe('PdfPreviewModal', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: vi.fn() })
  })

  it('charge puis affiche le PDF dans une iframe', async () => {
    render(<PdfPreviewModal devisId="dev-1" filename="devis.pdf" onClose={vi.fn()} />)
    const iframe = await waitFor(() => screen.getByTitle(/Aperçu du devis/i))
    expect(iframe.getAttribute('src')).toBe('blob:mock-url')
  })

  it('appelle onClose sur la touche Échap', async () => {
    const onClose = vi.fn()
    render(<PdfPreviewModal devisId="dev-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
