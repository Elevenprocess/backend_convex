import { describe, expect, it } from 'vitest'
import { buildEvolutionTicks, computeEvolutionDomain } from './evolutionAxis'

// `now` est injecté pour rendre les tests déterministes (sinon le mode "live" dépend de la date du jour).
const NOW_AFTER = Date.parse('2026-07-01T00:00:00.000Z') // bien après toutes les plages testées → pas de troncature live

describe('computeEvolutionDomain', () => {
  it('hour granularity : journée pleine 00h→minuit du jour de début (hors live)', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour', NOW_AFTER)
    const start = new Date(domain.start)
    expect(start.getHours()).toBe(0)
    expect(start.getFullYear()).toBe(2026)
    // 00h → minuit = 24 h pleines
    expect(domain.end - domain.start).toBe(24 * 60 * 60 * 1000)
  })

  it('day granularity spans from start-of-from to end-of-to', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-01T10:00:00.000Z', to: '2026-06-07T18:00:00.000Z' }, 'day', NOW_AFTER)
    expect(domain.end).toBeGreaterThan(domain.start)
    expect(new Date(domain.start).getHours()).toBe(0)
  })

  it('tronque la fin à "maintenant" quand la période est en cours (mode live)', () => {
    const now = Date.parse('2026-06-04T12:00:00.000Z')
    const domain = computeEvolutionDomain({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-07T23:59:59.999Z' }, 'day', now)
    expect(domain.end).toBe(now)
  })
})

describe('buildEvolutionTicks', () => {
  it('hour (hors live) : graduations toutes les 4h de 0h à 20h + bord droit 24h', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour', NOW_AFTER)
    const ticks = buildEvolutionTicks(domain, 'hour')
    expect(ticks.map((t) => t.label)).toEqual(['0h', '4h', '8h', '12h', '16h', '20h', '24h'])
    ticks.forEach((tick) => {
      expect(tick.t).toBeGreaterThanOrEqual(domain.start)
      expect(tick.t).toBeLessThanOrEqual(domain.end)
    })
  })

  it('hour (live) : la dernière graduation = "maintenant", dans le domaine', () => {
    const now = Date.parse('2026-06-08T15:30:00.000Z')
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour', now)
    const ticks = buildEvolutionTicks(domain, 'hour')
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    ticks.forEach((tick) => {
      expect(tick.t).toBeGreaterThanOrEqual(domain.start)
      expect(tick.t).toBeLessThanOrEqual(domain.end)
    })
    expect(ticks[ticks.length - 1].t).toBe(domain.end)
  })

  it('day granularity yields at most ~6 ticks spanning the range', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-14T23:59:59.999Z' }, 'day', NOW_AFTER)
    const ticks = buildEvolutionTicks(domain, 'day')
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.length).toBeLessThanOrEqual(7)
  })

  it('week granularity : aucune graduation ne dépasse le domaine, même en live', () => {
    const now = Date.parse('2026-06-09T12:00:00.000Z') // mardi de la 2e semaine → fin tronquée en milieu de semaine
    const domain = computeEvolutionDomain({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-21T23:59:59.999Z' }, 'week', now)
    const ticks = buildEvolutionTicks(domain, 'week')
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    expect(ticks.length).toBeLessThanOrEqual(6)
    ticks.forEach((tick) => {
      expect(tick.label.startsWith('sem. ')).toBe(true)
      expect(Number.isFinite(tick.t)).toBe(true)
      expect(tick.t).toBeGreaterThanOrEqual(domain.start)
      expect(tick.t).toBeLessThanOrEqual(domain.end)
    })
  })

  it('month granularity spanning year rollover yields valid ticks within the domain', () => {
    const domain = computeEvolutionDomain({ from: '2025-11-01T00:00:00.000Z', to: '2026-02-28T23:59:59.999Z' }, 'month', NOW_AFTER)
    const ticks = buildEvolutionTicks(domain, 'month')
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    expect(ticks.length).toBeLessThanOrEqual(6)
    ticks.forEach((tick) => {
      expect(tick.label.length).toBeGreaterThan(0)
      expect(Number.isFinite(tick.t)).toBe(true)
      expect(tick.t).toBeGreaterThanOrEqual(domain.start)
      expect(tick.t).toBeLessThanOrEqual(domain.end)
    })
  })
})
