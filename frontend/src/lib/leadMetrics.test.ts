import { describe, it, expect } from 'vitest'
import { niceMax, closingRate, formatMetricValue, LEAD_METRICS } from './leadMetrics'

describe('niceMax', () => {
  it('arrondit à une échelle ronde 1/2/5×10ⁿ', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(1)).toBe(1)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(23)).toBe(50)
    expect(niceMax(230)).toBe(500)
    expect(niceMax(400)).toBe(500)
    expect(niceMax(3)).toBe(5)
    expect(niceMax(200)).toBe(200)
  })
})

describe('closingRate', () => {
  it('vaut 0 quand rdv = 0 (pas de division par 0)', () => {
    expect(closingRate(2, 0)).toBe(0)
  })
  it('signed/rdv en pourcentage', () => {
    expect(closingRate(2, 4)).toBe(50)
  })
})

describe('formatMetricValue', () => {
  it('format percent ajoute %', () => {
    expect(formatMetricValue(3.2, 'percent')).toBe('3,2 %')
  })
  it('format count compacte', () => {
    expect(formatMetricValue(119, 'count')).toBe('119')
  })
})

describe('LEAD_METRICS', () => {
  it('closing.valueOf dérive signed/rdv', () => {
    expect(LEAD_METRICS.closing.valueOf({ key: 'x', t: 0, date: '', label: '', leads: 0, calls: 0, rdv: 4, signed: 2 })).toBe(50)
  })
  it('leads.valueOf lit le champ leads', () => {
    expect(LEAD_METRICS.leads.valueOf({ key: 'x', t: 0, date: '', label: '', leads: 9, calls: 0, rdv: 0, signed: 0 })).toBe(9)
  })
})
