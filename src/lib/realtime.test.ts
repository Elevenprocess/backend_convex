import { describe, it, expect } from 'vitest'
import { shouldSurfaceNotification } from './realtimeNotify'

describe('shouldSurfaceNotification', () => {
  it('affiche si pas de userId (broadcast legacy)', () => {
    expect(shouldSurfaceNotification(undefined, 'me')).toBe(true)
  })
  it('affiche si userId == moi', () => {
    expect(shouldSurfaceNotification('me', 'me')).toBe(true)
  })
  it("n'affiche pas si userId != moi", () => {
    expect(shouldSurfaceNotification('autre', 'me')).toBe(false)
  })
  it('affiche si je ne suis pas identifié (fallback legacy)', () => {
    expect(shouldSurfaceNotification('autre', null)).toBe(true)
  })
})
