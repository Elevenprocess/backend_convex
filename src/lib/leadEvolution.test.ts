import { describe, expect, it } from 'vitest'
import { buildLeadEvolutionPoints, chooseGranularity, type EvolutionDailyInput } from './leadEvolution'

function day(date: string, classified: number, rdv: number, signed: number): EvolutionDailyInput {
  return { date, label: date.slice(8), calls: 0, rdv, signed, ca: 0, classified }
}

const HUGE_TOTALS = { leads: 999, rdv: 999, signed: 999 }

describe('buildLeadEvolutionPoints — données réelles par jour', () => {
  it('trace les vraies valeurs quotidiennes sans les forcer à égaler les totaux', () => {
    const daily = [
      day('2026-06-01', 3, 1, 0),
      day('2026-06-02', 0, 0, 0),
      day('2026-06-03', 5, 2, 1),
    ]
    const points = buildLeadEvolutionPoints(daily, [], { from: '2026-06-01', to: '2026-06-03', days: 3 }, 'day', HUGE_TOTALS)

    expect(points.map((p) => p.leads)).toEqual([3, 0, 5])
    expect(points.map((p) => p.rdv)).toEqual([1, 0, 2])
    expect(points.map((p) => p.signed)).toEqual([0, 0, 1])
  })

  it("ne déverse pas le total sur le dernier point quand la série est nulle (cause de l'oblique)", () => {
    const daily = [
      day('2026-06-01', 0, 0, 0),
      day('2026-06-02', 0, 0, 0),
      day('2026-06-03', 0, 0, 0),
      day('2026-06-04', 0, 0, 0),
      day('2026-06-05', 0, 0, 0),
    ]
    const points = buildLeadEvolutionPoints(daily, [], { from: '2026-06-01', to: '2026-06-05', days: 5 }, 'day', { leads: 100, rdv: 0, signed: 0 })

    expect(points.map((p) => p.leads)).toEqual([0, 0, 0, 0, 0])
  })

  it('agrège les vraies valeurs quotidiennes par semaine (somme, sans hydratation)', () => {
    const daily = [
      // semaine du 1er juin (lun 1 → dim 7)
      day('2026-06-01', 2, 1, 0),
      day('2026-06-03', 4, 0, 1),
      // semaine du 8 juin
      day('2026-06-08', 5, 2, 0),
    ]
    const points = buildLeadEvolutionPoints(daily, [], { from: '2026-06-01', to: '2026-06-12', days: 12 }, 'week', HUGE_TOTALS)

    expect(points).toHaveLength(2)
    expect(points.map((p) => p.leads)).toEqual([6, 5])
    expect(points.map((p) => p.signed)).toEqual([1, 0])
  })
})

describe('chooseGranularity', () => {
  it('reste en jours pour une plage courte de 2-3 jours', () => {
    expect(chooseGranularity({ from: '2026-06-01', to: '2026-06-03' })).toBe('day')
  })
  it('passe en heures pour une seule journée', () => {
    expect(chooseGranularity({ from: '2026-06-01', to: '2026-06-01' })).toBe('hour')
  })
})
