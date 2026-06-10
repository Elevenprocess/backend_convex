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
  it('moyenne = somme réelle ÷ nombre de setters actifs', () => {
    const setters = [
      setter({ id: 'a', calls: 100, classified: 20, rdvPris: 10 }),
      setter({ id: 'b', calls: 50, classified: 10, rdvPris: 4 }),
    ]
    const r = computeSetterAverages(setters, 5)
    expect(r.activeSetters).toBe(2)
    expect(r.totalCalls).toBe(150)
    expect(r.totalRdv).toBe(14)
    expect(r.avgCallsPerSetter).toBe(75)
    expect(r.avgRdvPerSetter).toBe(7)
  })

  it('exclut les setters inactifs (0 appel / 0 lead / 0 RDV) du diviseur', () => {
    const setters = [
      setter({ id: 'a', calls: 80, classified: 12, rdvPris: 8 }),
      setter({ id: 'idle' }), // ne doit pas diluer la moyenne
    ]
    const r = computeSetterAverages(setters, 4)
    expect(r.totalSetters).toBe(2)
    expect(r.activeSetters).toBe(1)
    expect(r.avgCallsPerSetter).toBe(80)
    expect(r.avgRdvPerSetter).toBe(8)
  })

  it('divise par les jours réels de la période pour la moyenne journalière', () => {
    const r = computeSetterAverages([setter({ id: 'a', calls: 100, rdvPris: 20, classified: 5 })], 10)
    expect(r.avgCallsPerSetterPerDay).toBe(10)
    expect(r.avgRdvPerSetterPerDay).toBe(2)
  })

  it('taux appel→RDV = total RDV ÷ total appels', () => {
    const r = computeSetterAverages([setter({ id: 'a', calls: 200, rdvPris: 20, classified: 5 })], 1)
    expect(r.rdvPerCallRate).toBe(10)
  })

  it('aucune division par zéro quand il n’y a aucun setter actif', () => {
    const r = computeSetterAverages([setter({ id: 'idle' })], 0)
    expect(r.activeSetters).toBe(0)
    expect(r.avgCallsPerSetter).toBe(0)
    expect(r.avgRdvPerSetter).toBe(0)
    expect(r.avgCallsPerSetterPerDay).toBe(0)
    expect(r.rdvPerCallRate).toBe(0)
  })
})
