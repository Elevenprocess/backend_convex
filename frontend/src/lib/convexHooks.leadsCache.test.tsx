import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Cache disque des listes leads/clients (stale-while-revalidate) : pendant le
// premier chargement on sert la liste de la session précédente (fetchCache,
// hydratée depuis IndexedDB au boot), puis le live prend le relais et réécrit
// le cache. Cf. useConvexLeads dans convexHooks.ts.

type PaginatedState = {
  results: unknown[]
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
  loadMore: (n: number) => void
}
const paginated: PaginatedState = { results: [], status: 'LoadingFirstPage', loadMore: () => {} }
vi.mock('convex/react', () => ({
  usePaginatedQuery: () => paginated,
  useQuery: () => undefined,
}))
vi.mock('./convex', () => ({ convexAuthEnabled: true, convexClient: { query: () => Promise.resolve(undefined) } }))
vi.mock('./auth', () => ({
  useAuth: (selector: (s: { user?: { id: string } }) => unknown) => selector({ user: { id: 'u1' } }),
}))
const persisted: { key: string; rows: number }[] = []
vi.mock('./cachePersist', () => ({
  persistEntry: (key: string, entry: { data: unknown[] }) => persisted.push({ key, rows: entry.data.length }),
}))

import { useConvexLeads } from './convexHooks'
import { fetchCache } from './fetchCacheStore'

const doc = (id: string) => ({ _id: id, _creationTime: 1, source: 'ghl', status: 'qualifie', createdAt: 1 })
const cachedLead = (id: string) => ({ id, status: 'qualifie' }) as never

const KEY_DEFAULT = 'convex:leads:u1:{"status":null,"setterId":null,"assignedToId":null,"city":null,"scope":null}'
const KEY_CLIENTS = 'convex:leads:u1:{"status":null,"setterId":null,"assignedToId":null,"city":null,"scope":"clients"}'

beforeEach(() => {
  fetchCache.clear()
  persisted.length = 0
  paginated.results = []
  paginated.status = 'LoadingFirstPage'
})

describe('useConvexLeads — cache disque stale-while-revalidate', () => {
  it('sans cache : premier chargement = loading plein écran', () => {
    const { result } = renderHook(() => useConvexLeads({}))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('avec cache : la liste de la dernière session peint pendant le chargement', () => {
    fetchCache.set(KEY_DEFAULT, { data: [cachedLead('a'), cachedLead('b')], timestamp: Date.now() })
    const { result } = renderHook(() => useConvexLeads({}))
    expect(result.current.loading).toBe(false)
    expect(result.current.backgroundLoading).toBe(true)
    expect(result.current.data).toHaveLength(2)
  })

  it('le live remplace le cache dès la première page et réécrit le disque', () => {
    fetchCache.set(KEY_DEFAULT, { data: [cachedLead('a'), cachedLead('b'), cachedLead('c')], timestamp: Date.now() })
    paginated.results = [doc('l1')]
    paginated.status = 'CanLoadMore'
    const { result } = renderHook(() => useConvexLeads({}))
    // Page fenêtrée : bascule immédiate sur le live même s'il est plus court.
    expect(result.current.data?.map((l) => l.id)).toEqual(['l1'])
    expect(persisted.some((p) => p.key === KEY_DEFAULT && p.rows === 1)).toBe(true)
  })

  it('scope=clients : le cache reste affiché pendant le drain, le live prend le relais à la fin', () => {
    fetchCache.set(KEY_CLIENTS, { data: [cachedLead('a'), cachedLead('b'), cachedLead('c')], timestamp: Date.now() })
    paginated.results = [doc('l1')]
    paginated.status = 'CanLoadMore'
    const { result, rerender } = renderHook(() => useConvexLeads({ scope: 'clients' }))
    expect(result.current.data).toHaveLength(3)
    expect(result.current.backgroundLoading).toBe(true)
    // Drain terminé → live affiché même s'il est plus court (suppressions).
    paginated.results = [doc('l1'), doc('l2')]
    paginated.status = 'Exhausted'
    rerender()
    expect(result.current.data?.map((l) => l.id)).toEqual(['l1', 'l2'])
    expect(result.current.backgroundLoading).toBe(false)
  })

  it('pas de cache pour une recherche', () => {
    fetchCache.set(KEY_DEFAULT, { data: [cachedLead('a')], timestamp: Date.now() })
    const { result } = renderHook(() => useConvexLeads({ search: 'dupont' }))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
  })
})
