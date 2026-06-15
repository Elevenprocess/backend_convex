import { useEffect, useMemo, useState, type CSSProperties, type UIEvent, type WheelEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingBlock, Spinner } from '../../components/Spinner'
import { useGhlCalendarEvents, useRdvList, useLeads, useUsers, useVtCalendar, type GhlCalendarEvent } from '../../lib/hooks'
import { fullName, type LeadResponse, type RdvResponse, type RdvStatus, type VtCalendarEntry } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { leadSearchPath } from '../../lib/leadPaths'
import { matchesCalendarFilters, type CalendarFilterState } from '../../lib/calendarFilters'
import { type Sector, SECTORS, sectorFromCity } from '../../lib/sector'
import { rdvCardCategory, type RdvCardCategory } from './rdvCardCategory'

const DEFAULT_HOURS = Array.from({ length: 12 }, (_, i) => 8 + i)
const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const REUNION_TZ = 'Indian/Reunion'
const REUNION_OFFSET_MS = 4 * 60 * 60 * 1000
// Durée par défaut d'un RDV : 1h30. Sert au rendu visuel uniquement (pas en BDD).
const RDV_DURATION_MIN = 90
// Niveaux de zoom vertical (px par heure). Permet de comprimer/aérer l'agenda
// pour limiter le scroll. Persistant via localStorage.
const HOUR_HEIGHT_LEVELS = [24, 32, 48, 64, 96, 128] as const
const HOUR_HEIGHT_DEFAULT = 64
const HOUR_HEIGHT_STORAGE_KEY = 'ecoi.calendar.hourHeight'
// Limite de cartes visibles dans une pile de RDV chevauchants. Au-delà, on
// affiche un bouton "+N" qui ouvre un popup avec la liste complète.
// Volontairement à 1 pour ne pas déborder sur l'horaire suivant — la pile
// loge dans le créneau d'1h (1 carte + petite pilule "+N").
const STACK_VISIBLE_LIMIT = 1
// Hauteur réservée en bas du créneau au bouton "+N" quand il y a un débordement.
const MORE_PILL_HEIGHT = 18
const MORE_PILL_GAP = 2
type CalendarView = 'day' | 'week' | 'month'
type CalendarItem =
  | { source: 'local'; id: string; scheduledAt: string; status: RdvStatus; rdv: RdvResponse }
  | { source: 'ghl'; id: string; scheduledAt: string; status: 'ghl'; event: GhlCalendarEvent }
  | { source: 'vt'; id: string; scheduledAt: string; status: 'vt'; vt: VtCalendarEntry }

// Rôles autorisés sur chaque feed calendrier — miroir des @Roles côté backend.
// Appeler un feed hors périmètre renvoie 403 (ex. technicien sur /ghl-calendar/events),
// donc on gate le fetch par rôle au lieu de laisser l'appel partir et échouer.
// GHL events (/ghl-calendar/events) : admin + équipes sales (setter/commercial).
const GHL_FEED_ROLES = ['admin', 'setter', 'setter_lead', 'commercial', 'commercial_lead']
// VT (/clients/vt-calendar) : admin + ops/délivrabilité + technicien.
const VT_FEED_ROLES = ['admin', 'delivrabilite', 'responsable_technique', 'back_office', 'technicien']

// Toutes les cartes RDV ont le MÊME fond gris neutre (look "skeleton/chargement").
// Le secteur est uniquement signifié par la couleur du point ● à l'intérieur —
// les badges restent eux aussi neutres pour ne pas réintroduire la couleur du secteur.
const CARD_TONE = 'bg-cream-darker text-text border-line'

// Teintes légères des cartes RDV par catégorie (admin / commercial_lead).
// Réutilise les tokens de teinte du design system (cf. CARD_TONE / vtKindTone).
const CATEGORY_TONE: Record<RdvCardCategory, string> = {
  devis: 'bg-cuivre-tint text-text border-line',
  debrief: 'bg-success-tint text-text border-line',
  avenir: 'bg-white text-text border-line',
  absent: 'bg-rouille-tint text-text border-line',
  autre: 'bg-info-tint text-text border-line',
}

// Teinte d'une carte RDV : VT → tone VT ; RDV local coloré (rôles autorisés) →
// teinte par catégorie ; sinon fond neutre actuel.
function rdvCardTone(item: CalendarItem, colorize: boolean): string {
  if (item.source === 'vt') return vtKindTone(item.vt)
  if (item.source === 'local' && colorize) {
    return CATEGORY_TONE[rdvCardCategory(item.rdv, new Date().toISOString())]
  }
  return CARD_TONE
}

const NEUTRAL_BADGE_TONE = 'bg-white text-muted border border-line'
const SECTOR_DOT: Record<Sector, string> = {
  Nord: 'bg-sky-500',
  Sud: 'bg-orange-500',
  Est: 'bg-emerald-500',
  Ouest: 'bg-violet-500',
  Autre: 'bg-faint',
}

const STATUS_BADGE_LABEL: Partial<Record<RdvStatus, string>> = {
  planifie: 'Programmé',
  honore: 'Confirmé',
  reporte: 'Reporté',
  no_show: 'No-show',
  annule: 'Annulé',
}

// La VT n'a pas d'heure en base : on la pose à 08:00 heure Réunion pour
// l'afficher dans la grille horaire, sur la bonne journée.
function vtScheduledAt(date: string): string {
  // date = 'YYYY-MM-DD'. 08:00 Réunion = 04:00 UTC (UTC+4).
  return `${date.slice(0, 10)}T04:00:00.000Z`
}

function sectorForItem(item: CalendarItem, lead?: LeadResponse): Sector {
  if (item.source === 'vt') return sectorFromCity(item.vt.city)
  if (item.source === 'ghl' && item.event.sector) {
    const s = item.event.sector
    if (s === 'Nord' || s === 'Sud' || s === 'Est' || s === 'Ouest') return s
  }
  if (item.source === 'ghl') return sectorFromCity(item.event.contactCity)
  return sectorFromCity(lead?.city)
}

