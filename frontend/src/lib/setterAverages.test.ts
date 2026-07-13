import { describe, it, expect } from 'vitest'
import { computeSetterAverages } from './setterAverages'
import type { AnalyticsSetterPerf } from './types'

function setter(p: Partial<AnalyticsSetterPerf> & { id: string }): AnalyticsSetterPerf {
  return {
    name: p.id,
    initials: p.id.slice(0, 2).toUpperCase(),
    calls: 0,
    connected: 0,
    classified: 0,
    qualified: 0,
    rdvPris: 0,
    efficiency: 0,
    ...p,
  }
}

describe('computeSetterAverages', () => {
  it('moyenne = somme réelle ÷ nombre de setters actifs (qualifiés, pas RDV)', () => {
    const setters = [
      setter({ id: 'a', calls: 100, classified: 20, qualified: 12 }),
      setter({ id: 'b', calls: 50, classified: 10, qualified: 6 }),
    ]
    const r = computeSetterAverages(setters, 5)
    expect(r.activeSetters).toBe(2)
    expect(r.totalCalls).toBe(150)
    expect(r.totalQualified).toBe(18)
    expect(r.avgCallsPerSetter).toBe(75)
    expect(r.avgQualifiedPerSetter).toBe(9)
  })

  it('exclut les setters inactifs (0 appel / 0 lead traité) du diviseur', () => {
    const setters = [
      setter({ id: 'a', calls: 80, classified: 12, qualified: 8 }),
      setter({ id: 'idle' }), // ne doit pas diluer la moyenne
    ]
    const r = computeSetterAverages(setters, 4)
    expect(r.totalSetters).toBe(2)
    expect(r.activeSetters).toBe(1)
    expect(r.avgCallsPerSetter).toBe(80)
    expect(r.avgQualifiedPerSetter).toBe(8)
  })

  it('divise par les jours réels de la période pour la moyenne journalière', () => {
    const r = computeSetterAverages([setter({ id: 'a', calls: 100, qualified: 20, classified: 25 })], 10)
    expect(r.avgCallsPerSetterPerDay).toBe(10)
    expect(r.avgQualifiedPerSetterPerDay).toBe(2)
  })

  it('taux appel→qualifié = total qualifiés ÷ total appels', () => {
    const r = computeSetterAverages([setter({ id: 'a', calls: 200, qualified: 20, classified: 25 })], 1)
    expect(r.qualifiedPerCallRate).toBe(10)
  })

  it('aucune division par zéro quand il n’y a aucun setter actif', () => {
    const r = computeSetterAverages([setter({ id: 'idle' })], 0)
    expect(r.activeSetters).toBe(0)
    expect(r.avgCallsPerSetter).toBe(0)
    expect(r.avgQualifiedPerSetter).toBe(0)
    expect(r.avgQualifiedPerSetterPerDay).toBe(0)
    expect(r.qualifiedPerCallRate).toBe(0)
  })
})
