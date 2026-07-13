import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Les hooks de stats font des requêtes PONCTUELLES via convexClient.query (pas
// d'abonnement useQuery : chaque écriture ré-exécutait les full-scans côté
// serveur). On capture les appels pour vérifier le gating par rôle (un rôle
// non autorisé ne doit émettre AUCUNE requête) et la stabilité de `now`.
const queryCalls: { name: string; args: unknown }[] = []
// Valeur résolue par le mock — contrôlable pour tester le stale-while-revalidate.
const queryReturn: { value: unknown } = { value: undefined }
vi.mock('./convex', () => ({
  convexAuthEnabled: true,
  convexClient: {
    query: (ref: unknown, args: unknown) => {
      const name = String((ref as { toString?: () => string })?.toString?.() ?? ref)
      queryCalls.push({ name, args })
      return Promise.resolve(queryReturn.value)
    },
  },
}))

const roleRef: { role: string | null } = { role: 'admin' }
vi.mock('./auth', () => ({
  useAuth: (selector: (s: { user?: { role: string | null }; realUser?: { role: string | null } }) => unknown) =>
    selector({ user: { role: roleRef.role }, realUser: { role: roleRef.role } }),
}))

import {
  useConvexAnalyticsFunnel,
  useConvexAnalyticsSummary,
  useConvexCommercialAnalytics,
  useConvexDebriefAnalytics,
  useConvexSetterStats,
} from './convexHooks'

const lastArg = () => queryCalls[queryCalls.length - 1]?.args
// Le cache module-level des requêtes ponctuelles survit entre les tests : on
// varie les args (marqueur unique) pour garantir un vrai appel réseau par test.
let seq = 0
const uniq = () => `t${++seq}-${Math.random().toString(36).slice(2)}`
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  queryCalls.length = 0
  roleRef.role = 'admin'
  queryReturn.value = undefined
  localStorage.clear()
})

