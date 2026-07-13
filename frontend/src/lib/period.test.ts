import { describe, it, expect } from 'vitest'
import { buildPeriodRange, lastNDaysPeriod, previousRange } from './period'

describe('lastNDaysPeriod', () => {
  it('génère un mode last_n_days avec includeToday par défaut', () => {
    const p = lastNDaysPeriod(30)
    expect(p.mode).toBe('last_n_days')
    expect(p.lastN).toBe(30)
    expect(p.includeToday).toBe(true)
  })
})

describe('buildPeriodRange (last_n_days)', () => {
  it('couvre N jours en incluant aujourd\'hui', () => {
    const r = buildPeriodRange({ mode: 'last_n_days', customFrom: '', customTo: '', lastN: 30, includeToday: true })
    expect(r.days).toBe(30)
    expect(new Date(r.to).toDateString()).toBe(new Date().toDateString())
  })

  it('exclut aujourd\'hui quand includeToday=false', () => {
    const r = buildPeriodRange({ mode: 'last_n_days', customFrom: '', customTo: '', lastN: 7, includeToday: false })
    expect(r.days).toBe(7)
    const expectedEnd = new Date()
    expectedEnd.setDate(expectedEnd.getDate() - 1)
    expect(new Date(r.to).toDateString()).toBe(expectedEnd.toDateString())
  })
})

describe('previousRange', () => {
  it('renvoie la même durée se terminant la veille du from', () => {
    const current = buildPeriodRange({ mode: 'last_n_days', customFrom: '', customTo: '', lastN: 7, includeToday: true })
    const prev = previousRange(current)
    expect(prev.days).toBe(7)
    const currentFrom = new Date(current.from)
    const expectedPrevTo = new Date(currentFrom)
    expectedPrevTo.setDate(expectedPrevTo.getDate() - 1)
    expect(new Date(prev.to).toDateString()).toBe(expectedPrevTo.toDateString())
  })
})
