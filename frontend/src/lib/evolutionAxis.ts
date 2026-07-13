import { addDays, endOfDay, startOfDay, startOfWeek } from './period'

export type EvolutionGranularity = 'hour' | 'day' | 'week' | 'month'

export type EvolutionDomain = { start: number; end: number }
export type EvolutionTick = { t: number; label: string }

// Fenêtre horaire : journée pleine 00h → minuit (24h). En mode live (aujourd'hui)
// l'axe est tronqué à « maintenant » par computeEvolutionDomain.
const HOUR_WINDOW_START = 0
const HOUR_WINDOW_END = 24
const HOUR_TICKS = [0, 4, 8, 12, 16, 20] as const // graduations toutes les 4h

function dayLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
}

function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

// Empan minimal de l'axe quand la période vient juste de commencer (évite un graphe dégénéré tôt le matin / début de semaine).
const MIN_LIVE_SPAN: Record<EvolutionGranularity, number> = {
  hour: 60 * 60 * 1000, // 1 h
  day: 24 * 60 * 60 * 1000, // 1 j
  week: 7 * 24 * 60 * 60 * 1000, // 1 sem
  month: 28 * 24 * 60 * 60 * 1000, // ~1 mois
}

/** Bornes temporelles (ms) de l'axe X, selon la granularité et la plage.
 *  Mode live : si l'instant présent tombe dans la période, l'axe s'arrête à « maintenant »
 *  (le point live est collé au bord droit, pas d'espace vide pour les heures à venir). */
export function computeEvolutionDomain(range: { from: string; to: string }, granularity: EvolutionGranularity, now: number = Date.now()): EvolutionDomain {
  const natural = naturalEvolutionDomain(range, granularity)
  if (!(natural.end > natural.start)) return natural
  if (now > natural.start && now < natural.end) {
    const end = Math.min(natural.end, Math.max(natural.start + MIN_LIVE_SPAN[granularity], now))
    return { start: natural.start, end }
  }
  return natural
}

/** Domaine « plein » de la période, sans troncature live (utilisé en interne + par les ticks). */
function naturalEvolutionDomain(range: { from: string; to: string }, granularity: EvolutionGranularity): EvolutionDomain {
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
    const ticks = HOUR_TICKS.map((hour) => {
      const d = new Date(start)
      d.setHours(hour, 0, 0, 0)
      return { t: d.getTime(), label: `${hour}h` }
    }).filter((tick) => tick.t >= start && tick.t <= end)
    // Étiquette du bord droit : « maintenant » en mode live (axe tronqué avant minuit),
    // sinon « 24h » (minuit, fin de la journée). Évite un trou entre 20h et le bord.
    const last = ticks[ticks.length - 1]
    if (!last || end - last.t > 45 * 60 * 1000) {
      const h = new Date(end).getHours()
      ticks.push({ t: end, label: h === 0 ? '24h' : `${h}h` })
    }
    return ticks
  }

  // Position centrale de la graduation bornée au domaine : en mode live, la fin est tronquée à
  // « maintenant », donc le centre d'une période en cours (mercredi, 15 du mois, midi) peut tomber
  // au-delà du bord droit. On le clampe pour qu'aucune graduation ne dépasse l'axe.
  const within = (t: number) => Math.min(t, end)

  if (granularity === 'week') {
    const weeks: EvolutionTick[] = []
    let cursor = startOfWeek(new Date(start))
    while (cursor.getTime() <= end) {
      weeks.push({ t: within(addDays(cursor, 3).getTime()), label: `sem. ${formatDayMonth(cursor)}` })
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
      months.push({ t: within(new Date(year, month, 15).getTime()), label: formatMonthLabel(new Date(year, month, 1)) })
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
    days.push({ t: within(mid.getTime()), label: dayLabel(cursor) })
    cursor = addDays(cursor, 1)
  }
  return sampleTicks(days)
}
