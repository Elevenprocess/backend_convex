import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { useGhlCalendarEvents, useRdvList, useLeads, type GhlCalendarEvent } from '../../lib/hooks'
import { fullName, type LeadResponse, type RdvResponse, type RdvStatus } from '../../lib/types'

const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const REUNION_TZ = 'Indian/Reunion'
const DEFAULT_DURATION_MIN = 60
const BASE_START_HOUR = 8
const BASE_END_HOUR = 19
type CalendarView = 'day' | 'week' | 'month'
type CalendarItem =
  | { source: 'local'; id: string; scheduledAt: string; status: RdvStatus; sector: string | null; rdv: RdvResponse }
  | { source: 'ghl'; id: string; scheduledAt: string; status: 'ghl'; sector: string | null; event: GhlCalendarEvent }

const STATUS_TONE: Record<RdvStatus, string> = {
  planifie: 'bg-cuivre-tint text-cuivre',
  honore: 'bg-success-tint text-success',
  no_show: 'bg-rouille-tint text-rouille',
  reporte: 'bg-info-tint text-info',
  annule: 'bg-rouille-tint text-rouille',
}

const SECTORS = ['Nord', 'Sud', 'Est', 'Ouest'] as const
type Sector = typeof SECTORS[number]
type Density = 'compact' | 'normal' | 'spacious'
const DENSITY_PX_PER_HOUR: Record<Density, number> = { compact: 32, normal: 48, spacious: 72 }

