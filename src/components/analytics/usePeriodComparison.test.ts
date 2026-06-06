import { describe, it, expect } from 'vitest'
import { computeDelta } from './usePeriodComparison'

describe('computeDelta', () => {
  it('calcule un pourcentage positif', () => {
    expect(computeDelta(120, 100)).toEqual({ value: 120, previousValue: 100, deltaPct: 20 })
  })
  it('calcule un pourcentage négatif', () => {
    expect(computeDelta(80, 100)).toEqual({ value: 80, previousValue: 100, deltaPct: -20 })
  })
  it('renvoie deltaPct null quand la valeur précédente est 0', () => {
    expect(computeDelta(50, 0)).toEqual({ value: 50, previousValue: 0, deltaPct: null })
  })
  it('arrondit le pourcentage', () => {
    expect(computeDelta(133, 100).deltaPct).toBe(33)
  })
})
