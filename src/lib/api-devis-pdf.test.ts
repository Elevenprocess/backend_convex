// src/lib/api-devis-pdf.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, fetchDevisPdfObjectUrl } from './api'

describe('fetchDevisPdfObjectUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url') })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renvoie un object URL quand la requête réussit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    })))
    const url = await fetchDevisPdfObjectUrl('dev-1')
    expect(url).toBe('blob:mock-url')
  })

  it('lève une ApiError si la requête échoue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'introuvable',
    })))
    await expect(fetchDevisPdfObjectUrl('dev-1')).rejects.toBeInstanceOf(ApiError)
  })
})
