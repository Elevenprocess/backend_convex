import { describe, it, expect } from 'vitest'
import { simulatedProgress, PROGRESS_CEIL } from './scanProgress'

describe('simulatedProgress', () => {
  it('vaut 0 à t=0 et pour un temps négatif', () => {
    expect(simulatedProgress(0)).toBe(0)
    expect(simulatedProgress(-500)).toBe(0)
  })

  it('est croissante avec le temps écoulé', () => {
    expect(simulatedProgress(1000)).toBeLessThan(simulatedProgress(5000))
  })

  it('ne dépasse jamais le plafond et finit par l\'atteindre', () => {
    expect(simulatedProgress(1_000_000)).toBe(PROGRESS_CEIL)
    expect(simulatedProgress(8000)).toBeLessThanOrEqual(PROGRESS_CEIL)
  })

  it('renvoie un entier', () => {
    expect(Number.isInteger(simulatedProgress(3000))).toBe(true)
  })
})
