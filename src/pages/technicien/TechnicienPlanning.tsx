import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingBlock } from '../../components/Spinner'
import { useUsers, useVtCalendar } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import type { VtCalendarEntry } from '../../lib/types'

// ─── Constants ──────────────────────────────────────────────────────────────
/** First hour displayed in the hourly grid (inclusive). */
const GRID_START_HOUR = 7
/** Last hour displayed in the hourly grid (inclusive). */
const GRID_END_HOUR = 20
/** Height in pixels for one hour row. */
const HOUR_ROW_PX = 64
/** Default event duration in minutes when no end time is known. */
const DEFAULT_DURATION_MIN = 60

// ─── Types ───────────────────────────────────────────────────────────────────
type PlanningView = 'day' | 'week' | 'month'

// ─── Date utilities (wall-clock, no UTC shift) ───────────────────────────────
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7 // lundi = 0
  return addDays(d, -dow)
}
function monthGrid(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}
function frDay(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString('fr-FR', opts)
}

/** Parse 'HH:MM' → fractional hours from midnight. Returns null on bad input. */
function parseHeure(heure: string | null): number | null {
  if (!heure) return null
  const parts = heure.split(':')
  if (parts.length < 2) return null
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return null
  return h + m / 60
}

/** Get technician initials from full name. */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')
}

/** Resolve technicians array from an entry (multi-assign takes priority). */
function resolveTechs(e: VtCalendarEntry, techNameById: Map<string, string>): { id: string; name: string }[] {
  if (e.techniciens && e.techniciens.length > 0) return e.techniciens
  const fallbackId = e.technicienId ?? e.technicienVtId
  if (!fallbackId) return []
  const name = techNameById.get(fallbackId) ?? 'Technicien'
  return [{ id: fallbackId, name }]
}

