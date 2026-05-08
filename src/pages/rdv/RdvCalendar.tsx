import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { useRdvList, useLeads } from '../../lib/hooks'
import { fullName, type LeadResponse, type RdvResponse, type RdvStatus } from '../../lib/types'

const DEFAULT_HOURS = Array.from({ length: 12 }, (_, i) => 8 + i)
const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
type CalendarView = 'day' | 'week' | 'month'

const STATUS_TONE: Record<RdvStatus, string> = {
  planifie: 'bg-cuivre-tint text-cuivre',
  honore: 'bg-success-tint text-success',
  no_show: 'bg-rouille-tint text-rouille',
  reporte: 'bg-info-tint text-info',
  annule: 'bg-rouille-tint text-rouille',
}

export function RdvCalendar() {
  const [view, setView] = useState<CalendarView>('week')
  const [cursorDate, setCursorDate] = useState(() => startOfDay(new Date()))
  const navigate = useNavigate()

  const period = useMemo(() => buildPeriod(cursorDate, view), [cursorDate, view])

  const { data: rdvs, loading, error } = useRdvList({
    fromDate: period.from.toISOString(),
    toDate: period.to.toISOString(),
    limit: 500,
  })
  const { data: leads } = useLeads({ limit: 1500 })

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const plannedRdvs = useMemo(
    () => (rdvs ?? []).filter((r) => r.status === 'planifie'),
    [rdvs],
  )

  const visibleHours = useMemo(() => {
    const hours = new Set(DEFAULT_HOURS)
    for (const r of plannedRdvs) hours.add(new Date(r.scheduledAt).getHours())
    return [...hours].sort((a, b) => a - b)
  }, [plannedRdvs])

  const rdvByHourCell = useMemo(() => {
    const m = new Map<string, RdvResponse[]>()
    for (const r of plannedRdvs) {
      const d = new Date(r.scheduledAt)
      const key = `${isoDay(d)}:${d.getHours()}`
      const list = m.get(key) ?? []
      list.push(r)
      list.sort(byScheduledAt)
      m.set(key, list)
    }
    return m
  }, [plannedRdvs])

  const rdvByDay = useMemo(() => {
    const m = new Map<string, RdvResponse[]>()
    for (const r of plannedRdvs) {
      const key = isoDay(new Date(r.scheduledAt))
      const list = m.get(key) ?? []
      list.push(r)
      list.sort(byScheduledAt)
      m.set(key, list)
    }
    return m
  }, [plannedRdvs])

  return (
    <AppShell>
      <Topbar
        eyebrow="RDV / AGENDA"
        title={period.label}
      />
      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => setCursorDate((d) => moveDate(d, view, -1))} className="btn-secondary p-2 rounded-xl text-muted" aria-label="Période précédente">
          <Icon name="chevron-down" size={14} className="rotate-90" />
        </button>
        <button onClick={() => setCursorDate(startOfDay(new Date()))} className="btn-secondary px-4 py-2 rounded-xl text-xs">Aujourd'hui</button>
        <button onClick={() => setCursorDate((d) => moveDate(d, view, 1))} className="btn-secondary p-2 rounded-xl text-muted" aria-label="Période suivante">
          <Icon name="chevron-right" size={14} />
        </button>
        <div className="flex bg-or-tint p-1 rounded-xl">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg ${view === v ? 'bg-white shadow-sm text-text' : 'text-muted'}`}
            >
              {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : 'Mois'}
            </button>
          ))}
        </div>
        <button onClick={() => navigate('/rdv/split')} className="btn-primary px-4 py-2 rounded-xl text-sm flex items-center gap-2 ml-auto">
          <Icon name="plus" size={14} />
          Nouveau RDV
        </button>
      </div>

      <main className="p-8 pt-4 overflow-hidden flex-grow">
        <div className="glass-card !p-0 overflow-hidden h-full flex flex-col">
          {loading ? (
            <div className="flex-grow flex items-center justify-center text-faint text-sm">Chargement…</div>
          ) : error ? (
            <div className="flex-grow flex items-center justify-center text-rouille text-sm">Erreur : {error}</div>
          ) : view === 'month' ? (
            <MonthView
              days={period.days}
              cursorDate={cursorDate}
              rdvByDay={rdvByDay}
              leadMap={leadMap}
              onOpen={(rdvId) => navigate(`/rdv/${rdvId}`)}
              onOpenDay={(date) => { setCursorDate(date); setView('day') }}
            />
          ) : (
            <TimeGridView
              days={period.days}
              visibleHours={visibleHours}
              rdvByCell={rdvByHourCell}
              leadMap={leadMap}
              onOpen={(rdvId) => navigate(`/rdv/${rdvId}`)}
              onOpenDay={(date) => { setCursorDate(date); setView('day') }}
            />
          )}
        </div>
      </main>
    </AppShell>
  )
}

type DayCell = { key: string; date: Date; dayNum: string; today: boolean; muted?: boolean }

function TimeGridView({
  days,
  visibleHours,
  rdvByCell,
  leadMap,
  onOpen,
  onOpenDay,
}: {
  days: DayCell[]
  visibleHours: number[]
  rdvByCell: Map<string, RdvResponse[]>
  leadMap: Map<string, LeadResponse>
  onOpen: (rdvId: string) => void
  onOpenDay: (date: Date) => void
}) {
  return (
    <>
      <div
        className="grid border-b border-line-soft flex-shrink-0 bg-white/70"
        style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div className="border-r border-line-soft" />
        {days.map((d, i) => (
          <button
            key={d.key}
            onClick={() => onOpenDay(d.date)}
            className={`p-3 text-center border-l border-line-soft hover:bg-or-tint ${d.today ? 'bg-cuivre-tint' : ''}`}
          >
            <div className="eyebrow">{days.length === 1 ? d.date.toLocaleDateString('fr-FR', { weekday: 'long' }) : DAY_LABELS[i]}</div>
            <div className={`text-2xl font-bold ${d.today ? 'text-cuivre' : ''}`}>{d.dayNum}</div>
          </button>
        ))}
      </div>
      <div
        className="grid flex-grow overflow-y-auto bg-white/30"
        style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))`, gridAutoRows: 'minmax(76px, auto)' }}
      >
        {visibleHours.map((hour) => (
          <RowHour
            key={hour}
            hour={hour}
            days={days}
            rdvByCell={rdvByCell}
            leadMap={leadMap}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  )
}

function RowHour({
  hour,
  days,
  rdvByCell,
  leadMap,
  onOpen,
}: {
  hour: number
  days: DayCell[]
  rdvByCell: Map<string, RdvResponse[]>
  leadMap: Map<string, LeadResponse>
  onOpen: (rdvId: string) => void
}) {
  return (
    <>
      <div className="border-t border-line-soft text-xs text-faint text-right pr-2 pt-1 bg-white/50">{formatHour(hour)}</div>
      {days.map((d) => {
        const list = rdvByCell.get(`${d.key}:${hour}`) ?? []
        return (
          <div key={d.key} className={`border-l border-t border-line-soft p-1 relative ${d.today ? 'bg-cuivre-tint/20' : ''}`}>
            {list.map((rdv) => (
              <RdvButton key={rdv.id} rdv={rdv} lead={leadMap.get(rdv.leadId)} onClick={() => onOpen(rdv.id)} />
            ))}
          </div>
        )
      })}
    </>
  )
}

function MonthView({
  days,
  cursorDate,
  rdvByDay,
  leadMap,
  onOpen,
  onOpenDay,
}: {
  days: DayCell[]
  cursorDate: Date
  rdvByDay: Map<string, RdvResponse[]>
  leadMap: Map<string, LeadResponse>
  onOpen: (rdvId: string) => void
  onOpenDay: (date: Date) => void
}) {
  return (
    <div className="flex-grow grid grid-rows-[auto_1fr] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line-soft bg-white/70">
        {DAY_LABELS.map((label) => (
          <div key={label} className="p-3 text-center eyebrow border-l first:border-l-0 border-line-soft">{label}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 overflow-hidden">
        {days.map((d) => {
          const list = rdvByDay.get(d.key) ?? []
          const muted = d.date.getMonth() !== cursorDate.getMonth()
          return (
            <div key={d.key} className={`min-h-0 border-l border-t border-line-soft p-2 flex flex-col ${muted ? 'bg-white/30 text-faint' : 'bg-white/55'} ${d.today ? 'ring-2 ring-cuivre ring-inset' : ''}`}>
              <button onClick={() => onOpenDay(d.date)} className={`w-8 h-8 rounded-full text-sm font-bold text-left pl-2 hover:bg-or-tint ${d.today ? 'bg-cuivre text-white hover:bg-cuivre' : ''}`}>
                {d.date.getDate()}
              </button>
              <div className="mt-1 space-y-1 overflow-hidden">
                {list.slice(0, 4).map((rdv) => (
                  <RdvButton key={rdv.id} rdv={rdv} lead={leadMap.get(rdv.leadId)} compact onClick={() => onOpen(rdv.id)} />
                ))}
                {list.length > 4 && (
                  <button onClick={() => onOpenDay(d.date)} className="text-[11px] font-semibold text-muted hover:text-or">+{list.length - 4} autres</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RdvButton({ rdv, lead, compact = false, onClick }: { rdv: RdvResponse; lead?: LeadResponse; compact?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rdv-block ${STATUS_TONE[rdv.status]} w-full text-left font-semibold rounded-xl hover:scale-[1.01] transition-transform ${compact ? 'text-[11px] px-2 py-1 truncate' : 'min-h-12 text-[11px] px-2 py-2 mb-1'}`}
      title={`${formatTime(rdv.scheduledAt)} — ${lead ? fullName(lead) : 'Lead inconnu'}`}
    >
      {formatTime(rdv.scheduledAt)} — {lead ? fullName(lead) : '…'}
    </button>
  )
}

function buildPeriod(cursorDate: Date, view: CalendarView): { from: Date; to: Date; days: DayCell[]; label: string } {
  if (view === 'day') {
    const from = startOfDay(cursorDate)
    const to = endOfDay(cursorDate)
    return {
      from,
      to,
      days: [toDayCell(from)],
      label: from.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
    }
  }

  if (view === 'month') {
    const firstOfMonth = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1)
    const lastOfMonth = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 0)
    const gridStart = startOfWeek(firstOfMonth)
    const gridEnd = new Date(gridStart)
    gridEnd.setDate(gridStart.getDate() + 41)
    gridEnd.setHours(23, 59, 59, 999)

    const days: DayCell[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      days.push({ ...toDayCell(d), muted: d < firstOfMonth || d > lastOfMonth })
    }

    return {
      from: gridStart,
      to: gridEnd,
      days,
      label: cursorDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    }
  }

  const from = startOfWeek(cursorDate)
  const to = new Date(from)
  to.setDate(from.getDate() + 6)
  to.setHours(23, 59, 59, 999)
  const days: DayCell[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    days.push(toDayCell(d))
  }

  const opt: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }
  return {
    from,
    to,
    days,
    label: `Semaine du ${from.toLocaleDateString('fr-FR', opt)} — ${to.toLocaleDateString('fr-FR', opt)}`,
  }
}

function moveDate(date: Date, view: CalendarView, direction: -1 | 1): Date {
  const next = new Date(date)
  if (view === 'day') next.setDate(next.getDate() + direction)
  if (view === 'week') next.setDate(next.getDate() + direction * 7)
  if (view === 'month') next.setMonth(next.getMonth() + direction)
  return startOfDay(next)
}

function toDayCell(date: Date): DayCell {
  const d = startOfDay(date)
  return {
    key: isoDay(d),
    date: d,
    dayNum: String(d.getDate()).padStart(2, '0'),
    today: isSameDay(d, new Date()),
  }
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  const dow = d.getDay() || 7
  d.setDate(d.getDate() - (dow - 1))
  return d
}

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function byScheduledAt(a: RdvResponse, b: RdvResponse): number {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
