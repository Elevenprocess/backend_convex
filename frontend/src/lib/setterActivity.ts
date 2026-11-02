// Activité d'appels du tableau de bord setter : appels RÉELS uniquement, sur le
// jour local du navigateur. Les bornes et le décompte « joint » sont ceux de la
// vue admin (buildSetterRows), pour que les deux écrans affichent le même chiffre.
type ActivityCall = { calledAt: string; result: string }
export type ActivityPoint = { label: string; value: number }

const NO_ANSWER_RESULTS = new Set(['non_joint', 'injoignable', 'messagerie'])
const WORKDAY_FIRST_HOUR = 8
const WORKDAY_LAST_HOUR = 19

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function localDayBounds(now: Date): { fromMs: number; toMs: number } {
  return {
    fromMs: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    toMs: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime(),
  }
}

function callsOfDay<T extends ActivityCall>(calls: T[], day: Date): T[] {
  const key = dayKey(day)
  return calls.filter((c) => dayKey(new Date(c.calledAt)) === key)
}

export function todayCallStats(calls: ActivityCall[], now: Date): { calls: number; connected: number } {
  const today = callsOfDay(calls, now)
  return {
    calls: today.length,
    connected: today.filter((c) => !NO_ANSWER_RESULTS.has(c.result)).length,
  }
}

export function todayHourlySeries(calls: ActivityCall[], now: Date): ActivityPoint[] {
  const hours = callsOfDay(calls, now).map((c) => new Date(c.calledAt).getHours())
  const first = Math.min(WORKDAY_FIRST_HOUR, ...hours)
  const last = Math.max(WORKDAY_LAST_HOUR, ...hours)
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const hour = first + i
    return { label: `${hour}h`, value: hours.filter((h) => h === hour).length }
  })
}

export function weekDailySeries(calls: ActivityCall[], now: Date): ActivityPoint[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i), 12)
    return {
      label: day.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      value: callsOfDay(calls, day).length,
    }
  })
}
