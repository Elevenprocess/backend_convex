import type { LeadResponse, LeadStatus } from './types'

export type LeadStatusFilter = 'all' | LeadStatus
export type LeadLastCallFilter = 'all' | 'never' | 'today' | 'older_3d' | 'older_7d'
export type LeadArrivedAtFilter =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
export type LeadHasFilter = 'all' | 'with' | 'without'
export type LeadDateField = 'arrival' | 'devis' | 'debrief' | 'call'

export type LeadListFilters = {
  onlyNew: boolean
  status: LeadStatusFilter
  lastCall: LeadLastCallFilter
  arrivedAt: LeadArrivedAtFilter
  hasDevis: LeadHasFilter
  hasDebrief: LeadHasFilter
  dateField: LeadDateField
}

export const DEFAULT_LEAD_FILTERS: LeadListFilters = {
  onlyNew: false,
  status: 'all',
  lastCall: 'all',
  arrivedAt: 'all',
  hasDevis: 'all',
  hasDebrief: 'all',
  dateField: 'arrival',
}

// Matche la vraie date d'arrivée SaaS (createdAt) sur le jour Réunion (UTC+4, pas de DST).
// Ne PAS utiliser updatedAt ici : les sync/backfills GHL mettent à jour beaucoup
// de leads historiques en masse, ce qui faisait gonfler "Aujourd'hui" à 1796.
// Formatters mis en cache au niveau module : créer un Intl.DateTimeFormat coûte
// très cher, et ces fonctions tournent en O(leads × filtres) dans les compteurs
// du rail — les instancier par appel gelait la page Leads plusieurs secondes
// (~des centaines de milliers de créations pendant le chargement complet).
const REUNION_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Indian/Reunion',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const REUNION_WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Indian/Reunion',
  weekday: 'short',
})
function reunionDayKey(date: Date): string {
  return REUNION_DAY_FORMAT.format(date)
}

type DateSource = Pick<
  LeadResponse,
  'createdAt' | 'arrivalAt' | 'latestDevisAt' | 'latestDebriefAt' | 'latestCallAt'
>

function leadDateForField(lead: DateSource, field: LeadDateField): string | null {
  if (field === 'devis') return lead.latestDevisAt ?? null
  if (field === 'debrief') return lead.latestDebriefAt ?? null
  if (field === 'call') return lead.latestCallAt ?? null
  return lead.arrivalAt || lead.createdAt
}

export function matchesLeadDateRange(
  lead: DateSource,
  range: LeadArrivedAtFilter,
  field: LeadDateField = 'arrival',
): boolean {
  if (range === 'all') return true
  const iso = leadDateForField(lead, field)
  if (!iso) return false
  const now = new Date()
  const todayKey = reunionDayKey(now)
  const dKey = reunionDayKey(new Date(iso))
  if (range === 'today') return dKey === todayKey
  if (range === 'yesterday') {
    const yKey = reunionDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
    return dKey === yKey
  }
  // Lundi 00:00 Réunion en clé YYYY-MM-DD. Day-of-week selon TZ Réunion.
  const reunionWeekday = REUNION_WEEKDAY_FORMAT.format(now)
  const dayOffset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[reunionWeekday as 'Mon'] ?? 0
  if (range === 'this_week') {
    const monday = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000)
    return dKey >= reunionDayKey(monday)
  }
  if (range === 'last_week') {
    const thisMonday = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000)
    const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000)
    const lastMondayKey = reunionDayKey(lastMonday)
    const thisMondayKey = reunionDayKey(thisMonday)
    return dKey >= lastMondayKey && dKey < thisMondayKey
  }
  // Pour this_month / last_month on compare sur YYYY-MM en TZ Réunion.
  const ymKey = (d: Date) => reunionDayKey(d).slice(0, 7)
  const currentYm = ymKey(now)
  if (range === 'this_month') return dKey.slice(0, 7) === currentYm
  if (range === 'last_month') {
    const prev = new Date(now)
    prev.setUTCMonth(prev.getUTCMonth() - 1)
    return dKey.slice(0, 7) === ymKey(prev)
  }
  return true
}

function leadMatchesStatus(lead: Pick<LeadResponse, 'status'>, status: LeadStatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'qualifie') return lead.status === 'qualifie' || lead.status === 'rdv_pris'
  if (status === 'pas_qualifie') return lead.status === 'pas_qualifie' || lead.status === 'perdu'
  return lead.status === status
}

function matchesHas(value: boolean | undefined, filter: LeadHasFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'with') return value === true
  return value !== true
}

export function applyLeadFilters<
  T extends Pick<
    LeadResponse,
    | 'status'
    | 'joursSansContact'
    | 'createdAt'
    | 'arrivalAt'
    | 'latestDevisAt'
    | 'latestDebriefAt'
    | 'latestCallAt'
    | 'hasDevis'
    | 'hasDebrief'
  >,
>(leads: T[], filters: LeadListFilters): T[] {
  return leads.filter((lead) => {
    if (filters.onlyNew && lead.status !== 'nouveau') return false
    if (!leadMatchesStatus(lead, filters.status)) return false
    if (filters.lastCall === 'never' && lead.joursSansContact !== null) return false
    if (filters.lastCall === 'today' && lead.joursSansContact !== 0) return false
    if (filters.lastCall === 'older_3d' && (lead.joursSansContact === null || lead.joursSansContact < 3)) return false
    if (filters.lastCall === 'older_7d' && (lead.joursSansContact === null || lead.joursSansContact < 7)) return false
    if (!matchesHas(lead.hasDevis, filters.hasDevis)) return false
    if (!matchesHas(lead.hasDebrief, filters.hasDebrief)) return false
    if (!matchesLeadDateRange(lead, filters.arrivedAt, filters.dateField)) return false
    return true
  })
}

// Tri de la liste "À rappeler" :
//   1. les rappels futurs en premier, du plus proche au plus loin
//   2. puis les rappels en retard (date déjà passée), du plus récemment dépassé au plus ancien
//   3. enfin ceux sans date de rappel programmée (conserve l'ordre d'origine — tri stable)
export function sortCallbackLeadsByNextCallback<T extends Pick<LeadResponse, 'nextCallbackAt'>>(
  leads: T[],
  now: number = Date.now(),
): T[] {
  const rank = (lead: T): number => {
    if (!lead.nextCallbackAt) return 2
    return new Date(lead.nextCallbackAt).getTime() >= now ? 0 : 1
  }
  return [...leads].sort((a, b) => {
    const rankA = rank(a)
    const rankB = rank(b)
    if (rankA !== rankB) return rankA - rankB
    if (rankA === 2) return 0 // pas de date : on garde l'ordre d'origine
    const tA = new Date(a.nextCallbackAt as string).getTime()
    const tB = new Date(b.nextCallbackAt as string).getTime()
    // futurs : ascendant (plus proche d'abord) ; en retard : descendant (plus récent d'abord)
    return rankA === 0 ? tA - tB : tB - tA
  })
}

export function leadFiltersActive(filters: LeadListFilters): boolean {
  return (
    filters.onlyNew ||
    filters.status !== 'all' ||
    filters.lastCall !== 'all' ||
    filters.arrivedAt !== 'all' ||
    filters.hasDevis !== 'all' ||
    filters.hasDebrief !== 'all'
  )
}
