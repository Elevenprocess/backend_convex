import { afterEach, describe, expect, it, vi } from 'vitest'

// En mode Convex, api() ne doit JAMAIS toucher le réseau (plus de 500 sur le
// NestJS de prod). On stubbe VITE_CONVEX_URL avant l'import (convexAuthEnabled
// est figé au chargement du module).
async function loadApiInConvexMode() {
  vi.stubEnv('VITE_CONVEX_URL', 'https://test-123.convex.cloud')
  vi.resetModules()
  return await import('./api')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('api() en mode Convex', () => {
  it('rejette sans appel réseau (fetch jamais invoqué)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { api, ApiError } = await loadApiInConvexMode()

    await expect(api('/leads/x/debriefs')).rejects.toBeInstanceOf(ApiError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("l'erreur porte le code CONVEX_MODE et le path", async () => {
    const { api } = await loadApiInConvexMode()
    await api('/assistant/conversations').catch((e) => {
      expect(e.code).toBe('CONVEX_MODE')
      expect(String(e.message)).toContain('/assistant/conversations')
    })
    expect.assertions(2)
  })
})