export function RdvCalendar() {
  const role = useAuth((s) => s.user?.role)
  const colorize = role === 'admin' || role === 'commercial_lead'
  // Sur mobile, la vue semaine (7 colonnes) impose un scroll horizontal :
  // on démarre donc en vue "jour", plus lisible au doigt. Desktop reste en semaine.
  const [view, setView] = useState<CalendarView>(
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week'),
  )
  const [cursorDate, setCursorDate] = useState(() => startOfReunionDay(new Date()))
  const [continuousDays, setContinuousDays] = useState(35)
  const [hourHeight, setHourHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return HOUR_HEIGHT_DEFAULT
    const raw = Number(window.localStorage.getItem(HOUR_HEIGHT_STORAGE_KEY) ?? '')
    return HOUR_HEIGHT_LEVELS.includes(raw as typeof HOUR_HEIGHT_LEVELS[number]) ? raw : HOUR_HEIGHT_DEFAULT
  })
  const [vtPopup, setVtPopup] = useState<VtCalendarEntry | null>(null)
  // Filtres (vide = pas de filtre sur cette dimension). Non persistés.
  const [selectedSectors, setSelectedSectors] = useState<Set<string>>(new Set())
  const [selectedCommercials, setSelectedCommercials] = useState<Set<string>>(new Set())
  const [commercialMenuOpen, setCommercialMenuOpen] = useState(false)
  const navigate = useNavigate()

  function changeHourHeight(direction: -1 | 1) {
    setHourHeight((current) => {
      const idx = HOUR_HEIGHT_LEVELS.indexOf(current as typeof HOUR_HEIGHT_LEVELS[number])
      const safeIdx = idx < 0 ? HOUR_HEIGHT_LEVELS.indexOf(HOUR_HEIGHT_DEFAULT) : idx
      const nextIdx = Math.max(0, Math.min(HOUR_HEIGHT_LEVELS.length - 1, safeIdx + direction))
      const next = HOUR_HEIGHT_LEVELS[nextIdx]
      try { window.localStorage.setItem(HOUR_HEIGHT_STORAGE_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const period = useMemo(() => buildPeriod(cursorDate, view, continuousDays), [continuousDays, cursorDate, view])

  const canSeeGhl = !!role && GHL_FEED_ROLES.includes(role)
  const canSeeVt = !!role && VT_FEED_ROLES.includes(role)

  const { data: rdvs, loading, error } = useRdvList({
    fromDate: period.from.toISOString(),
    toDate: period.to.toISOString(),
    limit: 200,
  })
  // Feeds secondaires (overlay live) : gated par rôle pour éviter les 403, et
  // leurs erreurs ne doivent jamais blanchir l'agenda (le feed primaire = /rdv).
  const { data: ghlEventsData, loading: ghlLoading } = useGhlCalendarEvents(
    canSeeGhl ? { from: period.from.toISOString(), to: period.to.toISOString() } : undefined,
  )
  const { data: leads } = useLeads({ limit: 500 })
  const { data: vtEntries } = useVtCalendar(
    canSeeVt ? { from: period.from.toISOString(), to: period.to.toISOString() } : null,
  )
  const { data: users } = useUsers()

  const commercials = useMemo(
    () => (users ?? [])
      .filter((u) => u.role === 'commercial' || u.role === 'commercial_lead')
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const leadByExternalId = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) if (l.externalId) m.set(l.externalId, l)
    return m
  }, [leads])

  const openCalendarItem = (item: CalendarItem) => {
    if (item.source === 'vt') {
      if (role === 'admin' || role === 'delivrabilite' || role === 'responsable_technique' || role === 'back_office') {
        navigate(`/suivi/${item.vt.clientId}`)
      } else {
        setVtPopup(item.vt) // technicien : popup lecture seule
      }
      return
    }
    if (item.source === 'local') {
      navigate(`/rdv/${item.id}`)
      return
    }
    const lead = item.event.contactId ? leadByExternalId.get(item.event.contactId) : undefined
    const search = lead ? fullName(lead) : item.event.contactPhone || item.event.contactName || item.event.contactEmail || item.event.title || ''
    if (search) navigate(leadSearchPath(role, search))
  }

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
    const vtItems: CalendarItem[] = (vtEntries ?? []).map((vt) => ({
      source: 'vt',
      id: `vt-${vt.clientId}`,
      scheduledAt: vtScheduledAt(vt.date),
      status: 'vt',
      vt,
    }))
    return [...localItems, ...ghlItems, ...vtItems].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  }, [ghlEventsData?.events, rdvs, vtEntries])

  // Commercial associé à un item : RDV local → commercialId, GHL → assignedToId, VT → aucun.
  const commercialOf = (item: CalendarItem): string | null =>
    item.source === 'local' ? item.rdv.commercialId : item.source === 'ghl' ? (item.event.commercialId ?? null) : null

  const leadForItem = (item: CalendarItem): LeadResponse | undefined =>
    item.source === 'ghl'
      ? (item.event.contactId ? leadByExternalId.get(item.event.contactId) : undefined)
      : item.source === 'vt' ? undefined : leadMap.get(item.rdv.leadId)

  // Pour chaque commercial, l'ensemble des secteurs où il a au moins un RDV.
  // Sert à n'afficher dans le filtre commerciaux que ceux présents dans le(s)
  // secteur(s) sélectionné(s).
  const commercialSectors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const item of calendarItems) {
      const cid = commercialOf(item)
      if (!cid) continue
      const sector = sectorForItem(item, leadForItem(item))
      const set = m.get(cid) ?? new Set<string>()
      set.add(sector)
      m.set(cid, set)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarItems, leadMap, leadByExternalId])

  // Commerciaux proposés dans le filtre : si des secteurs sont sélectionnés, on
  // ne garde que ceux ayant au moins un RDV dans un de ces secteurs.
  const availableCommercials = useMemo(() => {
    if (selectedSectors.size === 0) return commercials
    return commercials.filter((c) => {
      const sectors = commercialSectors.get(c.id)
      if (!sectors) return false
      for (const s of sectors) if (selectedSectors.has(s)) return true
      return false
    })
  }, [commercials, commercialSectors, selectedSectors])

  // Quand le secteur change, on retire de la sélection les commerciaux qui
  // n'appartiennent plus au(x) secteur(s) affiché(s) (sinon filtre fantôme).
  useEffect(() => {
    setSelectedCommercials((prev) => {
      if (prev.size === 0) return prev
      const availableIds = new Set(availableCommercials.map((c) => c.id))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (availableIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [availableCommercials])

  const filterState = useMemo<CalendarFilterState>(
    () => ({ sectors: selectedSectors, commercials: selectedCommercials }),
    [selectedSectors, selectedCommercials],
  )
  const hasActiveFilter = selectedSectors.size > 0 || selectedCommercials.size > 0
  const visibleItems = useMemo(
    () => calendarItems.filter((item) => matchesCalendarFilters(sectorForItem(item, leadForItem(item)), commercialOf(item), filterState)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarItems, filterState, leadMap, leadByExternalId],
  )

  const visibleHours = useMemo(() => {
    const hours = new Set(DEFAULT_HOURS)
    for (const item of visibleItems) hours.add(reunionHour(item.scheduledAt))
    return [...hours].sort((a, b) => a - b)
  }, [visibleItems])

  const rdvByHourCell = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const item of visibleItems) {
      const key = `${reunionDayKey(item.scheduledAt)}:${reunionHour(item.scheduledAt)}`
      const list = m.get(key) ?? []
      list.push(item)
      list.sort(byCalendarItemAt)
      m.set(key, list)
    }
    return m
  }, [visibleItems])

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
    for (const item of visibleItems) {
      const key = reunionDayKey(item.scheduledAt)
      const list = m.get(key) ?? []
      list.push(item)
      list.sort(byCalendarItemAt)
      m.set(key, list)
    }
    return m
  }, [visibleItems])

  return (
    <AppShell>
      <Topbar
        eyebrow="RDV / AGENDA"
        title={period.label}
      />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center gap-1.5 sm:gap-3 flex-shrink-0 flex-wrap">
        <button onClick={() => setCursorDate((d) => moveDate(d, view, -1))} className="btn-secondary p-2 rounded-xl text-muted shrink-0" aria-label="Période précédente">
          <Icon name="chevron-down" size={14} className="rotate-90" />
        </button>
        <button onClick={() => setCursorDate(startOfReunionDay(new Date()))} className="btn-secondary px-3 sm:px-4 py-2 rounded-xl text-xs whitespace-nowrap">
          <span className="hidden xs:inline">Aujourd'hui</span><span className="xs:hidden">Auj.</span>
        </button>
        <button onClick={() => setCursorDate((d) => moveDate(d, view, 1))} className="btn-secondary p-2 rounded-xl text-muted shrink-0" aria-label="Période suivante">
          <Icon name="chevron-right" size={14} />
        </button>
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
        {view !== 'month' && (
          <div className="flex items-center bg-white border border-line rounded-xl shrink-0" title="Comprimer / aérer l'agenda (échelle verticale)">
            <button
              onClick={() => changeHourHeight(-1)}
              disabled={hourHeight <= HOUR_HEIGHT_LEVELS[0]}
              aria-label="Comprimer la grille"
              className="w-7 h-7 flex items-center justify-center text-base font-black text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
            >
              −
            </button>
            <span className="hidden xs:inline px-1 text-[10px] font-bold text-faint tabular-nums select-none">{hourHeight}px</span>
            <button
              onClick={() => changeHourHeight(1)}
              disabled={hourHeight >= HOUR_HEIGHT_LEVELS[HOUR_HEIGHT_LEVELS.length - 1]}
              aria-label="Aérer la grille"
              className="w-7 h-7 flex items-center justify-center text-base font-black text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
        )}
        {ghlLoading && <Spinner size={16} stroke={3} className="text-xs text-muted shrink-0" />}
        <button onClick={() => navigate('/rdv/split')} className="btn-primary ml-auto px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 shrink-0">
          <Icon name="plus" size={14} />
          <span className="hidden sm:inline">Nouveau RDV</span>
          <span className="sm:hidden">RDV</span>
        </button>
      </div>

      {/* Filtres : secteur (puces cliquables) + commercial (popover multi-sélection) */}
      <div className="px-4 sm:px-6 md:px-8 pt-2 flex items-center gap-2 sm:gap-3 flex-wrap text-[10px] sm:text-[11px] font-bold text-muted">
        <span className="uppercase tracking-wider text-faint">Secteurs :</span>
        {SECTORS.map((s) => {
          const active = selectedSectors.size === 0 || selectedSectors.has(s)
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selectedSectors.has(s)}
              onClick={() => setSelectedSectors((prev) => {
                const next = new Set(prev)
                if (next.has(s)) next.delete(s); else next.add(s)
                return next
              })}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition-opacity ${active ? 'bg-white border-line text-text' : 'bg-transparent border-line text-faint opacity-40'}`}
            >
              <span className={`w-2 h-2 rounded-full ${SECTOR_DOT[s]}`} />
              <span>{s}</span>
            </button>
          )
        })}

        {role !== 'commercial' && (
          <>
        <span className="uppercase tracking-wider text-faint ml-1 sm:ml-2">Commercial :</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setCommercialMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-white text-text"
          >
            <Icon name="users" size={12} />
            <span>Commerciaux{selectedCommercials.size > 0 ? ` · ${selectedCommercials.size}` : ''}</span>
            <Icon name="chevron-down" size={12} className={commercialMenuOpen ? 'rotate-180' : ''} />
          </button>
          {commercialMenuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setCommercialMenuOpen(false)} />
              <div className="absolute left-0 z-30 mt-1 min-w-[210px] max-h-64 overflow-auto bg-white border border-line rounded-xl shadow-lg p-1.5">
                {availableCommercials.length === 0 ? (
                  <p className="px-2 py-1.5 text-faint font-medium">
                    {selectedSectors.size > 0 ? 'Aucun commercial sur ce secteur' : 'Aucun commercial'}
                  </p>
                ) : (
                  availableCommercials.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-cream cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCommercials.has(c.id)}
                        onChange={() => setSelectedCommercials((prev) => {
                          const next = new Set(prev)
                          if (next.has(c.id)) next.delete(c.id); else next.add(c.id)
                          return next
                        })}
                      />
                      <span className="text-text font-semibold">{c.name}</span>
                    </label>
                  ))
                )}
                {selectedCommercials.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCommercials(new Set())}
                    className="w-full text-left px-2 py-1.5 mt-1 border-t border-line text-rouille hover:bg-cream rounded-b-lg"
                  >
                    Tout effacer
                  </button>
                )}
              </div>
            </>
          )}
        </div>
          </>
        )}

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSelectedSectors(new Set()); setSelectedCommercials(new Set()) }}
            className="text-or-dark underline underline-offset-2 hover:text-or"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {colorize && <CalendarColorLegend />}

      <main className="p-3 sm:p-6 md:p-8 pt-3 overflow-hidden flex-grow">
        <div
          className="glass-card !p-0 overflow-hidden h-full flex flex-col select-none"
          onWheel={handleHorizontalCalendarScroll}
          style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
        >
          {loading && !rdvs ? (
            <LoadingBlock label="Chargement de l’agenda…" />
          ) : error ? (
            <div className="flex-grow flex items-center justify-center text-rouille text-sm">Erreur : {error}</div>
          ) : view === 'month' ? (
            <MonthView
              days={period.days}
              cursorDate={cursorDate}
              rdvByDay={rdvByDay}
              leadMap={leadMap}
              leadByExternalId={leadByExternalId}
              onOpen={openCalendarItem}
              onOpenDay={(date) => { setCursorDate(date); setView('day') }}
            />
          ) : (
            <TimeGridView
              days={period.days}
              visibleHours={visibleHours}
              rdvByCell={rdvByHourCell}
              leadMap={leadMap}
              leadByExternalId={leadByExternalId}
              hourHeight={hourHeight}
              onOpen={openCalendarItem}
              onOpenDay={(date) => { setCursorDate(date); setView('day') }}
              onNeedMoreDays={() => setContinuousDays((days) => Math.min(days + 21, 365))}
            />
          )}
        </div>
      </main>
      {vtPopup && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-noir/40 backdrop-blur-sm px-4" onClick={(e) => e.target === e.currentTarget && setVtPopup(null)}>
          <div className="glass-card w-full max-w-sm p-0 shadow-2xl">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2">
              <div>
                <div className="eyebrow text-or-dark">{vtPopup.kind === 'installation' ? 'Installation' : 'Visite technique'}</div>
                <h3 className="font-black text-lg mt-0.5">{vtPopup.leadName}</h3>
              </div>
              <button onClick={() => setVtPopup(null)} className="rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Fermer">×</button>
            </div>
            <div className="px-5 py-4 space-y-1.5 text-sm text-muted">
              <div>📅 {vtPopup.date.split('-').reverse().join('/')}</div>
              {vtPopup.city && <div>📍 {vtPopup.city}</div>}
              {vtPopup.phone && <div>📞 {vtPopup.phone}</div>}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

type DayCell = { key: string; date: Date; dayNum: string; today: boolean; muted?: boolean }

function TimeGridView({
  days,
  visibleHours,
  rdvByCell,
  leadMap,
  leadByExternalId,
  hourHeight,
  onOpen,
  onOpenDay,
  onNeedMoreDays,
}: {
  days: DayCell[]
  visibleHours: number[]
  rdvByCell: Map<string, CalendarItem[]>
  leadMap: Map<string, LeadResponse>
  leadByExternalId: Map<string, LeadResponse>
  hourHeight: number
  onOpen: (item: CalendarItem) => void
  onOpenDay: (date: Date) => void
  onNeedMoreDays?: () => void
}) {
  const [openStack, setOpenStack] = useState<CalendarItem[] | null>(null)
  const isSingleDay = days.length === 1
  // En mode jour : 1 colonne pleine largeur (pas de scroll horizontal).
  // En mode semaine/continu : largeur fixe par jour, scroll horizontal.
  const minDayWidth = isSingleDay ? 'minmax(0, 1fr)' : 'minmax(140px, 1fr)'
  const gridColumns = `48px repeat(${days.length}, ${minDayWidth})`
  const minWidth = isSingleDay ? undefined : 48 + days.length * 160

  const itemsByDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>()
    for (const [key, list] of rdvByCell.entries()) {
      const dayKey = key.split(':')[0]
      const arr = m.get(dayKey) ?? []
      arr.push(...list)
      m.set(dayKey, arr)
    }
    for (const arr of m.values()) arr.sort(byCalendarItemAt)
    return m
  }, [rdvByCell])

  const handleNativeScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (onNeedMoreDays && el.scrollLeft + el.clientWidth > el.scrollWidth - 900) onNeedMoreDays()
  }

  const startHour = Math.min(...visibleHours)
  const endHour = Math.max(...visibleHours) + 1
  const totalHours = Math.max(1, endHour - startHour)
  const totalHeight = totalHours * hourHeight

  return (
    <div
      data-native-horizontal-scroll="true"
      onScroll={handleNativeScroll}
      className={`flex-grow overflow-y-auto bg-white/30 overscroll-contain ${isSingleDay ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
    >
      <div className="flex flex-col" style={{ minWidth }}>
        <div
          className="grid border-b border-line-soft flex-shrink-0 bg-white/95 backdrop-blur-md sticky top-0 z-10"
          style={{ gridTemplateColumns: gridColumns }}
        >
          <div />
          {days.map((d) => {
            const weekday = formatReunionDate(d.date, { weekday: 'short' }).replace('.', '')
            const weekdayCap = weekday.charAt(0).toUpperCase() + weekday.slice(1)
            return (
              <button
                key={d.key}
                onClick={() => onOpenDay(d.date)}
                className="px-2 py-2 sm:py-3 text-center hover:opacity-80 transition-opacity"
              >
                <div
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold ${
                    d.today ? 'bg-text text-white' : 'text-muted'
                  }`}
                >
                  <span>{d.dayNum}</span>
                  <span className="opacity-70">—</span>
                  <span>{weekdayCap}</span>
                </div>
              </button>
            )
          })}
        </div>

        <div
          className="grid relative"
          style={{ gridTemplateColumns: gridColumns, height: totalHeight }}
        >
          {/* Colonne des heures : épurée, pas de bordure, texte fin */}
          <div className="relative bg-transparent">
            {Array.from({ length: totalHours }).map((_, i) => (
              <div
                key={i}
                className="absolute right-2 text-[10px] sm:text-[11px] text-faint tabular-nums tracking-tight"
                style={{ top: i * hourHeight - 6 }}
              >
                {formatHour(startHour + i)}
              </div>
            ))}
          </div>

          {/* Colonnes des jours avec lignes horaires + blocs absolus */}
          {days.map((d) => {
            const list = itemsByDay.get(d.key) ?? []
            const positioned = layoutDayItems(list)
            const nowMarker = d.today && hourHeight >= 32 ? computeNowMarker(startHour, totalHours, hourHeight) : null
            return (
              <div
                key={d.key}
                className={`relative ${days.length > 1 ? 'border-l border-line-soft/70' : ''} ${d.today ? 'bg-cream/30' : ''}`}
              >
                {Array.from({ length: totalHours }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-line-soft/50"
                    style={{ top: i * hourHeight }}
                  />
                ))}
                {positioned.map((entry) => {
                  if (entry.kind === 'rdv') {
                    const { item, top, height, stackIndex, stackTotal } = entry
                    return (
                      <RdvBlock
                        key={`${item.source}-${item.id}`}
                        item={item}
                        lead={item.source === 'local' ? leadMap.get(item.rdv.leadId) : item.source === 'ghl' && item.event.contactId ? leadByExternalId.get(item.event.contactId) : undefined}
                        hourHeight={hourHeight}
                        stackIndex={stackIndex}
                        stackTotal={stackTotal}
                        onClick={() => onOpen(item)}
                        style={{ position: 'absolute', top, height, left: 3, right: 3, zIndex: 10 + stackIndex }}
                      />
                    )
                  }
                  const { items, top, height, stackIndex, hiddenCount } = entry
                  return (
                    <MoreStackButton
                      key={`more-${d.key}-${top}`}
                      count={hiddenCount}
                      total={items.length}
                      onClick={() => setOpenStack(items)}
                      style={{ position: 'absolute', top, height, left: 3, right: 3, zIndex: 10 + stackIndex }}
                    />
                  )
                })}
                {nowMarker && (
                  <>
                    <div
                      className="absolute left-0 right-0 border-t-2 border-text z-30"
                      style={{ top: nowMarker.topPx }}
                    />
                    <div
                      className="absolute z-30 px-2 py-0.5 rounded-full bg-text text-white text-[10px] font-black tabular-nums shadow-md"
                      style={{ top: nowMarker.topPx - 9, left: -4 }}
                    >
                      {nowMarker.label}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {openStack && (
        <StackPopup
          items={openStack}
          leadMap={leadMap}
          leadByExternalId={leadByExternalId}
          onPick={(it) => { setOpenStack(null); onOpen(it) }}
          onClose={() => setOpenStack(null)}
        />
      )}
    </div>
  )

  // Position chaque RDV (carte ou bouton "+N") en pixels (top, height).
  // Au-delà de STACK_VISIBLE_LIMIT, le surplus est groupé dans un marqueur
  // "more" cliquable qui ouvre un popup avec la liste complète.
  function layoutDayItems(items: CalendarItem[]): PositionedEntry[] {
    if (items.length === 0) return []
    type Slot = { startMin: number; endMin: number; item: CalendarItem }
    const slots: Slot[] = items.map((item) => {
      const hour = reunionHour(item.scheduledAt)
      const minute = reunionMinute(item.scheduledAt)
      const startMin = (hour - startHour) * 60 + minute
      const endMin = startMin + RDV_DURATION_MIN
      return { startMin, endMin, item }
    })
    slots.sort((a, b) => a.startMin - b.startMin)

    const groups: Slot[][] = []
    let current: Slot[] = []
    let currentEnd = -1
    for (const s of slots) {
      if (s.startMin >= currentEnd) {
        if (current.length) groups.push(current)
        current = [s]
        currentEnd = s.endMin
      } else {
        current.push(s)
        currentEnd = Math.max(currentEnd, s.endMin)
      }
    }
    if (current.length) groups.push(current)

    const result: PositionedEntry[] = []
    for (const group of groups) {
      if (group.length === 1) {
        const s = group[0]
        result.push({
          kind: 'rdv',
          item: s.item,
          top: (s.startMin / 60) * hourHeight,
          height: ((s.endMin - s.startMin) / 60) * hourHeight - 2,
          stackIndex: 0,
          stackTotal: 1,
        })
        continue
      }
      const baseStartMin = group[0].startMin
      const baseTop = (baseStartMin / 60) * hourHeight
      // Toute la pile reste cantonnée au créneau du PREMIER RDV (= 1h max).
      // → Le créneau de l'heure suivante n'est jamais couvert.
      const slotHeight = (RDV_DURATION_MIN / 60) * hourHeight - 2
      const hasMore = group.length > STACK_VISIBLE_LIMIT
      const cardHeight = hasMore ? Math.max(slotHeight - MORE_PILL_HEIGHT - MORE_PILL_GAP, 24) : slotHeight

      // Carte(s) visibles (STACK_VISIBLE_LIMIT) — par défaut 1 seule, hauteur réduite
      // pour laisser la place à la pilule "+N" dans le créneau.
      // On force stackTotal=1 côté affichage : pas de badge "1/N", pas d'effet
      // pile (la pilule "+N" suffit à indiquer qu'il y en a d'autres).
      const stackTotalShown = Math.min(group.length, STACK_VISIBLE_LIMIT)
      for (let i = 0; i < stackTotalShown; i++) {
        result.push({
          kind: 'rdv',
          item: group[i].item,
          top: baseTop,
          height: cardHeight,
          stackIndex: 0,
          stackTotal: 1,
        })
      }
      // Pilule "+N" en bas du créneau (ne déborde pas).
      if (hasMore) {
        result.push({
          kind: 'more',
          items: group.map((s) => s.item),
          top: baseTop + cardHeight + MORE_PILL_GAP,
          height: MORE_PILL_HEIGHT,
          stackIndex: STACK_VISIBLE_LIMIT,
          hiddenCount: group.length - STACK_VISIBLE_LIMIT,
        })
      }
    }
    return result
  }
}

type PositionedEntry =
  | { kind: 'rdv'; item: CalendarItem; top: number; height: number; stackIndex: number; stackTotal: number }
  | { kind: 'more'; items: CalendarItem[]; top: number; height: number; stackIndex: number; hiddenCount: number }

function CalendarColorLegend() {
  const items: Array<{ tone: string; label: string }> = [
    { tone: 'bg-success-tint', label: 'Débrief fait' },
    { tone: 'bg-white border border-line', label: 'À venir' },
    { tone: 'bg-cuivre-tint', label: 'Devis en attente' },
    { tone: 'bg-rouille-tint', label: 'Pas de débrief' },
  ]
  return (
    <div className="px-4 sm:px-6 md:px-8 pt-2 flex items-center gap-3 flex-wrap text-[10px] sm:text-[11px] font-bold text-muted">
      <span className="uppercase tracking-wider text-faint">Légende :</span>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded ${it.tone}`} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

function RdvBlock({ item, lead, hourHeight, stackIndex, stackTotal, onClick, style }: { item: CalendarItem; lead?: LeadResponse; hourHeight: number; stackIndex: number; stackTotal: number; onClick: () => void; style?: CSSProperties }) {
  const isVt = item.source === 'vt'
  const isGhl = item.source === 'ghl'
  const label = isVt
    ? `${vtKindLabel(item.vt)} — ${item.vt.leadName}`
    : isGhl
      ? ghlEventLabel(item.event)
      : (lead ? fullName(lead) : localRdvFallbackLabel(item.rdv))
  const detail = isVt
    ? [item.vt.city, item.vt.phone].filter(Boolean).join(' · ')
    : isGhl ? ghlEventDetail(item.event) : localRdvFallbackDetail(item.rdv)
  const sector = sectorForItem(item, lead)
  const role = useAuth((s) => s.user?.role)
  const colorize = role === 'admin' || role === 'commercial_lead'
  const tone = rdvCardTone(item, colorize)
  const startTime = formatTime(item.scheduledAt)
  const endTime = formatTime(new Date(new Date(item.scheduledAt).getTime() + RDV_DURATION_MIN * 60_000).toISOString())
  const title = `${startTime}–${endTime} — ${sector} — ${label}${detail ? ` — ${detail}` : ''}${isGhl ? ' — GHL temps réel' : ''}${isVt ? ` — ${vtKindLabel(item.vt)}` : ''}`

  // Adaptation densité : à <40px on n'affiche que la ligne titre
  const compact = hourHeight < 40
  const statusLabel = isVt ? 'VT' : isGhl ? 'GHL' : item.source === 'local' ? (STATUS_BADGE_LABEL[item.rdv.status] ?? null) : null
  const badgeTone = NEUTRAL_BADGE_TONE

  // Empilement type "deck" : chaque carte décalée de 22px (header visible)
  // pour que les 5 cartes du paquet soient toutes lisibles d'un coup d'œil.
  // Au hover : la carte remonte de 24px → se détache nettement du paquet.
  const stacked = stackTotal > 1
  const stackOffset = stacked ? stackIndex * 22 : 0
  const stackedStyle: CSSProperties = {
    ...style,
    ['--stack-offset' as string]: `${stackOffset}px`,
  }

  return (
    <button
      onClick={onClick}
      title={title}
      data-stack-index={stackIndex}
      style={stackedStyle}
      className={`rdv-card group ${tone} overflow-hidden text-left rounded-lg border shadow-sm cursor-pointer ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'} ${stacked ? 'rdv-card--stacked' : ''}`}
    >
      <div className={`flex items-start justify-between gap-1 ${compact ? '' : 'mb-0.5'}`}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${SECTOR_DOT[sector]}`} />
          <div className="font-bold text-[11px] sm:text-[12px] leading-tight truncate">{label}</div>
        </div>
        {stacked && (
          <span className="shrink-0 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-white/80 text-text text-[8px] font-black tabular-nums">{stackIndex + 1}/{stackTotal}</span>
        )}
      </div>
      {!compact && (
        <div className="flex items-center gap-2 text-[10px] leading-tight">
          <span className="tabular-nums opacity-80">{startTime}–{endTime}</span>
          {statusLabel && (
            <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[8px] font-bold ${badgeTone}`}>
              {statusLabel}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Pilule "+N" pour piles > limite visible ────────────────
function MoreStackButton({ count, total, onClick, style }: { count: number; total: number; onClick: () => void; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      title={`Voir les ${total} RDV de ce créneau`}
      style={style}
      className="bg-text/90 hover:bg-text text-white border border-text/60 rounded-md shadow-sm cursor-pointer flex items-center justify-center gap-1 text-[10px] font-black tabular-nums leading-none transition-colors"
    >
      +{count} <span className="opacity-70 font-bold">{count > 1 ? 'autres' : 'autre'}</span>
    </button>
  )
}

// ─── Popup liste RDV (déclenché par "+N") ───────────────────
function StackPopup({
  items,
  leadMap,
  leadByExternalId,
  onPick,
  onClose,
}: {
  items: CalendarItem[]
  leadMap: Map<string, LeadResponse>
  leadByExternalId: Map<string, LeadResponse>
  onPick: (item: CalendarItem) => void
  onClose: () => void
}) {
  // Tri chronologique pour la liste
  const sorted = [...items].sort(byCalendarItemAt)
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-noir/40 backdrop-blur-sm px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-card w-full max-w-md max-h-[80vh] flex flex-col p-0 shadow-2xl">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-2">
          <div>
            <div className="eyebrow text-or-dark">Créneau chargé</div>
            <h3 className="font-black text-lg mt-0.5">{sorted.length} rendez-vous</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Fermer">×</button>
        </div>
        <ul className="overflow-y-auto divide-y divide-line-soft">
          {sorted.map((item) => {
            const isVt = item.source === 'vt'
            const isGhl = item.source === 'ghl'
            const lead = isGhl
              ? (item.event.contactId ? leadByExternalId.get(item.event.contactId) : undefined)
              : isVt ? undefined : leadMap.get(item.rdv.leadId)
            const name = isVt
              ? `${vtKindLabel(item.vt)} — ${item.vt.leadName}`
              : isGhl ? ghlEventLabel(item.event) : (lead ? fullName(lead) : localRdvFallbackLabel(item.rdv))
            const detail = isVt
              ? [item.vt.city, item.vt.phone].filter(Boolean).join(' · ')
              : isGhl ? ghlEventDetail(item.event) : localRdvFallbackDetail(item.rdv)
            const sector = sectorForItem(item, lead)
            const startTime = formatTime(item.scheduledAt)
            const endTime = formatTime(new Date(new Date(item.scheduledAt).getTime() + RDV_DURATION_MIN * 60_000).toISOString())
            return (
              <li key={`${item.source}-${item.id}`}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="w-full text-left px-5 py-3 hover:bg-cream/60 transition-colors flex items-start gap-3"
                >
                  <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${SECTOR_DOT[sector]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-bold truncate">{name}</div>
                      <div className="text-[11px] text-muted tabular-nums shrink-0">{startTime}–{endTime}</div>
                    </div>
                    {detail && <div className="text-[11px] text-muted truncate mt-0.5">{detail}</div>}
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px]">
                      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-bold ${CARD_TONE}`}>{sector}</span>
                      {isGhl && <span className="text-faint">GHL</span>}
                      {isVt && <span className="text-faint">{vtKindLabel(item.vt)}</span>}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function MonthView({
  days,
  cursorDate,
  rdvByDay,
  leadMap,
  leadByExternalId,
  onOpen,
  onOpenDay,
}: {
  days: DayCell[]
  cursorDate: Date
  rdvByDay: Map<string, CalendarItem[]>
  leadMap: Map<string, LeadResponse>
  leadByExternalId: Map<string, LeadResponse>
  onOpen: (item: CalendarItem) => void
  onOpenDay: (date: Date) => void
}) {
  return (
    <div className="flex-grow grid grid-rows-[auto_1fr] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line-soft bg-white/70">
        {DAY_LABELS.map((label) => (
          <div key={label} className="px-1 py-2 sm:p-3 text-center eyebrow text-[9px] sm:text-[10px] border-l first:border-l-0 border-line-soft">{label}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 overflow-y-auto">
        {days.map((d) => {
          const list = rdvByDay.get(d.key) ?? []
          const muted = !isSameReunionMonth(d.date, cursorDate)
          return (
            <div key={d.key} className={`min-h-0 border-l border-t border-line-soft p-1 sm:p-2 flex flex-col ${muted ? 'bg-white/30 text-faint' : 'bg-white/55'} ${d.today ? 'ring-2 ring-cuivre ring-inset' : ''}`}>
              <button onClick={() => onOpenDay(d.date)} className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full text-xs sm:text-sm font-bold flex items-center justify-center hover:bg-or-tint ${d.today ? 'bg-cuivre text-white hover:bg-cuivre' : ''}`}>
                {d.dayNum}
              </button>
              <div className="mt-1 space-y-0.5 sm:space-y-1 overflow-hidden">
                <div className="block sm:hidden">
                  {list.length > 0 && (
                    <button onClick={() => onOpenDay(d.date)} className="text-[10px] font-bold text-cuivre">
                      ● {list.length}
                    </button>
                  )}
                </div>
                <div className="hidden sm:block space-y-1">
                  {list.slice(0, 3).map((item) => (
                    <RdvButton
                      key={`${item.source}-${item.id}`}
                      item={item}
                      lead={item.source === 'local' ? leadMap.get(item.rdv.leadId) : item.source === 'ghl' && item.event.contactId ? leadByExternalId.get(item.event.contactId) : undefined}
                      compact
                      onClick={() => onOpen(item)}
                    />
                  ))}
                  {list.length > 3 && (
                    <button onClick={() => onOpenDay(d.date)} className="text-[11px] font-semibold text-muted hover:text-or">+{list.length - 3} autres</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RdvButton({ item, lead, compact = false, onClick }: { item: CalendarItem; lead?: LeadResponse; compact?: boolean; onClick: () => void }) {
  const isVt = item.source === 'vt'
  const isGhl = item.source === 'ghl'
  const label = isVt
    ? `${vtKindLabel(item.vt)} — ${item.vt.leadName}`
    : isGhl ? ghlEventLabel(item.event) : (lead ? fullName(lead) : localRdvFallbackLabel(item.rdv))
  const detail = isVt
    ? [item.vt.city, item.vt.phone].filter(Boolean).join(' · ')
    : isGhl ? ghlEventDetail(item.event) : localRdvFallbackDetail(item.rdv)
  const sector = sectorForItem(item, lead)
  const role = useAuth((s) => s.user?.role)
  const colorize = role === 'admin' || role === 'commercial_lead'
  const tone = rdvCardTone(item, colorize)
  const title = `${formatTime(item.scheduledAt)} — ${sector} — ${label}${detail ? ` — ${detail}` : ''}${isGhl ? ' — GHL temps réel' : ''}${isVt ? ` — ${vtKindLabel(item.vt)}` : ''}`
  return (
    <button
      onClick={onClick}
      className={`rdv-block ${tone} w-full h-full min-h-10 overflow-hidden text-left font-semibold rounded-lg transition-transform cursor-pointer hover:scale-[1.01] ${compact ? 'text-[11px] px-2 py-1 truncate' : 'text-[10px] px-2 py-1.5'}`}
      title={title}
    >
      <span className="block truncate">{formatTime(item.scheduledAt)} — {label}</span>
      {!compact && detail && <span className="block text-[9px] opacity-75 truncate">{detail}</span>}
      {!compact && isGhl && <span className="block text-[9px] opacity-75 truncate">GHL live{item.event.sector ? ` · ${item.event.sector}` : ''}</span>}
      {!compact && isVt && <span className="block text-[9px] opacity-75 truncate">{vtKindLabel(item.vt)}</span>}
    </button>
  )
}

function ghlEventLabel(event: GhlCalendarEvent): string {
  return event.contactName || event.title || `RDV GHL ${event.sector ?? ''}`.trim() || 'RDV GHL'
}

function ghlEventDetail(event: GhlCalendarEvent): string {
  return [event.contactPhone, event.contactCity, event.contactEmail].filter(Boolean).join(' · ')
}

// Une entrée "vt" du calendrier peut être une visite technique OU une installation
// (pose) — distinguées par `kind`. Label + ton couleur dédiés (cuivre = installation).
function vtKindLabel(vt: VtCalendarEntry): string {
  return vt.kind === 'installation' ? 'Installation' : 'VT'
}
function vtKindTone(vt: VtCalendarEntry): string {
  return vt.kind === 'installation'
    ? 'bg-cuivre-tint text-text border-cuivre'
    : 'bg-info-tint text-text border-info'
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
    const from = startOfReunionDay(cursorDate)
    const to = endOfReunionDay(cursorDate)
    return {
      from,
      to,
      days: [toDayCell(from)],
      label: formatReunionDate(from, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
    }
  }

  if (view === 'month') {
    const cursor = reunionParts(cursorDate)
    const firstOfMonth = reunionDate(cursor.year, cursor.month, 1)
    const lastOfMonth = reunionDate(cursor.year, cursor.month + 1, 0)
    const gridStart = startOfReunionWeek(firstOfMonth)
    const gridEnd = new Date(gridStart)
    gridEnd.setTime(addReunionDays(gridStart, 41).getTime())
    gridEnd.setUTCHours(gridEnd.getUTCHours() + 23, 59, 59, 999)

    const days: DayCell[] = []
    for (let i = 0; i < 42; i++) {
      const d = addReunionDays(gridStart, i)
      days.push({ ...toDayCell(d), muted: d < firstOfMonth || d > lastOfMonth })
    }

    return {
      from: gridStart,
      to: gridEnd,
      days,
      label: formatReunionDate(cursorDate, { month: 'long', year: 'numeric' }),
    }
  }

  const from = startOfReunionWeek(cursorDate)
  const to = new Date(from)
  const safeDays = Math.max(14, Math.min(continuousDays, 365))
  to.setTime(endOfReunionDay(addReunionDays(from, safeDays - 1)).getTime())
  const days: DayCell[] = []
  for (let i = 0; i < safeDays; i++) {
    const d = addReunionDays(from, i)
    days.push(toDayCell(d))
  }

  const opt: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }
  return {
    from,
    to,
    days,
    label: `Agenda continu · ${formatReunionDate(from, opt)} → ${formatReunionDate(to, opt)}`,
  }
}

function moveDate(date: Date, view: CalendarView, direction: -1 | 1, unit?: 'day'): Date {
  if (unit === 'day' || view === 'day') return addReunionDays(date, direction)
  if (view === 'week') return addReunionDays(date, direction * 7)
  return addReunionMonths(date, direction)
}

function toDayCell(date: Date): DayCell {
  const d = startOfReunionDay(date)
  const parts = reunionParts(d)
  return {
    key: reunionDayKey(d),
    date: d,
    dayNum: String(parts.day).padStart(2, '0'),
    today: isSameReunionDay(d, new Date()),
  }
}

function startOfReunionDay(date: Date): Date {
  const p = reunionParts(date)
  return reunionDate(p.year, p.month, p.day)
}

function endOfReunionDay(date: Date): Date {
  const start = startOfReunionDay(date)
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
}

function startOfReunionWeek(date: Date): Date {
  const p = reunionParts(date)
  const dow = reunionWeekday(p.year, p.month, p.day) || 7
  return reunionDate(p.year, p.month, p.day - (dow - 1))
}

function addReunionDays(date: Date, days: number): Date {
  const p = reunionParts(date)
  return reunionDate(p.year, p.month, p.day + days)
}

function addReunionMonths(date: Date, months: number): Date {
  const p = reunionParts(date)
  return reunionDate(p.year, p.month + months, 1)
}

function reunionDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - REUNION_OFFSET_MS)
}

function reunionParts(date: Date | string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REUNION_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(date))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  return { year: get('year'), month: get('month'), day: get('day') }
}

function reunionDayKey(date: Date | string): string {
  const p = reunionParts(date)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function reunionHour(date: Date | string): number {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: REUNION_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(date))
  return Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
}

function reunionMinute(date: Date | string): number {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: REUNION_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(date))
  return Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
}

function reunionWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
}

function isSameReunionDay(a: Date, b: Date): boolean {
  return reunionDayKey(a) === reunionDayKey(b)
}

function isSameReunionMonth(a: Date, b: Date): boolean {
  const pa = reunionParts(a)
  const pb = reunionParts(b)
  return pa.year === pb.year && pa.month === pb.month
}

function formatReunionDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString('fr-FR', { ...options, timeZone: REUNION_TZ })
}

function byCalendarItemAt(a: CalendarItem, b: CalendarItem): number {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: REUNION_TZ })
}

// Indicateur "maintenant" : retourne la position px verticale dans la colonne du jour
// + le label horaire à afficher dans la pilule sombre. Null si hors de la fenêtre visible.
function computeNowMarker(startHour: number, totalHours: number, hourHeightPx: number): { topPx: number; label: string } | null {
  const now = new Date()
  const hour = reunionHour(now)
  const minute = reunionMinute(now)
  const offsetMin = (hour - startHour) * 60 + minute
  if (offsetMin < 0 || offsetMin > totalHours * 60) return null
  return {
    topPx: (offsetMin / 60) * hourHeightPx,
    label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}


