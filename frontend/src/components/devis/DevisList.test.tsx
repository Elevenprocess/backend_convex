import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DevisList } from './DevisList'
import type { Devis } from '../../lib/types'

vi.mock('../../lib/api', () => ({
  getDevis: vi.fn(async () => ({
    id: 'dev-1', leadId: 'lead-1', filename: 'x.pdf', status: 'en_attente',
    ocrStatus: 'done', ocrError: null, devisNumber: null, devisDate: null,
  })),
  markDevisSigned: vi.fn(),
  retryDevisOcr: vi.fn(),
  updateDevis: vi.fn(),
  ApiError: class ApiError extends Error {},
  fetchDevisPdfObjectUrl: vi.fn(async () => 'blob:mock-url'),
}))

function devis(over: Partial<Devis>): Devis {
  return {
    id: 'dev-1',
    leadId: 'lead-1',
    filename: '1717000000-charabia.pdf',
    status: 'en_attente',
    ocrStatus: 'processing',
    ocrError: null,
    devisNumber: null,
    devisDate: null,
    ...over,
  } as Devis
}

describe('DevisList — états de scan', () => {
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

  it('affiche le loader pendant le scan, pas la carte vide', () => {
    render(<DevisList devisList={[devis({ ocrStatus: 'processing' })]} onChange={vi.fn()} />)
    expect(screen.getByText(/Analyse du devis en cours/i)).toBeTruthy()
    expect(screen.queryByText(/Émetteur/i)).toBeNull()
    expect(screen.queryByText(/charabia\.pdf/i)).toBeNull()
  })

  it("affiche le bouton « Voir le PDF » quand l'OCR est terminé et ouvre la modale", async () => {
    render(<DevisList devisList={[devis({ ocrStatus: 'done' })]} onChange={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /Voir le PDF/i })
    fireEvent.click(btn)
    const iframe = await waitFor(() => screen.getByTitle(/Aperçu du devis/i))
    expect(iframe.getAttribute('src')).toBe('blob:mock-url')
  })

  it('replie la carte devis : masque le corps, garde résumé (TTC) + footer', () => {
    window.localStorage.clear()
    render(<DevisList devisList={[devis({
      ocrStatus: 'done',
      devisNumber: 'D-123',
      montantTtc: '12000',
      extracted: { customer: { firstName: 'Jean', lastName: 'Test' } },
    } as Partial<Devis>)]} onChange={vi.fn()} />)
    expect(screen.getByText(/Émetteur/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Réduire/i }))
    expect(screen.queryByText(/Émetteur/i)).toBeNull()
    expect(screen.getByText(/D-123/)).toBeInTheDocument()
    expect(screen.getByText((t) => t.replace(/\s/g, '').includes('12000'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Voir le PDF/i })).toBeInTheDocument()
  })
})
