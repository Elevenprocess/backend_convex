import { useMemo, useState, type UIEvent, type WheelEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingBlock, Spinner } from '../../components/Spinner'
import { useGhlCalendarEvents, useRdvList, useLeads, type GhlCalendarEvent } from '../../lib/hooks'
import { fullName, type LeadResponse, type RdvResponse, type RdvStatus } from '../../lib/types'

const DEFAULT_HOURS = Array.from({ length: 12 }, (_, i) => 8 + i)
const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
type CalendarView = 'day' | 'week' | 'month'
type CalendarItem =
  | { source: 'local'; id: string; scheduledAt: string; status: RdvStatus; rdv: RdvResponse }
  | { source: 'ghl'; id: string; scheduledAt: string; status: 'ghl'; event: GhlCalendarEvent }

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
  const [continuousDays, setContinuousDays] = useState(35)
  const navigate = useNavigate()

  const period = useMemo(() => buildPeriod(cursorDate, view, continuousDays), [continuousDays, cursorDate, view])

  const { data: rdvs, loading, error } = useRdvList({
    fromDate: period.from.toISOString(),
    toDate: period.to.toISOString(),
    limit: 200,
  })
  const { data: ghlEventsData, loading: ghlLoading, error: ghlError } = useGhlCalendarEvents({
    from: period.from.toISOString(),
    to: period.to.toISOString(),
  })
  const { data: leads } = useLeads({ limit: 500 })

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const calendarItems = useMemo(() => {
    const localRdvs = rdvs ?? []
    const localExternalIds = new Set(localRdvs.map((r) => r.externalId).filter(Boolean))
    const localItems: CalendarItem[] = localRdvs.map((rdv) => ({
      source: 'local',
      id: rdv.id,
      scheduledAt: rdv.scheduledAt,
      status: rdv.status,
      rdv,
    }))
    const ghlItems: CalendarItem[] = (ghlEventsData?.events ?? [])
      .filter((event) => !localExternalIds.has(event.id))
      .map((event) => ({
        source: 'ghl',
        id: event.id,
        scheduledAt: event.startTime,
        status: 'ghl',
        event,
      }))
    return [...localItems, ...ghlItems].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  }, [ghlEventsData?.events, rdvs])

  const visibleHours = useMemo(() => {
    const hours = new Set(DEFAULT_HOURS)
    for (const item of calendarItems) hours.add(new Date(item.scheduledAt).getHours())
    return [...hours].sort((a, b) => a - b)
  }, [calendarItems])

  const rdvByHourCell = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const item of calendarItems) {
      const d = new Date(item.scheduledAt)
      const key = `${isoDay(d)}:${d.getHours()}`
      const list = m.get(key) ?? []
      list.push(item)
      list.sort(byCalendarItemAt)
      m.set(key, list)
    }
    return m
  }, [calendarItems])

  const handleHorizontalCalendarScroll = (event: WheelEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    const nativeScroller = target?.closest('[data-native-horizontal-scroll="true"]') as HTMLElement | null
    if (!nativeScroller || nativeScroller.scrollWidth <= nativeScroller.clientWidth) return

    const horizontalIntent = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0
    if (Math.abs(horizontalIntent) < 4) return

    event.preventDefault()
    nativeScroller.scrollLeft += horizontalIntent
  }

  const rdvByDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const item of calendarItems) {
      const key = isoDay(new Date(item.scheduledAt))
      const list = m.get(key) ?? []
      list.push(item)
      list.sort(byCalendarItemAt)
      m.set(key, list)
    }
    return m
  }, [calendarItems])

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
              {v === 'day' ? 'Jour' : v === 'week' ? 'Continu' : 'Mois'}
            </button>
          ))}
        </div>
        <span className="text-xs text-faint ml-auto hidden lg:inline">Scroll horizontal fluide dans le calendrier</span>
        {ghlLoading && <Spinner size={18} stroke={3} label="Sync GHL…" className="text-xs text-muted" />}
        <button onClick={() => navigate('/rdv/split')} className="btn-primary px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          <Icon name="plus" size={14} />
          Nouveau RDV
        </button>
      </div>

      <main className="p-8 pt-4 overflow-hidden flex-grow">
        <div
          className="glass-card !p-0 overflow-hidden h-full flex flex-col select-none"
          onWheel={handleHorizontalCalendarScroll}
          style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
        >
          {loading && !rdvs ? (
            <LoadingBlock label="Chargement de l’agenda…" />
          ) : error || ghlError ? (
            <div className="flex-grow flex items-center justify-center text-rouille text-sm">Erreur : {error ?? ghlError}</div>
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
              onNeedMoreDays={() => setContinuousDays((days) => Math.min(days + 21, 365))}
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
  onNeedMoreDays,
}: {
  days: DayCell[]
  visibleHours: number[]
  rdvByCell: Map<string, CalendarItem[]>
  leadMap: Map<string, LeadResponse>
  onOpen: (rdvId: string) => void
  onOpenDay: (date: Date) => void
  onNeedMoreDays?: () => void
}) {
  const dayWidth = days.length > 1 ? 240 : 520
  const gridColumns = `64px repeat(${days.length}, minmax(${dayWidth}px, 1fr))`
  const minWidth = 64 + days.length * dayWidth
  const handleNativeScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (onNeedMoreDays && el.scrollLeft + el.clientWidth > el.scrollWidth - 900) onNeedMoreDays()
  }

  return (
    <div data-native-horizontal-scroll="true" onScroll={handleNativeScroll} className="flex-grow overflow-x-auto overflow-y-hidden bg-white/30 overscroll-contain">
      <div className="h-full flex flex-col" style={{ minWidth }}>
        <div
          className="grid border-b border-line-soft flex-shrink-0 bg-white/70 sticky top-0 z-10"
          style={{ gridTemplateColumns: gridColumns }}
        >
          <div className="border-r border-line-soft" />
          {days.map((d) => (
            <button
              key={d.key}
              onClick={() => onOpenDay(d.date)}
              className={`p-3 text-center border-l border-line-soft hover:bg-or-tint ${d.today ? 'bg-cuivre-tint' : ''}`}
            >
              <div className="eyebrow">{days.length === 1 ? d.date.toLocaleDateString('fr-FR', { weekday: 'long' }) : d.date.toLocaleDateString('fr-FR', { weekday: 'short' }).toUpperCase()}</div>
              <div className={`text-2xl font-bold ${d.today ? 'text-cuivre' : ''}`}>{d.dayNum}</div>
            </button>
          ))}
        </div>
        <div
          className="grid flex-grow overflow-y-auto"
          style={{ gridTemplateColumns: gridColumns, gridAutoRows: 'minmax(76px, auto)' }}
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
      </div>
    </div>
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
  rdvByCell: Map<string, CalendarItem[]>
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
            {list.map((item) => (
              <RdvButton key={`${item.source}-${item.id}`} item={item} lead={item.source === 'local' ? leadMap.get(item.rdv.leadId) : undefined} onClick={() => item.source === 'local' && onOpen(item.id)} />
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
  rdvByDay: Map<string, CalendarItem[]>
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
                {list.slice(0, 4).map((item) => (
                  <RdvButton key={`${item.source}-${item.id}`} item={item} lead={item.source === 'local' ? leadMap.get(item.rdv.leadId) : undefined} compact onClick={() => item.source === 'local' && onOpen(item.id)} />
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

function RdvButton({ item, lead, compact = false, onClick }: { item: CalendarItem; lead?: LeadResponse; compact?: boolean; onClick: () => void }) {
  const isGhl = item.source === 'ghl'
  const label = isGhl ? ghlEventLabel(item.event) : (lead ? fullName(lead) : localRdvFallbackLabel(item.rdv))
  const detail = isGhl ? ghlEventDetail(item.event) : localRdvFallbackDetail(item.rdv)
  const tone = isGhl ? 'bg-info-tint text-info' : STATUS_TONE[item.rdv.status]
  const title = `${formatTime(item.scheduledAt)} — ${label}${detail ? ` — ${detail}` : ''}${isGhl ? ' — GHL temps réel' : ''}`
  return (
    <button
      onClick={onClick}
      className={`rdv-block ${tone} w-full text-left font-semibold rounded-xl transition-transform ${isGhl ? 'cursor-default' : 'hover:scale-[1.01]'} ${compact ? 'text-[11px] px-2 py-1 truncate' : 'min-h-12 text-[11px] px-2 py-2 mb-1'}`}
      title={title}
    >
      <span className="block truncate">{formatTime(item.scheduledAt)} — {label}</span>
      {!compact && detail && <span className="block text-[10px] opacity-75 truncate">{detail}</span>}
      {!compact && isGhl && <span className="block text-[10px] opacity-75">GHL live{item.event.sector ? ` · ${item.event.sector}` : ''}</span>}
    </button>
  )
}

function ghlEventLabel(event: GhlCalendarEvent): string {
  return event.contactName || event.title || `RDV GHL ${event.sector ?? ''}`.trim() || 'RDV GHL'
}

function ghlEventDetail(event: GhlCalendarEvent): string {
  return [event.contactPhone, event.contactCity, event.contactEmail].filter(Boolean).join(' · ')
}

function localRdvFallbackLabel(rdv: RdvResponse): string {
  const fromNotes = extractNotesValue(rdv.notes, ['Prospect', 'Nom', 'Client'])
  return fromNotes || 'Lead inconnu'
}

function localRdvFallbackDetail(rdv: RdvResponse): string {
  return [
    extractNotesValue(rdv.notes, ['Téléphone', 'Telephone', 'Phone']),
    extractNotesValue(rdv.notes, ['Ville', 'City']),
    extractNotesValue(rdv.notes, ['Email']),
  ].filter(Boolean).join(' · ')
}

function extractNotesValue(notes: string | null, labels: string[]): string | null {
  if (!notes) return null
  const lines = notes.split(/\r?\n/)
  for (const label of labels) {
    const prefix = `${label} :`
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()))
    const value = line?.slice(prefix.length).trim()
    if (value) return value
  }
  return null
}

function buildPeriod(cursorDate: Date, view: CalendarView, continuousDays = 35): { from: Date; to: Date; days: DayCell[]; label: string } {
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
  const safeDays = Math.max(14, Math.min(continuousDays, 365))
  to.setDate(from.getDate() + safeDays - 1)
  to.setHours(23, 59, 59, 999)
  const days: DayCell[] = []
  for (let i = 0; i < safeDays; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    days.push(toDayCell(d))
  }

  const opt: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }
  return {
    from,
    to,
    days,
    label: `Agenda continu · ${from.toLocaleDateString('fr-FR', opt)} → ${to.toLocaleDateString('fr-FR', opt)}`,
  }
}

function moveDate(date: Date, view: CalendarView, direction: -1 | 1, unit?: 'day'): Date {
  const next = new Date(date)
  if (unit === 'day') next.setDate(next.getDate() + direction)
  else if (view === 'day') next.setDate(next.getDate() + direction)
  else if (view === 'week') next.setDate(next.getDate() + direction * 7)
  else if (view === 'month') next.setMonth(next.getMonth() + direction)
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

function byCalendarItemAt(a: CalendarItem, b: CalendarItem): number {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}


