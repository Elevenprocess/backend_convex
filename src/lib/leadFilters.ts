import type { LeadResponse, LeadStatus } from './types'

export type LeadStatusFilter = 'all' | LeadStatus
export type LeadLastCallFilter = 'all' | 'never' | 'today' | 'older_3d' | 'older_7d'
export type LeadArrivedAtFilter = 'all' | 'today' | 'yesterday' | 'this_week'

export type LeadListFilters = {
  onlyNew: boolean
  status: LeadStatusFilter
  lastCall: LeadLastCallFilter
  arrivedAt: LeadArrivedAtFilter
}

export const DEFAULT_LEAD_FILTERS: LeadListFilters = {
  onlyNew: false,
  status: 'all',
  lastCall: 'all',
  arrivedAt: 'all',
}

// Matche la vraie date d'arrivée SaaS (createdAt) sur le jour Réunion (UTC+4, pas de DST).
// Ne PAS utiliser updatedAt ici : les sync/backfills GHL mettent à jour beaucoup
// de leads historiques en masse, ce qui faisait gonfler "Aujourd'hui" à 1796.
function reunionDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Reunion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function leadArrivalDate(lead: Pick<LeadResponse, 'createdAt' | 'arrivalAt'>): string {
  return lead.arrivalAt || lead.createdAt
}

function leadInArrivedRange(
  lead: Pick<LeadResponse, 'createdAt' | 'arrivalAt'>,
  range: LeadArrivedAtFilter,
): boolean {
  if (range === 'all') return true
  const now = new Date()
  const todayKey = reunionDayKey(now)
  const createdKey = reunionDayKey(new Date(leadArrivalDate(lead)))
  if (range === 'today') return createdKey === todayKey
  if (range === 'yesterday') {
    const yKey = reunionDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
    return createdKey === yKey
  }
  if (range === 'this_week') {
    // Lundi 00:00 Réunion en clé YYYY-MM-DD. Day-of-week selon TZ Réunion.
    const reunionWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Indian/Reunion',
      weekday: 'short',
    }).format(now)
    const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[reunionWeekday as 'Mon'] ?? 0
    const monday = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)
    const mondayKey = reunionDayKey(monday)
    return createdKey >= mondayKey
  }
  return true
}

function leadMatchesStatus(lead: Pick<LeadResponse, 'status'>, status: LeadStatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'qualifie') return lead.status === 'qualifie' || lead.status === 'rdv_pris'
  if (status === 'pas_qualifie') return lead.status === 'pas_qualifie' || lead.status === 'perdu'
  return lead.status === status
}

export function applyLeadFilters<
  T extends Pick<LeadResponse, 'status' | 'joursSansContact' | 'createdAt' | 'arrivalAt'>,
>(leads: T[], filters: LeadListFilters): T[] {
  return leads.filter((lead) => {
    if (filters.onlyNew && lead.status !== 'nouveau') return false
    if (!leadMatchesStatus(lead, filters.status)) return false
    if (filters.lastCall === 'never' && lead.joursSansContact !== null) return false
    if (filters.lastCall === 'today' && lead.joursSansContact !== 0) return false
    if (filters.lastCall === 'older_3d' && (lead.joursSansContact === null || lead.joursSansContact < 3)) return false
    if (filters.lastCall === 'older_7d' && (lead.joursSansContact === null || lead.joursSansContact < 7)) return false
    if (!leadInArrivedRange(lead, filters.arrivedAt)) return false
    return true
  })
}

export function leadFiltersActive(filters: LeadListFilters): boolean {
  return (
    filters.onlyNew ||
    filters.status !== 'all' ||
    filters.lastCall !== 'all' ||
    filters.arrivedAt !== 'all'
  )
}
