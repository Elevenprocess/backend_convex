import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mode Convex : VITE_CONVEX_URL doit être posé AVANT l'import du module
// (convexAuthEnabled est évalué au chargement) — d'où resetModules + import dynamique.
async function loadAuthInConvexMode() {
  vi.stubEnv('VITE_CONVEX_URL', 'https://test-123.convex.cloud')
  vi.resetModules()
  return await import('./auth')
}

describe('useAuth en mode Convex', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('signIn délègue au backend configuré (flow signUp) et passe en loading', async () => {
    const { useAuth, configureAuthBackend } = await loadAuthInConvexMode()
    const signIn = vi.fn().mockResolvedValue(undefined)
    configureAuthBackend({ signIn, signOut: vi.fn() })

    const res = await useAuth.getState().signIn('a@b.c', 'pw', { signUp: true })

    expect(signIn).toHaveBeenCalledWith('a@b.c', 'pw', 'signUp')
    expect(res).toBeNull()
    expect(useAuth.getState().status).toBe('loading')
  })

  it('signIn sans opts → flow signIn', async () => {
    const { useAuth, configureAuthBackend } = await loadAuthInConvexMode()
    const signIn = vi.fn().mockResolvedValue(undefined)
    configureAuthBackend({ signIn, signOut: vi.fn() })

    await useAuth.getState().signIn('a@b.c', 'pw')

    expect(signIn).toHaveBeenCalledWith('a@b.c', 'pw', 'signIn')
  })

  it('signOut délègue et repasse guest', async () => {
    const { useAuth, configureAuthBackend } = await loadAuthInConvexMode()
    const signOut = vi.fn().mockResolvedValue(undefined)
    configureAuthBackend({ signIn: vi.fn(), signOut })
    useAuth.setState({ status: 'authed' })

    await useAuth.getState().signOut()

    expect(signOut).toHaveBeenCalled()
    expect(useAuth.getState().status).toBe('guest')
    expect(useAuth.getState().user).toBeNull()
  })

  it('hydrate est un no-op (la session vient du pont)', async () => {
    const { useAuth } = await loadAuthInConvexMode()
    useAuth.setState({ status: 'authed' })
    await useAuth.getState().hydrate()
    expect(useAuth.getState().status).toBe('authed')
  })

  it('signIn sans pont monté → erreur explicite', async () => {
    const { useAuth } = await loadAuthInConvexMode()
    await expect(useAuth.getState().signIn('a@b.c', 'pw')).rejects.toThrow(/ConvexAuthBridge/)
  })
})
