import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LeadResponse } from './types'

vi.mock('./api', () => ({
  API_BASE: 'http://test.local/api',
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  assignLeadToCommercial: vi.fn(),
}))

import { api } from './api'
import { useLeads, __testSeedFetchCache, __testResetFetchCache } from './hooks'

const apiMock = vi.mocked(api)

const lead = (firstName: string): LeadResponse => ({ id: `lead-${firstName}`, firstName } as LeadResponse)

function LeadsProbe({ city }: { city: string }) {
  const { data, loading } = useLeads({ city })
  if (loading) return <div>chargement…</div>
  return <div>{data?.map((l) => l.firstName).join(',') || 'vide'}</div>
}

// Clé produite par useLeads({ city }) : spread des filtres puis limit par défaut (250).
const leadsKey = (city: string) => `/leads?${JSON.stringify({ city, limit: 250 })}`

beforeEach(() => {
  apiMock.mockReset()
  __testResetFetchCache()
  window.localStorage.clear()
})

describe('cache TTL non destructif', () => {
  it('sert une entrée expirée immédiatement (pas de loader) puis refetch en fond', async () => {
    const ELEVEN_MINUTES = 11 * 60 * 1000
    __testSeedFetchCache(leadsKey('TTL-Ville'), {
      data: [lead('Ancienne')],
      timestamp: Date.now() - ELEVEN_MINUTES,
    })
    apiMock.mockResolvedValueOnce([lead('Fraiche')])

    render(<LeadsProbe city="TTL-Ville" />)

    // La donnée expirée est peinte tout de suite — jamais « chargement… ».
    expect(screen.getByText('Ancienne')).toBeTruthy()
    expect(screen.queryByText('chargement…')).toBeNull()

    // Le refetch de fond remplace par la donnée fraîche.
    expect(await screen.findByText('Fraiche')).toBeTruthy()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it("une entrée fraîche est servie sans aucun appel réseau", () => {
    __testSeedFetchCache(leadsKey('TTL-Fraiche'), {
      data: [lead('Recente')],
      timestamp: Date.now(),
    })

    render(<LeadsProbe city="TTL-Fraiche" />)

    expect(screen.getByText('Recente')).toBeTruthy()
    expect(apiMock).not.toHaveBeenCalled()
  })
})
