// Période réutilisable entre Analytics, Overview et tout autre dashboard.
// Mêmes presets que l'UI Analytics ("Aujourd'hui", "Hier", "Cette semaine",
// "Semaine dernière", "Ce mois-ci", "Mois dernier", "Cette année", "L'année
// dernière", "Plage de dates"), un seul code à maintenir.

export type PeriodMode =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'last_n_days'
  | 'custom'

export type PeriodState = {
  mode: PeriodMode
  customFrom: string
  customTo: string
  /** Utilisé par le mode 'last_n_days' (défaut 30). */
  lastN?: number
  /** Utilisé par le mode 'last_n_days' (défaut true). */
  includeToday?: boolean
}
export type PeriodRange = { from: string; to: string; label: string; days: number }

export const PERIOD_OPTIONS: { id: PeriodMode; label: string }[] = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'yesterday', label: 'Hier' },
  { id: 'this_week', label: 'Cette semaine' },
  { id: 'last_week', label: 'Semaine dernière' },
  { id: 'this_month', label: 'Ce mois-ci' },
  { id: 'last_month', label: 'Mois dernier' },
  { id: 'this_year', label: 'Cette année' },
  { id: 'last_year', label: "L'année dernière" },
  { id: 'last_n_days', label: 'Période personnalisée' },
  { id: 'custom', label: 'Plage de dates' },
]

const todayInputValue = toDateInputValue(new Date())

export const DEFAULT_PERIOD: PeriodState = {
  mode: 'today',
  customFrom: todayInputValue,
  customTo: todayInputValue,
}

export function defaultPeriod(mode: PeriodMode = 'today'): PeriodState {
  return { mode, customFrom: todayInputValue, customTo: todayInputValue }
}

export function buildPeriodRange(period: PeriodState): PeriodRange {
  const now = new Date()
  const today = startOfDay(now)
  let from = today
  let to = endOfDay(today)
  let forcedDays: number | null = null

  if (period.mode === 'yesterday') {
    from = addDays(today, -1)
    to = endOfDay(from)
  } else if (period.mode === 'this_week') {
    from = startOfWeek(today)
    to = endOfDay(today)
  } else if (period.mode === 'last_week') {
    const thisWeek = startOfWeek(today)
    from = addDays(thisWeek, -7)
    to = endOfDay(addDays(thisWeek, -1))
  } else if (period.mode === 'this_month') {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
    to = endOfDay(today)
  } else if (period.mode === 'last_month') {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    to = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0))
  } else if (period.mode === 'this_year') {
    from = new Date(today.getFullYear(), 0, 1)
    to = endOfDay(today)
  } else if (period.mode === 'last_year') {
    from = new Date(today.getFullYear() - 1, 0, 1)
    to = endOfDay(new Date(today.getFullYear() - 1, 11, 31))
  } else if (period.mode === 'last_n_days') {
    const n = Math.max(1, period.lastN ?? 30)
    const includeToday = period.includeToday ?? true
    to = includeToday ? endOfDay(today) : endOfDay(addDays(today, -1))
    from = startOfDay(addDays(startOfDay(to), -(n - 1)))
    forcedDays = n
  } else if (period.mode === 'custom') {
    from = parseDateInput(period.customFrom)
    to = endOfDay(parseDateInput(period.customTo))
    if (from > to) [from, to] = [startOfDay(to), endOfDay(from)]
  }

  const days = forcedDays ?? Math.max(
    1,
    Math.round((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000) + 1,
  )
  const option = PERIOD_OPTIONS.find((p) => p.id === period.mode)?.label ?? 'Période'
  return {
    from: startOfDay(from).toISOString(),
    to: endOfDay(to).toISOString(),
    label: `${option} · ${formatShortDate(from)} → ${formatShortDate(to)}`,
    days,
  }
}

export function toDateInputValue(date: Date): string {
  // Date locale (PAS toISOString, qui convertit en UTC et recule d'un jour
  // pour les fuseaux à l'est de Greenwich → la case cliquée sélectionnait la veille).
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateInput(value: string): Date {
  const today = startOfDay(new Date())
  if (!value) return today
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, (month || 1) - 1, day || 1)
  return parsed > today ? today : startOfDay(parsed)
}

export function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function endOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  const day = d.getDay() || 7
  return addDays(d, 1 - day)
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function lastNDaysPeriod(n: number, includeToday = true): PeriodState {
  return { mode: 'last_n_days', customFrom: todayInputValue, customTo: todayInputValue, lastN: n, includeToday }
}

/** Plage précédente : même nombre de jours, se terminant la veille du `from`. */
export function previousRange(range: PeriodRange): PeriodRange {
  const from = startOfDay(new Date(range.from))
  const prevTo = endOfDay(addDays(from, -1))
  const prevFrom = startOfDay(addDays(from, -range.days))
  return {
    from: prevFrom.toISOString(),
    to: prevTo.toISOString(),
    label: `${formatShortDate(prevFrom)} → ${formatShortDate(prevTo)}`,
    days: range.days,
  }
}

export function PeriodSelector({
  value,
  onChange,
  className = '',
}: {
  value: PeriodState
  onChange: (v: PeriodState) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`}>
      <select
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as PeriodMode })}
        className="px-3 py-2 rounded-xl bg-white border border-line-soft text-xs font-bold text-text shadow-sm"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      {value.mode === 'custom' && (
        <>
          <input
            type="date"
            max={todayInputValue}
            value={value.customFrom}
            onChange={(e) =>
              onChange({
                ...value,
                customFrom: e.target.value > todayInputValue ? todayInputValue : e.target.value,
              })
            }
            className="px-3 py-2 rounded-xl bg-white border border-line-soft text-xs font-semibold"
          />
          <span className="text-xs text-faint font-bold">à</span>
          <input
            type="date"
            max={todayInputValue}
            value={value.customTo}
            onChange={(e) =>
              onChange({
                ...value,
                customTo: e.target.value > todayInputValue ? todayInputValue : e.target.value,
              })
            }
            className="px-3 py-2 rounded-xl bg-white border border-line-soft text-xs font-semibold"
          />
        </>
      )}
    </div>
  )
}