// ─── Main component ───────────────────────────────────────────────────────────
export function TechnicienPlanning() {
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  const isTech = role === 'technicien'

  const [view, setView] = useState<PlanningView>(
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week'),
  )
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedTechId, setSelectedTechId] = useState('')

  // Jours affichés selon la vue + bornes pour le fetch.
  const days = useMemo<Date[]>(() => {
    if (view === 'day') return [cursor]
    if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))
    return monthGrid(cursor)
  }, [view, cursor])
  const from = ymd(days[0])
  const to = ymd(days[days.length - 1])

  const { data: entries, loading } = useVtCalendar({ from, to })

  const { data: users } = useUsers()
  const technicians = useMemo(
    () => (users ?? []).filter((u) => u.role === 'technicien').sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [users],
  )
  const techNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users ?? []) m.set(u.id, u.name ?? u.email)
    return m
  }, [users])

  const filtered = useMemo(
    () =>
      selectedTechId
        ? (entries ?? []).filter(
            (e) =>
              e.technicienId === selectedTechId ||
              e.technicienVtId === selectedTechId ||
              e.techniciens.some((t) => t.id === selectedTechId),
          )
        : (entries ?? []),
    [entries, selectedTechId],
  )

  // Les interventions sont datées au jour (pas d'heure) → tout est indexé par
  // la clé 'YYYY-MM-DD', ce qui évite tout décalage de fuseau.
  const eventsByDay = useMemo(() => {
    const m = new Map<string, VtCalendarEntry[]>()
    for (const e of filtered) {
      const list = m.get(e.date) ?? []
      list.push(e)
      m.set(e.date, list)
    }
    for (const list of m.values())
      list.sort((a, b) => {
        const ha = parseHeure(a.heure) ?? -1
        const hb = parseHeure(b.heure) ?? -1
        return ha - hb || a.kind.localeCompare(b.kind) || a.leadName.localeCompare(b.leadName)
      })
    return m
  }, [filtered])

  const todayKey = ymd(new Date())

  const title =
    view === 'day'
      ? frDay(cursor, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${frDay(days[0], { day: '2-digit', month: 'short' })} → ${frDay(days[6], { day: '2-digit', month: 'short', year: 'numeric' })}`
        : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`

  function move(dir: -1 | 1) {
    if (view === 'day') setCursor((d) => addDays(d, dir))
    else if (view === 'week') setCursor((d) => addDays(d, dir * 7))
    else setCursor((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1))
  }

  function openEntry(e: VtCalendarEntry) {
    navigate(`/suivi/${e.leadId}/fiche`)
  }

  return (
    <AppShell>
      <Topbar eyebrow="PLANNING" title={isTech ? 'Mes interventions' : 'Planning techniciens'} />

      {/* ── Toolbar ── */}
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center gap-1.5 sm:gap-3 flex-wrap flex-shrink-0">
        <button
          onClick={() => move(-1)}
          className="btn-secondary p-2 rounded-xl text-muted shrink-0"
          aria-label="Période précédente"
        >
          <Icon name="chevron-down" size={14} className="rotate-90" />
        </button>
        <button onClick={() => setCursor(new Date())} className="btn-secondary px-3 sm:px-4 py-2 rounded-xl text-xs whitespace-nowrap">
          Aujourd'hui
        </button>
        <button
          onClick={() => move(1)}
          className="btn-secondary p-2 rounded-xl text-muted shrink-0"
          aria-label="Période suivante"
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <h2 className="font-black text-base sm:text-lg ml-1 truncate">{title}</h2>
        <div className="flex bg-or-tint p-1 rounded-xl shrink-0">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 sm:px-3 py-1 text-[11px] sm:text-xs font-semibold rounded-lg ${view === v ? 'bg-white shadow-sm text-text' : 'text-muted'}`}
            >
              {v === 'day' ? 'Jour' : v === 'week' ? 'Sem.' : 'Mois'}
            </button>
          ))}
        </div>
        {!isTech && (
          <select
            value={selectedTechId}
            onChange={(e) => setSelectedTechId(e.target.value)}
            aria-label="Filtrer par technicien"
            className="ml-auto px-3 py-2 rounded-xl text-xs font-semibold border border-line bg-white max-w-[220px]"
          >
            <option value="">Tous les techniciens</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ?? t.email}
              </option>
            ))}
          </select>
        )}
        <div className={`${isTech ? 'ml-auto' : ''} flex items-center gap-3 text-[11px] font-bold text-muted`}>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> VT
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Installation
          </span>
        </div>
      </div>

      <main className="p-3 sm:p-6 md:p-8 pt-3 overflow-hidden flex-grow">
        <div className="glass-card !p-0 overflow-hidden h-full flex flex-col">
          {loading && !entries ? (
            <LoadingBlock label="Chargement du planning…" />
          ) : view === 'month' ? (
            <MonthView
              days={days}
              cursor={cursor}
              todayKey={todayKey}
              eventsByDay={eventsByDay}
              techNameById={techNameById}
              onOpen={openEntry}
              onOpenDay={(d) => { setCursor(d); setView('day') }}
            />
          ) : (
            <HourlyGridView
              days={days}
              todayKey={todayKey}
              eventsByDay={eventsByDay}
              techNameById={techNameById}
              onOpen={openEntry}
            />
          )}
        </div>
      </main>
    </AppShell>
  )
}

// ─── Hourly Grid View (Day + Week) ───────────────────────────────────────────
function HourlyGridView({
  days,
  todayKey,
  eventsByDay,
  techNameById,
  onOpen,
}: {
  days: Date[]
  todayKey: string
  eventsByDay: Map<string, VtCalendarEntry[]>
  techNameById: Map<string, string>
  onOpen: (e: VtCalendarEntry) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hours = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR + 1 }, (_, i) => GRID_START_HOUR + i)

  // Scroll to current time or 08:00 on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const now = new Date()
    const h = now.getHours()
    const m = now.getMinutes()
    const targetHour = h >= GRID_START_HOUR && h <= GRID_END_HOUR ? h : 8
    const targetMin = h >= GRID_START_HOUR && h <= GRID_END_HOUR ? m : 0
    const offset = ((targetHour - GRID_START_HOUR) * 60 + targetMin) / 60 * HOUR_ROW_PX
    scrollRef.current.scrollTop = Math.max(0, offset - HOUR_ROW_PX * 2)
  }, [days])

  // Split events by timed/untimed per day
  function splitEvents(key: string) {
    const all = eventsByDay.get(key) ?? []
    const timed = all.filter((e) => e.heure !== null)
    const untimed = all.filter((e) => e.heure === null)
    return { timed, untimed }
  }

  // Compute overlap columns for timed events
  function computeColumns(events: VtCalendarEntry[]): Map<string, { col: number; total: number }> {
    const result = new Map<string, { col: number; total: number }>()
    // Sort by start time
    const sorted = [...events].sort((a, b) => (parseHeure(a.heure) ?? 0) - (parseHeure(b.heure) ?? 0))
    // Group overlapping events
    const groups: VtCalendarEntry[][] = []
    for (const ev of sorted) {
      const start = (parseHeure(ev.heure) ?? 0) * 60
      let placed = false
      for (const group of groups) {
        const lastEnd = Math.max(...group.map((g) => {
          const gs = (parseHeure(g.heure) ?? 0) * 60
          return gs + DEFAULT_DURATION_MIN
        }))
        if (start < lastEnd) {
          group.push(ev)
          placed = true
          break
        }
      }
      if (!placed) groups.push([ev])
    }
    for (const group of groups) {
      group.forEach((ev, idx) => {
        result.set(`${ev.clientId}-${ev.kind}-${ev.heure}`, { col: idx, total: group.length })
      })
    }
    return result
  }

  const colCount = days.length
  const isWeek = colCount > 1

  // Has any untimed event across all days?
  const hasUntimed = days.some((d) => splitEvents(ymd(d)).untimed.length > 0)

  // Current time indicator position
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowOffset = (nowMinutes / 60 - GRID_START_HOUR) * HOUR_ROW_PX
  const showNeedle = nowMinutes >= GRID_START_HOUR * 60 && nowMinutes <= GRID_END_HOUR * 60

  const TIME_COL_W = 44 // px

  return (
    <div className="flex flex-col flex-grow overflow-hidden">
      {/* ── All-day row ── */}
      {hasUntimed && (
        <div className="flex flex-shrink-0 border-b border-line-soft bg-cream/40">
          {/* Time gutter */}
          <div
            className="flex-shrink-0 border-r border-line-soft bg-cream/60 flex items-center justify-center"
            style={{ width: TIME_COL_W }}
          >
            <span className="text-[9px] font-bold uppercase tracking-widest text-faint rotate-[-90deg] whitespace-nowrap leading-none">
              Journée
            </span>
          </div>
          {/* Day columns */}
          {days.map((d) => {
            const key = ymd(d)
            const { untimed } = splitEvents(key)
            const isToday = key === todayKey
            return (
              <div
                key={key}
                className={`flex-1 min-w-0 border-r border-line-soft last:border-r-0 px-1 py-1 flex flex-col gap-0.5 min-h-[32px] ${isToday ? 'bg-or/5' : ''}`}
              >
                {untimed.map((e) => (
                  <AllDayChip key={`${e.clientId}-${e.kind}`} e={e} onOpen={onOpen} />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Day header row (week view only) ── */}
      {isWeek && (
        <div className="flex flex-shrink-0 border-b border-line-soft bg-white/80 sticky top-0 z-20">
          <div className="flex-shrink-0 border-r border-line-soft" style={{ width: TIME_COL_W }} />
          {days.map((d) => {
            const key = ymd(d)
            const isToday = key === todayKey
            const weekday = frDay(d, { weekday: 'short' })
            return (
              <div
                key={key}
                className={`flex-1 min-w-0 border-r border-line-soft last:border-r-0 px-1 py-2 text-center`}
              >
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    isToday ? 'bg-or text-white' : 'text-muted'
                  }`}
                >
                  {d.getDate()}{' '}
                  <span className="opacity-70 font-medium">
                    {weekday.replace('.', '')}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Scrollable grid body ── */}
      <div ref={scrollRef} className="flex-grow overflow-auto relative">
        <div
          className="flex relative"
          style={{ minWidth: isWeek ? TIME_COL_W + colCount * 120 : undefined }}
        >
          {/* Time gutter */}
          <div className="flex-shrink-0 border-r border-line-soft bg-cream/60 relative z-10" style={{ width: TIME_COL_W }}>
            {hours.map((h) => (
              <div key={h} className="relative" style={{ height: HOUR_ROW_PX }}>
                <span className="absolute -top-[9px] right-2 text-[10px] font-mono font-semibold text-faint select-none tabular-nums">
                  {String(h).padStart(2, '0')}h
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const key = ymd(d)
            const isToday = key === todayKey
            const { timed } = splitEvents(key)
            const layout = computeColumns(timed)

            return (
              <div
                key={key}
                className={`flex-1 min-w-0 relative border-r border-line-soft last:border-r-0 ${isToday ? 'bg-or/[0.025]' : ''}`}
                style={{ minWidth: isWeek ? 120 : undefined }}
              >
                {/* Hour grid lines */}
                {hours.map((h, hi) => (
                  <div
                    key={h}
                    className={`absolute left-0 right-0 border-t ${
                      hi === 0 ? 'border-line' : 'border-line-soft'
                    }`}
                    style={{ top: hi * HOUR_ROW_PX }}
                  />
                ))}
                {/* Half-hour tick lines */}
                {hours.map((h, hi) => (
                  <div
                    key={`h${h}`}
                    className="absolute left-0 right-0 border-t border-line-soft/60"
                    style={{ top: hi * HOUR_ROW_PX + HOUR_ROW_PX / 2, borderStyle: 'dashed' }}
                  />
                ))}

                {/* Bottom border of last hour */}
                <div
                  className="absolute left-0 right-0 border-t border-line"
                  style={{ top: hours.length * HOUR_ROW_PX }}
                />

                {/* Height spacer */}
                <div style={{ height: hours.length * HOUR_ROW_PX }} />

                {/* Current-time needle (only on today's column) */}
                {isToday && showNeedle && (
                  <div
                    className="absolute left-0 right-0 z-30 pointer-events-none"
                    style={{ top: nowOffset }}
                  >
                    <div className="relative flex items-center">
                      <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1 shadow-sm" />
                      <div className="flex-grow h-[1.5px] bg-red-500 opacity-80" />
                    </div>
                  </div>
                )}

                {/* Timed events */}
                {timed.map((e) => {
                  const h = parseHeure(e.heure)!
                  const topPx = (h - GRID_START_HOUR) * HOUR_ROW_PX
                  const heightPx = (DEFAULT_DURATION_MIN / 60) * HOUR_ROW_PX - 2
                  const layoutKey = `${e.clientId}-${e.kind}-${e.heure}`
                  const lay = layout.get(layoutKey) ?? { col: 0, total: 1 }
                  const colW = 100 / lay.total
                  const techs = resolveTechs(e, techNameById)
                  const isVt = e.kind === 'vt'

                  return (
                    <div
                      key={layoutKey}
                      className="absolute group"
                      style={{
                        top: topPx + 1,
                        height: heightPx,
                        left: `${lay.col * colW}%`,
                        width: `${colW}%`,
                      }}
                    >
                      {isVt && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            window.open(`#/fiche-vt/${e.clientId}`, '_blank')
                          }}
                          title="Imprimer la fiche VT"
                          className="absolute top-0.5 right-1 z-10 text-[9px] text-sky-500 hover:text-sky-700 leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Imprimer la fiche VT"
                        >
                          🖨
                        </button>
                      )}
                    <button
                      onClick={() => onOpen(e)}
                      title={`${isVt ? 'VT' : 'Installation'} — ${e.projectName ?? e.leadName}${e.heure ? ` à ${e.heure}` : ''}`}
                      className="absolute inset-0 focus:outline-none"
                      style={{ paddingLeft: 2, paddingRight: 2 }}
                    >
                      <div
                        className={`h-full w-full rounded-md overflow-hidden text-left flex flex-col shadow-sm border group-hover:shadow-md transition-shadow ${
                          isVt
                            ? 'bg-sky-50 border-sky-200 hover:bg-sky-100'
                            : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                        }`}
                      >
                        {/* Left-side color bar */}
                        <div
                          className={`absolute left-[2px] top-[2px] bottom-[2px] w-[3px] rounded-full ${
                            isVt ? 'bg-sky-500' : 'bg-amber-500'
                          }`}
                        />
                        <div className="flex flex-col min-h-0 pl-[8px] pr-1 py-1 flex-grow">
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded-sm shrink-0 ${
                                isVt ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {isVt ? 'VT' : 'POSE'}
                            </span>
                            {e.heure && (
                              <span className="text-[9px] font-mono font-semibold text-faint shrink-0">
                                {e.heure}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-bold leading-tight truncate mt-0.5 text-text">
                            {e.projectName?.trim() || e.leadName}
                          </span>
                          {e.city && (
                            <span className="text-[9px] text-muted truncate leading-tight">{e.city}</span>
                          )}
                          {/* Technician chips */}
                          {techs.length > 0 && heightPx > 40 && (
                            <div className="flex flex-wrap gap-0.5 mt-auto pt-0.5">
                              {techs.slice(0, 3).map((t) => (
                                <TechChip key={t.id} name={t.name} isVt={isVt} />
                              ))}
                              {techs.length > 3 && (
                                <span className="text-[9px] text-faint font-semibold">+{techs.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                    </div>
                  )
                })}

                {/* Day header for single-day view */}
                {!isWeek && (
                  <div className="sticky top-0 z-10 flex justify-center py-1 pointer-events-none">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                        isToday ? 'bg-or text-white' : 'bg-white/80 text-muted border border-line-soft'
                      }`}
                    >
                      {frDay(d, { weekday: 'long', day: '2-digit', month: 'long' })}
                    </span>
                  </div>
                )}

                {/* Empty state */}
                {timed.length === 0 && !isWeek && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    style={{ top: HOUR_ROW_PX * 2 }}
                  >
                    <span className="text-[11px] text-faint">Aucune intervention</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── All-day chip ─────────────────────────────────────────────────────────────
function AllDayChip({ e, onOpen }: { e: VtCalendarEntry; onOpen: (e: VtCalendarEntry) => void }) {
  const isVt = e.kind === 'vt'
  return (
    <div className="flex items-center gap-0.5 w-full">
      <button
        onClick={() => onOpen(e)}
        className={`flex-1 text-left rounded px-1.5 py-0.5 text-[10px] font-semibold truncate leading-tight ${
          isVt
            ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
        }`}
        title={`${isVt ? 'VT' : 'Installation'} — ${e.projectName ?? e.leadName} (toute la journée)`}
      >
        {e.projectName?.trim() || e.leadName}
      </button>
      {isVt && (
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation()
            window.open(`#/fiche-vt/${e.clientId}`, '_blank')
          }}
          title="Imprimer la fiche VT"
          className="shrink-0 text-sky-500 hover:text-sky-700 px-0.5 text-[10px] leading-none"
          aria-label="Imprimer la fiche VT"
        >
          🖨
        </button>
      )}
    </div>
  )
}

// ─── Technician chip (initials) ───────────────────────────────────────────────
function TechChip({ name, isVt }: { name: string; isVt: boolean }) {
  return (
    <span
      title={name}
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold shrink-0 ${
        isVt ? 'bg-sky-200 text-sky-800' : 'bg-amber-200 text-amber-800'
      }`}
    >
      {initials(name)}
    </span>
  )
}

// ─── Month view (day-bucketed, unchanged layout, adds heure label) ────────────
function MonthView({
  days,
  cursor,
  todayKey,
  eventsByDay,
  techNameById,
  onOpen,
  onOpenDay,
}: {
  days: Date[]
  cursor: Date
  todayKey: string
  eventsByDay: Map<string, VtCalendarEntry[]>
  techNameById: Map<string, string>
  onOpen: (e: VtCalendarEntry) => void
  onOpenDay: (d: Date) => void
}) {
  return (
    <div className="flex-grow grid grid-rows-[auto_1fr] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line-soft bg-white/70">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 py-2 text-center eyebrow text-[10px] text-faint border-l first:border-l-0 border-line-soft">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 overflow-y-auto">
        {days.map((d) => {
          const key = ymd(d)
          const list = eventsByDay.get(key) ?? []
          const muted = d.getMonth() !== cursor.getMonth()
          const isToday = key === todayKey
          return (
            <div
              key={key}
              className={`min-h-[96px] border-l border-t border-line-soft p-1.5 flex flex-col gap-1 ${
                muted ? 'bg-white/30 text-faint' : 'bg-white/55'
              } ${isToday ? 'ring-2 ring-cuivre ring-inset' : ''}`}
            >
              <button
                onClick={() => onOpenDay(d)}
                className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center hover:bg-or-tint ${
                  isToday ? 'bg-cuivre text-white hover:bg-cuivre' : ''
                }`}
              >
                {d.getDate()}
              </button>
              <div className="flex flex-col gap-1 overflow-hidden">
                {list.slice(0, 3).map((e) => (
                  <MonthEventChip
                    key={`${e.clientId}-${e.kind}`}
                    e={e}
                    techNameById={techNameById}
                    onOpen={onOpen}
                  />
                ))}
                {list.length > 3 && (
                  <button
                    onClick={() => onOpenDay(d)}
                    className="text-[11px] font-semibold text-muted hover:text-or text-left pl-1"
                  >
                    +{list.length - 3} autres
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Month event chip (compact, shows heure label) ────────────────────────────
function MonthEventChip({
  e,
  techNameById,
  onOpen,
}: {
  e: VtCalendarEntry
  techNameById: Map<string, string>
  onOpen: (e: VtCalendarEntry) => void
}) {
  const isVt = e.kind === 'vt'
  const techs = resolveTechs(e, techNameById)
  const techName = techs[0]?.name ?? null
  const project = e.projectName?.trim() || e.leadName
  return (
    <button
      onClick={() => onOpen(e)}
      title={`${isVt ? 'VT' : 'Installation'} — ${project}${techName ? ` — ${techName}` : ''}${e.heure ? ` à ${e.heure}` : ''}`}
      className={`w-full text-left rounded-lg border px-2 py-1 hover:shadow-sm transition-shadow ${
        isVt ? 'border-sky-300 bg-sky-50' : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${isVt ? 'bg-sky-500' : 'bg-amber-500'}`} />
        {e.heure && (
          <span className="text-[9px] font-mono font-semibold text-faint shrink-0">{e.heure}</span>
        )}
        <span className="font-bold text-[11px] leading-tight truncate">{project}</span>
      </div>
      <div className="flex items-center gap-1 pl-3.5 mt-0.5 text-[10px] text-muted truncate">
        <Icon name="users" size={10} />
        <span className="truncate">
          {techs.length === 0
            ? 'Non attribué'
            : techs.length === 1
              ? techName
              : `${techs[0].name} +${techs.length - 1}`}
        </span>
      </div>
    </button>
  )
}
