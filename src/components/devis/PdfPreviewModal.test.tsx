import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { PdfPreviewModal } from './PdfPreviewModal'

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  fetchDevisPdfObjectUrl: vi.fn(async () => 'blob:mock-url'),
}))

describe('PdfPreviewModal', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('charge puis affiche le PDF dans une iframe', async () => {
    render(<PdfPreviewModal devisId="dev-1" filename="devis.pdf" onClose={vi.fn()} />)
    const iframe = await waitFor(() => screen.getByTitle(/Aperçu du devis/i))
    expect(iframe.getAttribute('src')).toBe('blob:mock-url')
  })

  it('appelle onClose sur la touche Échap', async () => {
    const onClose = vi.fn()
    render(<PdfPreviewModal devisId="dev-1" onClose={onClose} />)
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('affiche un message d\'erreur si le chargement échoue', async () => {
    const { fetchDevisPdfObjectUrl } = await import('../../lib/api')
    vi.mocked(fetchDevisPdfObjectUrl).mockRejectedValueOnce(new Error('boom'))
    render(<PdfPreviewModal devisId="dev-err" onClose={vi.fn()} />)
    expect(await screen.findByText(/Chargement du PDF échoué/i)).toBeTruthy()
  })
})
