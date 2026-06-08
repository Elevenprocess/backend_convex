import { describe, expect, it } from 'vitest'
import { buildEvolutionTicks, computeEvolutionDomain } from './evolutionAxis'

describe('computeEvolutionDomain', () => {
  it('hour granularity spans 8h→21h of the range start day', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour')
    const start = new Date(domain.start)
    const end = new Date(domain.end)
    expect(start.getHours()).toBe(8)
    expect(end.getHours()).toBe(21)
    expect(start.getFullYear()).toBe(2026)
    expect(end.getTime()).toBeGreaterThan(start.getTime())
  })

  it('day granularity spans from start-of-from to end-of-to', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-01T10:00:00.000Z', to: '2026-06-07T18:00:00.000Z' }, 'day')
    expect(domain.end).toBeGreaterThan(domain.start)
    expect(new Date(domain.start).getHours()).toBe(0)
  })
})

describe('buildEvolutionTicks', () => {
  it('hour granularity yields fixed 8/11/14/17/20h labels', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour')
    const ticks = buildEvolutionTicks(domain, 'hour')
    expect(ticks.map((t) => t.label)).toEqual(['8h', '11h', '14h', '17h', '20h'])
    ticks.forEach((tick) => {
      expect(tick.t).toBeGreaterThanOrEqual(domain.start)
      expect(tick.t).toBeLessThanOrEqual(domain.end)
    })
  })

  it('day granularity yields at most ~6 ticks spanning the range', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-07T23:59:59.999Z' }, 'day')
    const ticks = buildEvolutionTicks(domain, 'day')
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.length).toBeLessThanOrEqual(7)
  })
})
