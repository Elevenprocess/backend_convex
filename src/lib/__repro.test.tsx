import { it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const queryReturn: { value: unknown } = { value: undefined }
vi.mock('./convex', () => ({
  convexAuthEnabled: true,
  convexClient: { query: () => Promise.resolve(queryReturn.value) },
}))
vi.mock('./auth', () => ({
  useAuth: (sel: (s: unknown) => unknown) => sel({ user: { role: 'admin' }, realUser: { role: 'admin' } }),
}))

import { useConvexAnalyticsSummary } from './convexHooks'

it('mount → unmount → remount same key → new key', async () => {
  const v1 = { admin: { calls: 1 } }
  queryReturn.value = v1
  const filters = { from: 'x1', to: 'b' }
  const a = renderHook(() => useConvexAnalyticsSummary(filters))
  await waitFor(() => expect(a.result.current.data).toBe(v1))
  a.unmount()
  console.log('--- second mount same key ---')
  const b = renderHook(() => useConvexAnalyticsSummary(filters))
  await waitFor(() => expect(b.result.current.data).toEqual(v1))
  b.unmount()
  console.log('--- third mount new key ---')
  queryReturn.value = { admin: { calls: 2 } }
  const c = renderHook(() => useConvexAnalyticsSummary({ from: 'x2', to: 'b' }))
  await waitFor(() => expect((c.result.current.data as any)?.admin?.calls).toBe(2))
})
