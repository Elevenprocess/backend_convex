import { beforeEach, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const convexState = vi.hoisted(() => ({ isLoading: false, isAuthenticated: true, me: undefined as unknown }))

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isLoading: convexState.isLoading, isAuthenticated: convexState.isAuthenticated }),
  useQuery: () => convexState.me,
  makeFunctionReference: (name: string) => name,
}))
vi.mock('@convex-dev/auth/react', () => ({ useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }) }))

import { ConvexAuthBridge } from './ConvexAuthBridge'
import { useAuth } from '../../lib/auth'

const session = { real: { _id: 'u1', email: 'a@b.c', name: 'Ony', role: 'setter', _creationTime: 1 }, viewAs: null }

beforeEach(() => {
  Object.assign(convexState, { isLoading: false, isAuthenticated: true, me: session })
  useAuth.setState({ user: null, realUser: null, viewAsUser: null, status: 'loading' })
})

it("une micro-coupure de session n'éjecte pas la page connectée sur l'écran de chargement", () => {
  const view = render(<ConvexAuthBridge />)
  expect(useAuth.getState().status).toBe('authed')

  convexState.isLoading = true
  view.rerender(<ConvexAuthBridge />)
  expect(useAuth.getState().status).toBe('authed')

  convexState.isLoading = false
  convexState.me = undefined
  view.rerender(<ConvexAuthBridge />)
  expect(useAuth.getState().status).toBe('authed')
})

it('au démarrage, on attend bien la session', () => {
  convexState.isLoading = true
  convexState.me = undefined
  render(<ConvexAuthBridge />)
  expect(useAuth.getState().status).toBe('loading')
})

it('une vraie fin de session repasse en invité', () => {
  const view = render(<ConvexAuthBridge />)
  convexState.isAuthenticated = false
  convexState.me = undefined
  view.rerender(<ConvexAuthBridge />)
  expect(useAuth.getState().status).toBe('guest')
})

it('session sans utilisateur en base : reste en attente', () => {
  const view = render(<ConvexAuthBridge />)
  convexState.me = null
  view.rerender(<ConvexAuthBridge />)
  expect(useAuth.getState().status).toBe('loading')
})
