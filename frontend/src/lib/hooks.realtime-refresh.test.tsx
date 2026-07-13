import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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
import { useLeads } from './hooks'
import { REALTIME_REFRESH_EVENT, type RealtimeRefreshPayload } from './realtime'

const apiMock = vi.mocked(api)

const lead = (firstName: string): LeadResponse => ({ id: `lead-${firstName}`, firstName } as LeadResponse)

function LeadsProbe({ city }: { city: string }) {
  const { data, loading } = useLeads({ city })
  if (loading) return <div>chargement…</div>
  return <div>{data?.map((l) => l.firstName).join(',') || 'vide'}</div>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function dispatchRealtimeRefresh(payload: RealtimeRefreshPayload) {
  window.dispatchEvent(new CustomEvent<RealtimeRefreshPayload>(REALTIME_REFRESH_EVENT, { detail: payload }))
}

beforeEach(() => {
  apiMock.mockReset()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('useFetch × refresh realtime', () => {
  it('garde les données affichées (pas de spinner) pendant le refetch déclenché par un event realtime', async () => {
    apiMock.mockResolvedValueOnce([lead('Alice')])
    render(<LeadsProbe city="Saint-Denis" />)
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(apiMock).toHaveBeenCalledTimes(1)

    // Refetch lent : les anciennes données doivent rester visibles pendant ce temps.
    const slow = deferred<LeadResponse[]>()
    apiMock.mockReturnValueOnce(slow.promise as Promise<unknown>)
    act(() => {
      dispatchRealtimeRefresh({ event: 'lead:updated', paths: ['/leads'] })
    })

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('chargement…')).toBeNull()
    expect(screen.getByText('Alice')).toBeTruthy()

    await act(async () => {
      slow.resolve([lead('Bob')])
      await slow.promise
    })
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('re-fetch en arrière-plan au montage quand un event realtime a rendu le cache stale (page non montée)', async () => {
    apiMock.mockResolvedValueOnce([lead('Alice')])
    const first = render(<LeadsProbe city="Saint-Pierre" />)
    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(apiMock).toHaveBeenCalledTimes(1)
    first.unmount()

    // Event reçu pendant que la page est démontée : le cache doit devenir stale.
    act(() => {
      dispatchRealtimeRefresh({ event: 'lead:updated', paths: ['/leads'] })
    })

    const slow = deferred<LeadResponse[]>()
    apiMock.mockReturnValueOnce(slow.promise as Promise<unknown>)
    render(<LeadsProbe city="Saint-Pierre" />)

    // Le cache s'affiche immédiatement (pas de spinner)…
    expect(screen.queryByText('chargement…')).toBeNull()
    expect(screen.getByText('Alice')).toBeTruthy()
    // …mais un refetch de fond est bien reparti.
    expect(apiMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      slow.resolve([lead('Bob')])
      await slow.promise
    })
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('réutilise le cache sans refetch au montage quand aucun event ne l’a invalidé', async () => {
    apiMock.mockResolvedValueOnce([lead('Alice')])
    const first = render(<LeadsProbe city="Le Tampon" />)
    expect(await screen.findByText('Alice')).toBeTruthy()
    first.unmount()

    render(<LeadsProbe city="Le Tampon" />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })
})
