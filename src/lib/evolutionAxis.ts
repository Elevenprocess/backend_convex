import { addDays, endOfDay, startOfDay, startOfWeek } from './period'

export type EvolutionGranularity = 'hour' | 'day' | 'week' | 'month'

export type EvolutionDomain = { start: number; end: number }
export type EvolutionTick = { t: number; label: string }

// Fenêtre horaire active du dashboard (cohérent avec le filtre hour 8h–21h côté data).
const HOUR_WINDOW_START = 8
const HOUR_WINDOW_END = 21
const HOUR_TICKS = [8, 11, 14, 17, 20] as const // graduations toutes les 3h ; dernier label avant la fermeture 21h

function dayLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
}

function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

/** Bornes temporelles (ms) de l'axe X, selon la granularité et la plage. */
export function computeEvolutionDomain(range: { from: string; to: string }, granularity: EvolutionGranularity): EvolutionDomain {
  if (granularity === 'hour') {
    const start = startOfDay(new Date(range.from))
    start.setHours(HOUR_WINDOW_START, 0, 0, 0)
    const end = startOfDay(new Date(range.from))
    end.setHours(HOUR_WINDOW_END, 0, 0, 0)
    return { start: start.getTime(), end: end.getTime() }
  }
  if (granularity === 'week') {
    const start = startOfWeek(new Date(range.from))
    const end = endOfDay(addDays(startOfWeek(new Date(range.to)), 6))
    return { start: start.getTime(), end: end.getTime() }
  }
  if (granularity === 'month') {
    const from = new Date(range.from)
    const to = new Date(range.to)
    const start = startOfDay(new Date(from.getFullYear(), from.getMonth(), 1))
    const end = endOfDay(new Date(to.getFullYear(), to.getMonth() + 1, 0))
    return { start: start.getTime(), end: end.getTime() }
  }
  // day
  return { start: startOfDay(new Date(range.from)).getTime(), end: endOfDay(new Date(range.to)).getTime() }
}

function sampleTicks(ticks: EvolutionTick[], maxCount = 6): EvolutionTick[] {
  if (ticks.length <= maxCount) return ticks
  const step = Math.max(1, Math.ceil(ticks.length / maxCount))
  return ticks.filter((_, index) => index % step === 0 || index === ticks.length - 1)
}

/** Graduations de l'axe X générées depuis le domaine (≈ 5–6 max), labels selon la granularité. */
export function buildEvolutionTicks(domain: EvolutionDomain, granularity: EvolutionGranularity): EvolutionTick[] {
  const { start, end } = domain
  if (!(end > start)) return [{ t: start, label: '' }]

  if (granularity === 'hour') {
    return HOUR_TICKS.map((hour) => {
      const d = new Date(start)
      d.setHours(hour, 0, 0, 0)
      return { t: d.getTime(), label: `${hour}h` }
    })
  }

  if (granularity === 'week') {
    const weeks: EvolutionTick[] = []
    let cursor = startOfWeek(new Date(start))
    while (cursor.getTime() <= end) {
      weeks.push({ t: addDays(cursor, 3).getTime(), label: `sem. ${formatDayMonth(cursor)}` })
      cursor = addDays(cursor, 7)
    }
    return sampleTicks(weeks)
  }

  if (granularity === 'month') {
    const months: EvolutionTick[] = []
    const startDate = new Date(start)
    let year = startDate.getFullYear()
    let month = startDate.getMonth()
    while (new Date(year, month, 1).getTime() <= end) {
      months.push({ t: new Date(year, month, 15).getTime(), label: formatMonthLabel(new Date(year, month, 1)) })
      month += 1
      if (month > 11) { month = 0; year += 1 }
    }
    return sampleTicks(months)
  }

  // day
  const days: EvolutionTick[] = []
  let cursor = startOfDay(new Date(start))
  const endDay = startOfDay(new Date(end))
  while (cursor.getTime() <= endDay.getTime()) {
    const mid = new Date(cursor)
    mid.setHours(12, 0, 0, 0)
    days.push({ t: mid.getTime(), label: dayLabel(cursor) })
    cursor = addDays(cursor, 1)
  }
  return sampleTicks(days)
}
