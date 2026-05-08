import type { LeadResponse, LeadStatus } from './types'

export type LeadStatusFilter = 'all' | LeadStatus
export type LeadLastCallFilter = 'all' | 'never' | 'today' | 'older_3d' | 'older_7d'

export type LeadListFilters = {
  onlyNew: boolean
  status: LeadStatusFilter
  lastCall: LeadLastCallFilter
}

export const DEFAULT_LEAD_FILTERS: LeadListFilters = {
  onlyNew: false,
  status: 'all',
  lastCall: 'all',
}

export function applyLeadFilters<T extends Pick<LeadResponse, 'status' | 'joursSansContact'>>(
  leads: T[],
  filters: LeadListFilters,
): T[] {
  return leads.filter((lead) => {
    if (filters.onlyNew && lead.status !== 'nouveau') return false
    if (filters.status !== 'all' && lead.status !== filters.status) return false
    if (filters.lastCall === 'never' && lead.joursSansContact !== null) return false
    if (filters.lastCall === 'today' && lead.joursSansContact !== 0) return false
    if (filters.lastCall === 'older_3d' && (lead.joursSansContact === null || lead.joursSansContact < 3)) return false
    if (filters.lastCall === 'older_7d' && (lead.joursSansContact === null || lead.joursSansContact < 7)) return false
    return true
  })
}

export function leadFiltersActive(filters: LeadListFilters): boolean {
  return filters.onlyNew || filters.status !== 'all' || filters.lastCall !== 'all'
}