describe('gating et cycle de vie des stats Convex (requêtes ponctuelles)', () => {
  it('funnel : admin émet une requête avec les args, setter n’en émet aucune', async () => {
    roleRef.role = 'admin'
    const marker = uniq()
    renderHook(() => useConvexAnalyticsFunnel({ from: marker, to: 'b' }))
    await waitFor(() => expect(lastArg()).toMatchObject({ from: marker, to: 'b' }))

    queryCalls.length = 0
    roleRef.role = 'setter'
    const skipArgs1 = { from: uniq(), to: 'b' }
    renderHook(() => useConvexAnalyticsFunnel(skipArgs1))
    await flush()
    expect(queryCalls).toHaveLength(0)
  })

  it('summary : setter autorisé, technicien sans aucune requête', async () => {
    roleRef.role = 'setter'
    const marker = uniq()
    renderHook(() => useConvexAnalyticsSummary({ from: marker, to: 'b' }))
    await waitFor(() => expect(lastArg()).toMatchObject({ from: marker, to: 'b' }))

    queryCalls.length = 0
    roleRef.role = 'technicien'
    const skipArgs2 = { from: uniq() }
    renderHook(() => useConvexAnalyticsSummary(skipArgs2))
    await flush()
    expect(queryCalls).toHaveLength(0)
  })

  it('debriefStats : commercial autorisé, finances sans requête', async () => {
    roleRef.role = 'commercial'
    const marker = uniq()
    renderHook(() => useConvexDebriefAnalytics({ from: marker }))
    await waitFor(() => expect(lastArg()).toMatchObject({ from: marker }))

    queryCalls.length = 0
    roleRef.role = 'finances'
    const skipArgs3 = { from: uniq() }
    renderHook(() => useConvexDebriefAnalytics(skipArgs3))
    await flush()
    expect(queryCalls).toHaveLength(0)
  })

  it('setterStats : setter autorisé (ses propres stats), technicien et absence d’id → aucune requête', async () => {
    roleRef.role = 'setter'
    const marker = uniq()
    renderHook(() => useConvexSetterStats('u1', { from: marker, to: 'b' }))
    await waitFor(() => expect(lastArg()).toMatchObject({ setterId: 'u1', from: marker, to: 'b' }))

    queryCalls.length = 0
    roleRef.role = 'technicien'
    const skipArgs4 = { from: uniq() }
    renderHook(() => useConvexSetterStats('u1', skipArgs4))
    roleRef.role = 'setter'
    const skipArgs5 = { from: uniq() }
    renderHook(() => useConvexSetterStats(undefined, skipArgs5))
    await flush()
    expect(queryCalls).toHaveLength(0)
  })

  it('commercialStats : commercial autorisé, setter sans requête', async () => {
    roleRef.role = 'commercial'
    const marker = uniq()
    renderHook(() => useConvexCommercialAnalytics('u2', { from: marker }))
    await waitFor(() => expect(lastArg()).toMatchObject({ commercialId: 'u2', from: marker }))

    queryCalls.length = 0
    roleRef.role = 'setter'
    const skipArgs6 = { from: uniq() }
    renderHook(() => useConvexCommercialAnalytics('u2', skipArgs6))
    await flush()
    expect(queryCalls).toHaveLength(0)
  })

  it('cache ponctuel : un remontage sur la même période est servi SANS nouvelle requête ; une nouvelle période refait un appel', async () => {
    roleRef.role = 'admin'
    const v1 = { admin: { calls: 1130 } } as unknown
    queryReturn.value = v1
    const filters = { from: uniq(), to: 'b' }
    const first = renderHook(() => useConvexAnalyticsSummary(filters))
    await waitFor(() => expect(first.result.current.data).toBe(v1))
    expect(queryCalls).toHaveLength(1)
    first.unmount()

    // Remontage (navigation retour) sur la même période → cache mémoire, 0 requête.
    const second = renderHook(() => useConvexAnalyticsSummary(filters))
    await waitFor(() => expect(second.result.current.data).toEqual(v1))
    expect(queryCalls).toHaveLength(1)
    second.unmount()

    // Nouvelle période → nouvelle clé → un (seul) nouvel appel.
    const v2 = { admin: { calls: 990 } } as unknown
    queryReturn.value = v2
    // Args figés HORS rendu : des args recréés à chaque render changeraient la
    // clé en boucle (le hook mémorise par clé, pas par identité d'objet).
    const filters2 = { from: uniq(), to: 'b' }
    const third = renderHook(() => useConvexAnalyticsSummary(filters2))
    await waitFor(() => expect(third.result.current.data).toBe(v2))
    expect(queryCalls).toHaveLength(2)
  })

  it('stale-while-revalidate persistant : au remontage à froid, les derniers chiffres localStorage s’affichent pendant la requête', async () => {
    roleRef.role = 'admin'
    const v1 = { admin: { calls: 1130 } } as unknown
    queryReturn.value = v1
    const filters = { from: uniq(), to: 'b' }
    const first = renderHook(() => useConvexAnalyticsSummary(filters))
    await waitFor(() => expect(first.result.current.data).toBe(v1))
    first.unmount()

    // Simule une nouvelle session : cache mémoire vidé, localStorage conservé.
    const { __clearOneShotCacheForTests } = await import('./convexHooks')
    __clearOneShotCacheForTests()
    const v2 = { admin: { calls: 990 } } as unknown
    queryReturn.value = v2
    const second = renderHook(() => useConvexAnalyticsSummary(filters))
    // Avant la réponse réseau : les chiffres persistés s'affichent (pas de flash à 0).
    expect(second.result.current.data).toEqual(v1)
    expect(second.result.current.loading).toBe(true)
    await waitFor(() => expect(second.result.current.data).toBe(v2))
  })

  it('now est stable entre deux rendus (pas de refetch en boucle) et bucketé à 5 min', async () => {
    roleRef.role = 'admin'
    const marker = uniq()
    const { rerender } = renderHook(() => useConvexAnalyticsSummary({ from: marker }))
    await waitFor(() => expect(queryCalls.length).toBe(1))
    const first = (lastArg() as { now: number }).now
    rerender()
    await flush()
    expect(queryCalls.length).toBe(1) // pas de second appel : clé inchangée
    expect(first % 300_000).toBe(0)
  })
})
