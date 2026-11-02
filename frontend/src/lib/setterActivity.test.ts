import { describe, expect, it } from 'vitest'
import { localDayBounds, todayCallStats, todayHourlySeries, weekDailySeries } from './setterActivity'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString()
const NOW = new Date(2026, 10, 2, 15, 30)
const call = (calledAt: string, result = 'joint') => ({ calledAt, result })

describe('setterActivity', () => {
  it('compte les appels du jour et les personnes jointes, comme la vue admin', () => {
    const stats = todayCallStats([
      call(at(2, 9)),
      call(at(2, 10), 'non_joint'),
      call(at(2, 11), 'messagerie'),
      call(at(2, 12), 'injoignable'),
      call(at(2, 13), 'refus'),
      call(at(1, 13)), // hier
    ], NOW)
    expect(stats).toEqual({ calls: 5, connected: 2 })
  })

  it('les barres du jour totalisent exactement les appels, même hors horaires', () => {
    const calls = [call(at(2, 7, 50)), call(at(2, 9)), call(at(2, 9, 30)), call(at(2, 21)), call(at(1, 9))]
    const points = todayHourlySeries(calls, NOW)
    expect(points.reduce((sum, p) => sum + p.value, 0)).toBe(4)
    expect(points[0]).toEqual({ label: '7h', value: 1 })
    expect(points.find((p) => p.label === '9h')?.value).toBe(2)
    expect(points[points.length - 1]).toEqual({ label: '21h', value: 1 })
  })

  it('sans appel, les barres couvrent la journée de travail', () => {
    const points = todayHourlySeries([], NOW)
    expect(points[0].label).toBe('8h')
    expect(points[points.length - 1].label).toBe('19h')
  })

  it('la semaine couvre 7 jours locaux, aujourd’hui en dernier', () => {
    const points = weekDailySeries([call(at(2, 1)), call(at(2, 23)), call(new Date(2026, 9, 27, 12).toISOString())], NOW)
    expect(points).toHaveLength(7)
    expect(points[6].value).toBe(2)
    expect(points[0].value).toBe(1)
  })

  it('bornes du jour local', () => {
    const { fromMs, toMs } = localDayBounds(NOW)
    expect(new Date(fromMs).getHours()).toBe(0)
    expect(new Date(toMs).getHours()).toBe(23)
    expect(new Date(toMs).getDate()).toBe(2)
  })
})
