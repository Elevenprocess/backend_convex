import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Capture les arguments passés à useQuery pour vérifier le gating par rôle
// (un rôle non autorisé DOIT produire 'skip', sinon la query Convex throw au
// rendu et fait planter/redémarrer la page) et la stabilité de `now`.
const useQueryCalls: unknown[] = []
vi.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    useQueryCalls.push(args)
    return undefined // état "chargement"
  },
  usePaginatedQuery: () => ({ results: [], status: 'LoadingFirstPage', loadMore: vi.fn() }),
}))

const roleRef: { role: string | null } = { role: 'admin' }
vi.mock('./auth', () => ({
  useAuth: (selector: (s: { user?: { role: string | null }; realUser?: { role: string | null } }) => unknown) =>
    selector({ user: { role: roleRef.role }, realUser: { role: roleRef.role } }),
}))

import { useConvexAnalyticsFunnel, useConvexAnalyticsSummary, useConvexDebriefAnalytics } from './convexHooks'

const lastArg = () => useQueryCalls[useQueryCalls.length - 1]

beforeEach(() => {
  useQueryCalls.length = 0
  roleRef.role = 'admin'
})

describe('gating des analytics Convex par rôle', () => {
  it('funnel : admin passe des args, setter est skip', () => {
    roleRef.role = 'admin'
    const admin = renderHook(() => useConvexAnalyticsFunnel({ from: 'a', to: 'b' }))
    expect(lastArg()).toMatchObject({ from: 'a', to: 'b' })
    expect(admin.result.current.data).toBeNull() // undefined→null tant que ça charge

    roleRef.role = 'setter'
    renderHook(() => useConvexAnalyticsFunnel({ from: 'a', to: 'b' }))
    expect(lastArg()).toBe('skip')
  })

  it('summary : setter autorisé, technicien skip', () => {
    roleRef.role = 'setter'
    renderHook(() => useConvexAnalyticsSummary({ from: 'a', to: 'b' }))
    expect(lastArg()).toMatchObject({ from: 'a', to: 'b' })

    roleRef.role = 'technicien'
    renderHook(() => useConvexAnalyticsSummary({}))
    expect(lastArg()).toBe('skip')
  })

  it('debriefStats : commercial autorisé, finances skip', () => {
    roleRef.role = 'commercial'
    renderHook(() => useConvexDebriefAnalytics({ from: 'a' }))
    expect(lastArg()).toMatchObject({ from: 'a' })

    roleRef.role = 'finances'
    renderHook(() => useConvexDebriefAnalytics({}))
    expect(lastArg()).toBe('skip')
  })

  it('now est stable entre deux rendus (pas de refetch en boucle)', () => {
    roleRef.role = 'admin'
    const { rerender } = renderHook(() => useConvexAnalyticsSummary({ from: 'a' }))
    const first = (lastArg() as { now: number }).now
    rerender()
    const second = (lastArg() as { now: number }).now
    expect(second).toBe(first)
    // bucketé à 5 min
    expect(first % 300_000).toBe(0)
  })
})
