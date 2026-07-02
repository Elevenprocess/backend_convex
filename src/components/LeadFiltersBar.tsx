import type { LeadStatus } from '../lib/types'
import { STATUS_LABEL } from '../lib/types'
import type { LeadListFilters, LeadLastCallFilter } from '../lib/leadFilters'
import { DEFAULT_LEAD_FILTERS, leadFiltersActive } from '../lib/leadFilters'

const STATUS_OPTIONS: Array<LeadStatus | 'all'> = [
  'all',
  'nouveau',
  'qualifie',
  'a_rappeler',
  'pas_de_reponse',
  'pas_qualifie',
  'rdv_honore',
  'signe',
  'perdu',
  'relance',
]

const LAST_CALL_OPTIONS: Array<{ value: LeadLastCallFilter; label: string }> = [
  { value: 'all', label: 'Dernier appel : tous' },
  { value: 'never', label: 'Jamais appelé' },
  { value: 'today', label: "Appelé aujourd'hui" },
  { value: 'older_3d', label: 'Sans appel ≥ 3j' },
  { value: 'older_7d', label: 'Sans appel ≥ 7j' },
]

export function LeadFiltersBar({
  filters,
  onChange,
  total,
  filtered,
  className = '',
}: {
  filters: LeadListFilters
  onChange: (filters: LeadListFilters) => void
  total?: number
  filtered?: number
  className?: string
}) {
  const active = leadFiltersActive(filters)
  const update = (patch: Partial<LeadListFilters>) => onChange({ ...filters, ...patch })

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <button
        type="button"
        onClick={() => update({ onlyNew: !filters.onlyNew })}
        className={`pill-tab ${filters.onlyNew ? '!bg-info !text-white' : 'bg-white border border-line text-muted'}`}
      >
        Nouveaux prospects
      </button>
      <select
        value={filters.status}
        onChange={(e) => update({ status: e.target.value as LeadListFilters['status'] })}
        className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm"
      >
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>{status === 'all' ? 'Tous les statuts' : STATUS_LABEL[status]}</option>
        ))}
      </select>
      <select
        value={filters.lastCall}
        onChange={(e) => update({ lastCall: e.target.value as LeadLastCallFilter })}
        className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm"
      >
        {LAST_CALL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {typeof total === 'number' && typeof filtered === 'number' && (
        <span className="text-xs text-faint font-semibold">{filtered}/{total}</span>
      )}
      {active && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_LEAD_FILTERS)}
          className="text-xs font-bold text-muted underline underline-offset-4"
        >
          Réinitialiser
        </button>
      )}
    </div>
  )
}
