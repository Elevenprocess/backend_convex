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

// Matche createdAt OU updatedAt sur le jour Réunion (UTC+4, pas de DST).
function reunionDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Reunion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function leadInArrivedRange(
  lead: Pick<LeadResponse, 'createdAt' | 'updatedAt'>,
  range: LeadArrivedAtFilter,
): boolean {
  if (range === 'all') return true
  const now = new Date()
  const todayKey = reunionDayKey(now)
  const createdKey = reunionDayKey(new Date(lead.createdAt))
  const updatedKey = reunionDayKey(new Date(lead.updatedAt))
  if (range === 'today') return createdKey === todayKey || updatedKey === todayKey
  if (range === 'yesterday') {
    const yKey = reunionDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
    return createdKey === yKey || updatedKey === yKey
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
    return createdKey >= mondayKey || updatedKey >= mondayKey
  }
  return true
}

export function applyLeadFilters<
  T extends Pick<LeadResponse, 'status' | 'joursSansContact' | 'createdAt' | 'updatedAt'>,
>(leads: T[], filters: LeadListFilters): T[] {
  return leads.filter((lead) => {
    if (filters.onlyNew && lead.status !== 'nouveau') return false
    if (filters.status !== 'all' && lead.status !== filters.status) return false
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
