import { describe, expect, it } from 'vitest'
import { buildLeadEvolutionPoints, chooseGranularity, type EvolutionDailyInput } from './leadEvolution'

function day(date: string, classified: number, rdv: number, signed: number): EvolutionDailyInput {
  return { date, label: date.slice(8), calls: 0, rdv, signed, ca: 0, classified }
}

const HUGE_TOTALS = { leads: 999, qualified: 999, signed: 999 }

describe('buildLeadEvolutionPoints — données réelles par jour', () => {
  it('trace les vraies valeurs quotidiennes sans les forcer à égaler les totaux', () => {
    const daily = [
      day('2026-06-01', 3, 1, 0),
      day('2026-06-02', 0, 0, 0),
      day('2026-06-03', 5, 2, 1),
    ]
    const points = buildLeadEvolutionPoints(daily, [], { from: '2026-06-01', to: '2026-06-03', days: 3 }, 'day', HUGE_TOTALS)

    expect(points.map((p) => p.leads)).toEqual([3, 0, 5])
    expect(points.map((p) => p.qualified)).toEqual([1, 0, 2])
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
    const points = buildLeadEvolutionPoints(daily, [], { from: '2026-06-01', to: '2026-06-05', days: 5 }, 'day', { leads: 100, qualified: 0, signed: 0 })

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

describe('buildLeadEvolutionPoints — liste par bucket + comptage réel horaire', () => {
  const at = (h: number, m: number) =>
    new Date(`2026-06-03T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

  it('vue horaire : qualified/signed comptés en réel et items rattachés à la bonne heure', () => {
    const daily = [day('2026-06-03', 10, 8, 3)] // totaux prorata volontairement ignorés
    const range = { from: '2026-06-03', to: '2026-06-03', days: 1 }
    expect(chooseGranularity(range)).toBe('hour')
    const events = {
      qualified: [
        { id: 'q1', t: at(9, 30), name: 'Alice', agent: 'Setter A' },
        { id: 'q2', t: at(9, 45), name: 'Bob', agent: 'Setter B' },
        { id: 'q3', t: at(14, 5), name: 'Carla', agent: null },
      ],
      signed: [{ id: 's1', t: at(14, 15), name: 'Client X', agent: 'Com Z' }],
    }
    const points = buildLeadEvolutionPoints(daily, [], range, 'hour', HUGE_TOTALS, undefined, events)
    const h9 = points.find((p) => p.t === at(9, 0))!
    const h14 = points.find((p) => p.t === at(14, 0))!
    expect(h9.qualified).toBe(2)
    expect(h9.qualifiedItems?.map((i) => i.name)).toEqual(['Alice', 'Bob'])
    expect(h14.qualified).toBe(1)
    expect(h14.signed).toBe(1)
    expect(h14.signedItems?.[0].agent).toBe('Com Z')
    // le badge horaire ne provient plus du prorata des totaux (999)
    expect(h9.signed).toBe(0)
  })

  it('vue jour : garde les agrégats backend mais rattache la liste au bucket', () => {
    const daily = [day('2026-06-03', 4, 2, 1)]
    const events = { qualified: [{ id: 'q1', t: at(11, 0), name: 'Alice', agent: 'Setter A' }] }
    // granularité 'day' forcée (ex. plage multi-jours) : comptage backend inchangé.
    const points = buildLeadEvolutionPoints(daily, [], { from: '2026-06-01', to: '2026-06-03', days: 3 }, 'day', HUGE_TOTALS, undefined, events)
    const p = points.find((pt) => pt.date === '2026-06-03')!
    expect(p.qualified).toBe(2) // agrégat backend, PAS la longueur de la liste
    expect(p.qualifiedItems?.map((i) => i.name)).toEqual(['Alice'])
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
