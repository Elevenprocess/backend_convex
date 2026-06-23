import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingBlock } from '../../components/Spinner'
import { useUsers, useVtCalendar } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import type { VtCalendarEntry } from '../../lib/types'

type PlanningView = 'day' | 'week' | 'month'

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

// Les interventions sont datées au jour (pas d'heure) → tout est indexé par
// la clé 'YYYY-MM-DD', ce qui évite tout décalage de fuseau.
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
    () => (selectedTechId ? (entries ?? []).filter((e) => e.technicienId === selectedTechId) : (entries ?? [])),
    [entries, selectedTechId],
  )
  const eventsByDay = useMemo(() => {
    const m = new Map<string, VtCalendarEntry[]>()
    for (const e of filtered) {
      const list = m.get(e.date) ?? []
      list.push(e)
      m.set(e.date, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.kind.localeCompare(b.kind) || a.leadName.localeCompare(b.leadName))
    return m
  }, [filtered])

  const todayKey = ymd(new Date())

  const title = view === 'day'
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
    // Page du dossier / workflow (suivi delivery) — scopée au client.
    navigate(`/suivi/${e.clientId}`)
  }

  return (
    <AppShell>
      <Topbar eyebrow="PLANNING" title={isTech ? 'Mes interventions' : 'Planning techniciens'} />

      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center gap-1.5 sm:gap-3 flex-wrap flex-shrink-0">
        <button onClick={() => move(-1)} className="btn-secondary p-2 rounded-xl text-muted shrink-0" aria-label="Période précédente">
          <Icon name="chevron-down" size={14} className="rotate-90" />
        </button>
        <button onClick={() => setCursor(new Date())} className="btn-secondary px-3 sm:px-4 py-2 rounded-xl text-xs whitespace-nowrap">Aujourd'hui</button>
        <button onClick={() => move(1)} className="btn-secondary p-2 rounded-xl text-muted shrink-0" aria-label="Période suivante">
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
              <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
            ))}
          </select>
        )}
        <div className={`${isTech ? 'ml-auto' : ''} flex items-center gap-3 text-[11px] font-bold text-muted`}>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> VT</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Installation</span>
        </div>
      </div>

      <main className="p-3 sm:p-6 md:p-8 pt-3 overflow-hidden flex-grow">
        <div className="glass-card !p-0 overflow-hidden h-full flex flex-col">
          {loading && !entries ? (
            <LoadingBlock label="Chargement du planning…" />
          ) : view === 'month' ? (
            <MonthView days={days} cursor={cursor} todayKey={todayKey} eventsByDay={eventsByDay}
              techNameById={techNameById} onOpen={openEntry}
              onOpenDay={(d) => { setCursor(d); setView('day') }} />
          ) : (
            <ColumnsView days={days} todayKey={todayKey} eventsByDay={eventsByDay}
              techNameById={techNameById} onOpen={openEntry} />
          )}
        </div>
      </main>
    </AppShell>
  )
}

// ─── Carte intervention ─────────────────────────────────────
function InterventionCard({ e, techNameById, onOpen, compact = false }: {
  e: VtCalendarEntry
  techNameById: Map<string, string>
  onOpen: (e: VtCalendarEntry) => void
  compact?: boolean
}) {
  const isVt = e.kind === 'vt'
  const tone = isVt ? 'border-sky-300 bg-sky-50' : 'border-emerald-300 bg-emerald-50'
  const dot = isVt ? 'bg-sky-500' : 'bg-emerald-500'
  const techName = e.technicienId ? techNameById.get(e.technicienId) : null
  const project = e.projectName?.trim() || e.leadName
  const showClientLine = Boolean(e.projectName?.trim()) && e.leadName !== e.projectName
  return (
    <button
      onClick={() => onOpen(e)}
      title={`${isVt ? 'VT' : 'Installation'} — ${project}${techName ? ` — ${techName}` : ''}`}
      className={`w-full text-left rounded-lg border ${tone} ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="font-bold text-[11px] sm:text-[12px] leading-tight truncate">{project}</span>
      </div>
      {!compact && showClientLine && (
        <div className="text-[10px] text-muted truncate pl-3.5">{e.leadName}</div>
      )}
      {!compact && (
        <div className="flex items-center gap-1 pl-3.5 mt-0.5 text-[10px] text-muted truncate">
          <Icon name="users" size={10} />
          <span className="truncate">{techName ?? 'Non attribué'}</span>
        </div>
      )}
    </button>
  )
}

// ─── Vue Jour / Semaine (colonnes) ──────────────────────────
function ColumnsView({ days, todayKey, eventsByDay, techNameById, onOpen }: {
  days: Date[]
  todayKey: string
  eventsByDay: Map<string, VtCalendarEntry[]>
  techNameById: Map<string, string>
  onOpen: (e: VtCalendarEntry) => void
}) {
  const single = days.length === 1
  return (
    <div className={`flex-grow overflow-auto ${single ? '' : ''}`}>
      <div className={single ? 'flex flex-col h-full' : 'grid'} style={single ? undefined : { gridTemplateColumns: `repeat(${days.length}, minmax(150px, 1fr))`, minWidth: days.length * 160 }}>
        {days.map((d) => {
          const key = ymd(d)
          const list = eventsByDay.get(key) ?? []
          const isToday = key === todayKey
          const weekday = frDay(d, { weekday: 'short' }).replace('.', '')
          return (
            <div key={key} className={`flex flex-col ${single ? '' : 'border-l border-line-soft first:border-l-0'} ${isToday ? 'bg-cream/30' : ''}`}>
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-line-soft px-2 py-2 text-center">
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${isToday ? 'bg-text text-white' : 'text-muted'}`}>
                  {d.getDate()} <span className="opacity-70">{weekday.charAt(0).toUpperCase() + weekday.slice(1)}</span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5 p-2 min-h-[60px]">
                {list.length === 0 ? (
                  <span className="text-[11px] text-faint text-center py-3">—</span>
                ) : (
                  list.map((e) => (
                    <InterventionCard key={`${e.clientId}-${e.kind}`} e={e} techNameById={techNameById} onOpen={onOpen} />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Vue Mois (grille 6×7) ──────────────────────────────────
function MonthView({ days, cursor, todayKey, eventsByDay, techNameById, onOpen, onOpenDay }: {
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
          <div key={w} className="px-1 py-2 text-center eyebrow text-[10px] text-faint border-l first:border-l-0 border-line-soft">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 overflow-y-auto">
        {days.map((d) => {
          const key = ymd(d)
          const list = eventsByDay.get(key) ?? []
          const muted = d.getMonth() !== cursor.getMonth()
          const isToday = key === todayKey
          return (
            <div key={key} className={`min-h-[96px] border-l border-t border-line-soft p-1.5 flex flex-col gap-1 ${muted ? 'bg-white/30 text-faint' : 'bg-white/55'} ${isToday ? 'ring-2 ring-cuivre ring-inset' : ''}`}>
              <button onClick={() => onOpenDay(d)} className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center hover:bg-or-tint ${isToday ? 'bg-cuivre text-white hover:bg-cuivre' : ''}`}>
                {d.getDate()}
              </button>
              <div className="flex flex-col gap-1 overflow-hidden">
                {list.slice(0, 3).map((e) => (
                  <InterventionCard key={`${e.clientId}-${e.kind}`} e={e} techNameById={techNameById} onOpen={onOpen} compact />
                ))}
                {list.length > 3 && (
                  <button onClick={() => onOpenDay(d)} className="text-[11px] font-semibold text-muted hover:text-or text-left pl-1">
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
