import { useMemo, useState } from 'react'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { SplitPanel } from '../../components/SplitPanel'
import { LeadFiltersBar } from '../../components/LeadFiltersBar'
import { LoadingBlock } from '../../components/Spinner'
import { useRdvList, useLeads, useUsers } from '../../lib/hooks'
import { DEFAULT_LEAD_FILTERS, applyLeadFilters, type LeadListFilters } from '../../lib/leadFilters'
import {
  fullName,
  type LeadResponse,
  type UserResponse,
  type RdvStatus,
} from '../../lib/types'

const STATUS_LABEL: Record<RdvStatus, string> = {
  planifie: 'à venir',
  honore: 'honoré',
  no_show: 'no-show',
  reporte: 'reporté',
  annule: 'annulé',
}

const STATUS_BADGE: Record<RdvStatus, string> = {
  planifie: 'bg-cuivre-tint text-cuivre',
  honore: 'bg-success-tint text-success',
  no_show: 'bg-rouille-tint text-rouille',
  reporte: 'bg-info-tint text-info',
  annule: 'bg-rouille-tint text-rouille',
}

export function RdvSplit() {
  const { data: rdvs, loading, error } = useRdvList({ limit: 50 })
  const { data: leads } = useLeads({ limit: 500 })
  const { data: users } = useUsers()
  const [selectedRdvId, setSelectedRdvId] = useState<string | null>(null)
  const [leadFilters, setLeadFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS)

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  const sortedRdvs = useMemo(() => {
    const allowedLeadIds = new Set(applyLeadFilters(leads ?? [], leadFilters).map((l) => l.id))
    return [...(rdvs ?? [])].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    ).filter((r) => allowedLeadIds.has(r.leadId))
  }, [rdvs, leads, leadFilters])

  const selectedRdv = useMemo(() => {
    if (!selectedRdvId) return sortedRdvs[0] ?? null
    return sortedRdvs.find((r) => r.id === selectedRdvId) ?? sortedRdvs[0] ?? null
  }, [sortedRdvs, selectedRdvId])

  const selectedLead = selectedRdv ? leadMap.get(selectedRdv.leadId) ?? null : null

  return (
    <AppShell>
      <Topbar
        eyebrow="RDV · SPLIT"
        title="Workflow inline"
      />
      <div className="flex flex-grow overflow-hidden">
        <main className="flex-grow p-6 overflow-y-auto min-w-0">
          {loading ? (
            <LoadingBlock label="Chargement des RDV…" />
          ) : error ? (
            <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
          ) : (
            <div className="glass-card !p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">RDV à venir</div>
                  <div className="text-xs text-muted">{sortedRdvs.length} RDV — sélectionne pour ouvrir le contexte lead</div>
                </div>
                <LeadFiltersBar filters={leadFilters} onChange={setLeadFilters} total={(leads ?? []).length} filtered={applyLeadFilters(leads ?? [], leadFilters).length} />
              </div>
              <div className="divide-y divide-line-soft">
                {sortedRdvs.length === 0 ? (
                  <div className="px-5 py-12 text-center text-faint text-sm">Aucun RDV programmé.</div>
                ) : sortedRdvs.map((rdv) => {
                  const lead = leadMap.get(rdv.leadId)
                  const commercial = rdv.commercialId ? userMap.get(rdv.commercialId) : undefined
                  const active = selectedRdv?.id === rdv.id
                  return (
                    <button
                      key={rdv.id}
                      onClick={() => setSelectedRdvId(rdv.id)}
                      className={`w-full px-5 py-4 text-left transition-colors flex items-center gap-4 ${
                        active ? 'bg-cuivre-tint/30' : 'hover:bg-white/50'
                      }`}
                    >
                      <div className="w-1 h-12 rounded-full bg-or shrink-0" />
                      <div className="flex-grow">
                        <div className="font-semibold">
                          {formatDateTime(rdv.scheduledAt)} — {lead ? fullName(lead) : '…'}
                        </div>
                        <div className="text-xs text-muted">
                          {rdv.locationType}
                          {commercial && ` · ${commercial.name}`}
                        </div>
                      </div>
                      <span className={`status-badge ${STATUS_BADGE[rdv.status]}`}>
                        {STATUS_LABEL[rdv.status]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </main>

        {selectedLead && <SplitPanel lead={selectedLead} userMap={userMap} />}
      </div>
    </AppShell>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