export function RdvCalendar() {
  const [view, setView] = useState<CalendarView>('week')
  const [cursorDate, setCursorDate] = useState(() => startOfDay(new Date()))
  const [selectedSectors, setSelectedSectors] = useState<Set<Sector>>(new Set())
  const [density, setDensity] = useState<Density>('normal')
  const [searchTerm, setSearchTerm] = useState('')
  const navigate = useNavigate()

  const pxPerHour = DENSITY_PX_PER_HOUR[density]
  const period = useMemo(() => buildPeriod(cursorDate, view), [cursorDate, view])

  function toggleSector(s: Sector) {
    setSelectedSectors((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const { data: rdvs, loading, error } = useRdvList({
    fromDate: period.from.toISOString(),
    toDate: period.to.toISOString(),
    limit: 200,
  })
  const { data: ghlEventsData, loading: ghlLoading, error: ghlError } = useGhlCalendarEvents({
    from: period.from.toISOString(),
    to: period.to.toISOString(),
  })
  const { data: leads } = useLeads({ limit: 1500 })

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const calendarItems = useMemo(() => {
    const localRdvs = rdvs ?? []
    const ghlEvents = ghlEventsData?.events ?? []
    const sectorByExternalId = new Map<string, string | null>()
    for (const e of ghlEvents) sectorByExternalId.set(e.id, e.sector ?? null)
    const sectorFromNotes = (notes: string | null): string | null => {
      if (!notes) return null
      const m = notes.match(/Secteur\s*:\s*([A-Za-zÀ-ÿ]+)/)
      return m ? m[1] : null
    }
    const localExternalIds = new Set(localRdvs.map((r) => r.externalId).filter(Boolean))
    const localItems: CalendarItem[] = localRdvs.map((rdv) => ({
      source: 'local',
      id: rdv.id,
      scheduledAt: rdv.scheduledAt,
      status: rdv.status,
      sector: (rdv.externalId && sectorByExternalId.get(rdv.externalId)) || sectorFromNotes(rdv.notes),
      rdv,
    }))
    const ghlItems: CalendarItem[] = ghlEvents
      .filter((event) => !localExternalIds.has(event.id))
      .map((event) => ({
        source: 'ghl',
        id: event.id,
        scheduledAt: event.startTime,
        status: 'ghl',
        sector: event.sector ?? null,
        event,
      }))
    const all = [...localItems, ...ghlItems].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    if (selectedSectors.size === 0) return all
    const wanted = new Set([...selectedSectors].map(normalizeSectorKey))
    return all.filter((item) => {
      if (!item.sector) return false
      return wanted.has(normalizeSectorKey(item.sector))
    })
  }, [ghlEventsData?.events, rdvs, selectedSectors])

  const searchMatchIds = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return null
    const matched = new Set<string>()
    for (const item of calendarItems) {
      const haystack = item.source === 'local'
        ? `${leadMap.get(item.rdv.leadId) ? fullName(leadMap.get(item.rdv.leadId)!) : ''}`.toLowerCase()
        : `${item.event.title ?? ''} ${item.event.sector ?? ''}`.toLowerCase()
      if (haystack.includes(term)) matched.add(`${item.source}-${item.id}`)
    }
    return matched
  }, [calendarItems, leadMap, searchTerm])

  const rdvByDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const item of calendarItems) {
      const key = reunionParts(item.scheduledAt).dateKey
      const list = m.get(key) ?? []
      list.push(item)
      list.sort(byCalendarItemAt)
      m.set(key, list)
    }
    return m
  }, [calendarItems])

  const hourRange = useMemo(() => {
    let minMin = BASE_START_HOUR * 60
    let maxMin = BASE_END_HOUR * 60
    for (const item of calendarItems) {
      const start = reunionParts(item.scheduledAt).minutesFromMidnight
      const end = start + getDurationMin(item)
      if (start < minMin) minMin = start
      if (end > maxMin) maxMin = end
    }
    const startHour = Math.max(0, Math.min(BASE_START_HOUR, Math.floor(minMin / 60)))
    const endHour = Math.min(24, Math.max(BASE_END_HOUR, Math.ceil(maxMin / 60)))
    return { startHour, endHour }
  }, [calendarItems])

  const placementsByDay = useMemo(() => {
    const m = new Map<string, EventPlacement[]>()
    for (const [key, items] of rdvByDay) {
      m.set(key, placeDayEvents(items, hourRange.startHour, pxPerHour))
    }
    return m
  }, [rdvByDay, hourRange.startHour, pxPerHour])

  return (
    <AppShell>
      <Topbar
        eyebrow="RDV / AGENDA"
        title={period.label}
      />
      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0 flex-wrap">
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

        <div className="h-6 w-px bg-line-soft mx-1" />

        <div className="flex items-center gap-1.5">
          {SECTORS.map((s) => {
            const active = selectedSectors.has(s)
            return (
              <button
                key={s}
                onClick={() => toggleSector(s)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${active ? 'bg-or text-white border-or' : 'bg-white/70 text-muted border-line hover:bg-or-tint'}`}
                title={`Secteur ${s}${active ? ' (actif)' : ''}`}
              >
                {s}
              </button>
            )
          })}
          {selectedSectors.size > 0 && (
            <button
              onClick={() => setSelectedSectors(new Set())}
              className="px-2 py-1 text-[11px] font-semibold text-faint hover:text-or"
              title="Effacer le filtre secteur"
            >
              ✕
            </button>
          )}
        </div>

        <div className="h-6 w-px bg-line-soft mx-1" />

        {view !== 'month' && (
          <div className="flex bg-or-tint p-1 rounded-xl" title="Densité visuelle">
            {(['compact', 'normal', 'spacious'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg ${density === d ? 'bg-white shadow-sm text-text' : 'text-muted'}`}
                title={d === 'compact' ? 'Compact (32 px/h)' : d === 'normal' ? 'Normal (48 px/h)' : 'Aéré (72 px/h)'}
              >
                {d === 'compact' ? 'Compact' : d === 'normal' ? 'Normal' : 'Aéré'}
              </button>
            ))}
          </div>
        )}

        <div className="relative ml-auto flex items-center">
          <Icon name="search" size={14} className="absolute left-2.5 text-faint pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher un lead…"
            className="bg-white/80 border border-line rounded-xl pl-8 pr-3 py-1.5 text-xs w-52 focus:outline-none focus:border-or"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 text-faint hover:text-or text-xs"
              title="Effacer la recherche"
            >
              ✕
            </button>
          )}
        </div>

        {ghlLoading && <span className="text-xs text-muted">Sync GHL…</span>}
        <button onClick={() => navigate('/rdv/split')} className="btn-primary px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          <Icon name="plus" size={14} />
          Nouveau RDV
        </button>
      </div>

      <main className="p-8 pt-4 overflow-hidden flex-grow">
        <div className="glass-card !p-0 overflow-hidden h-full flex flex-col">
          {loading && !rdvs ? (
            <div className="flex-grow flex items-center justify-center text-faint text-sm">Chargement…</div>
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
              hourRange={hourRange}
              placementsByDay={placementsByDay}
              leadMap={leadMap}
              pxPerHour={pxPerHour}
              searchMatchIds={searchMatchIds}
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
  hourRange,
  placementsByDay,
  leadMap,
  pxPerHour,
  searchMatchIds,
  onOpen,
  onOpenDay,
}: {
  days: DayCell[]
  hourRange: { startHour: number; endHour: number }
  placementsByDay: Map<string, EventPlacement[]>
  leadMap: Map<string, LeadResponse>
  pxPerHour: number
  searchMatchIds: Set<string> | null
  onOpen: (rdvId: string) => void
  onOpenDay: (date: Date) => void
}) {
  const hours = useMemo(
    () => Array.from({ length: hourRange.endHour - hourRange.startHour + 1 }, (_, i) => hourRange.startHour + i),
    [hourRange.startHour, hourRange.endHour],
  )
  const totalHeight = (hourRange.endHour - hourRange.startHour) * pxPerHour
  const gridCols = `64px repeat(${days.length}, minmax(0, 1fr))`

  return (
    <>
      <div
        className="grid border-b border-line-soft flex-shrink-0 bg-white/70"
        style={{ gridTemplateColumns: gridCols }}
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
      <div className="flex-grow overflow-y-auto bg-white/30">
        <div
          className="grid relative"
          style={{ gridTemplateColumns: gridCols, height: totalHeight + pxPerHour }}
        >
          <div className="relative border-r border-line-soft bg-white/50">
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute right-2 text-[11px] text-faint font-semibold"
                style={{ top: i * pxPerHour - 7 }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map((d) => {
            const placements = placementsByDay.get(d.key) ?? []
            return (
              <DayColumn
                key={d.key}
                day={d}
                placements={placements}
                hours={hours}
                leadMap={leadMap}
                pxPerHour={pxPerHour}
                searchMatchIds={searchMatchIds}
                onOpen={onOpen}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}

function DayColumn({
  day,
  placements,
  hours,
  leadMap,
  pxPerHour,
  searchMatchIds,
  onOpen,
}: {
  day: DayCell
  placements: EventPlacement[]
  hours: number[]
  leadMap: Map<string, LeadResponse>
  pxPerHour: number
  searchMatchIds: Set<string> | null
  onOpen: (rdvId: string) => void
}) {
  return (
    <div className={`relative border-l border-line-soft ${day.today ? 'bg-cuivre-tint/15' : ''}`}>
      {hours.map((_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-line-soft/60 pointer-events-none"
          style={{ top: i * pxPerHour }}
        />
      ))}
      {hours.map((_, i) => (
        <div
          key={`half-${i}`}
          className="absolute left-0 right-0 border-t border-dashed border-line-soft/30 pointer-events-none"
          style={{ top: i * pxPerHour + pxPerHour / 2 }}
        />
      ))}
      {placements.map((p) => {
        const widthPct = 100 / p.colCount
        const leftPct = p.colIdx * widthPct
        const lead = p.item.source === 'local' ? leadMap.get(p.item.rdv.leadId) : undefined
        const key = `${p.item.source}-${p.item.id}`
        const matched = searchMatchIds === null ? null : searchMatchIds.has(key)
        return (
          <RdvBlock
            key={key}
            item={p.item}
            lead={lead}
            top={p.top}
            height={p.height}
            leftPct={leftPct}
            widthPct={widthPct}
            matched={matched}
            onClick={() => p.item.source === 'local' && onOpen(p.item.id)}
          />
        )
      })}
    </div>
  )
}

function RdvBlock({
  item,
  lead,
  top,
  height,
  leftPct,
  widthPct,
  matched,
  onClick,
}: {
  item: CalendarItem
  lead?: LeadResponse
  top: number
  height: number
  leftPct: number
  widthPct: number
  matched: boolean | null
  onClick: () => void
}) {
  const isGhl = item.source === 'ghl'
  const label = isGhl ? item.event.title || `RDV GHL ${item.event.sector ?? ''}`.trim() : (lead ? fullName(lead) : 'Lead inconnu')
  const tone = isGhl ? 'bg-info-tint text-info border-info/30' : `${STATUS_TONE[item.rdv.status]} border-line-soft`
  const title = `${formatTime(item.scheduledAt)} — ${label}${isGhl ? ' — GHL temps réel' : ''}`
  const dense = height < 36
  const searchClass = matched === null ? '' : matched ? 'ring-2 ring-or shadow-md z-10' : 'opacity-30'
  return (
    <button
      onClick={onClick}
      title={title}
      className={`absolute rounded-lg border px-2 py-1 text-left font-semibold overflow-hidden transition-all ${tone} ${searchClass} ${isGhl ? 'cursor-default' : 'hover:shadow-md hover:z-10'}`}
      style={{
        top,
        height: Math.max(20, height - 2),
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
    >
      <span className={`block truncate ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
        {formatTime(item.scheduledAt)} — {label}
      </span>
      {!dense && isGhl && (
        <span className="block text-[10px] opacity-75 truncate">GHL live{item.event.sector ? ` · ${item.event.sector}` : ''}</span>
      )}
    </button>
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
  const label = isGhl ? item.event.title || `RDV GHL ${item.event.sector ?? ''}`.trim() : (lead ? fullName(lead) : 'Lead inconnu')
  const tone = isGhl ? 'bg-info-tint text-info' : STATUS_TONE[item.rdv.status]
  const title = `${formatTime(item.scheduledAt)} — ${label}${isGhl ? ' — GHL temps réel' : ''}`
  return (
    <button
      onClick={onClick}
      className={`rdv-block ${tone} w-full text-left font-semibold rounded-xl transition-transform ${isGhl ? 'cursor-default' : 'hover:scale-[1.01]'} ${compact ? 'text-[11px] px-2 py-1 truncate' : 'min-h-12 text-[11px] px-2 py-2 mb-1'}`}
      title={title}
    >
      <span className="block truncate">{formatTime(item.scheduledAt)} — {label}</span>
      {!compact && isGhl && <span className="text-[10px] opacity-75">GHL live{item.event.sector ? ` · ${item.event.sector}` : ''}</span>}
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

function byCalendarItemAt(a: CalendarItem, b: CalendarItem): number {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: REUNION_TZ })
}

type EventPlacement = {
  item: CalendarItem
  top: number
  height: number
  colIdx: number
  colCount: number
}

function normalizeSectorKey(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function reunionParts(iso: string): { dateKey: string; hour: number; minute: number; minutesFromMidnight: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: REUNION_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  const hour = parseInt(get('hour'), 10) % 24
  const minute = parseInt(get('minute'), 10)
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute,
    minutesFromMidnight: hour * 60 + minute,
  }
}

function getDurationMin(item: CalendarItem): number {
  if (item.source === 'ghl' && item.event.endTime) {
    const start = new Date(item.event.startTime).getTime()
    const end = new Date(item.event.endTime).getTime()
    const min = Math.round((end - start) / 60000)
    if (min > 0 && min < 480) return min
  }
  return DEFAULT_DURATION_MIN
}

function placeDayEvents(items: CalendarItem[], gridStartHour: number, pxPerHour: number): EventPlacement[] {
  const gridStartMin = gridStartHour * 60
  const pxPerMin = pxPerHour / 60
  const sorted = [...items].sort((a, b) => {
    const da = reunionParts(a.scheduledAt).minutesFromMidnight
    const db = reunionParts(b.scheduledAt).minutesFromMidnight
    return da - db
  })
  type Placed = { item: CalendarItem; start: number; end: number; colIdx: number; groupId: number }
  const placed: Placed[] = []
  let lastGroupEnd = -1
  let groupId = -1
  let colEnds: number[] = []
  for (const item of sorted) {
    const start = reunionParts(item.scheduledAt).minutesFromMidnight
    const end = start + getDurationMin(item)
    if (start >= lastGroupEnd) {
      groupId++
      colEnds = []
    }
    let col = colEnds.findIndex((e) => e <= start)
    if (col === -1) col = colEnds.length
    colEnds[col] = end
    lastGroupEnd = Math.max(lastGroupEnd, end)
    placed.push({ item, start, end, colIdx: col, groupId })
  }
  const groupCols = new Map<number, number>()
  for (const p of placed) {
    groupCols.set(p.groupId, Math.max(groupCols.get(p.groupId) ?? 0, p.colIdx + 1))
  }
  return placed.map((p) => ({
    item: p.item,
    top: (p.start - gridStartMin) * pxPerMin,
    height: (p.end - p.start) * pxPerMin,
    colIdx: p.colIdx,
    colCount: groupCols.get(p.groupId) ?? 1,
  }))
}
