import { useMemo, useState } from 'react'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { SplitPanel } from '../../components/SplitPanel'
import { LeadFiltersBar } from '../../components/LeadFiltersBar'
import { useLeadsProgressive, useUsers } from '../../lib/hooks'
import { DEFAULT_LEAD_FILTERS, applyLeadFilters, type LeadListFilters } from '../../lib/leadFilters'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  fullName,
  initials as leadInitials,
  type UserResponse,
} from '../../lib/types'

export function LeadsSplit() {
  const { data: leads, loading, error, refetch, backgroundLoading } = useLeadsProgressive({ quickLimit: 50, fullLimit: 200 })
  const { data: users } = useUsers()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [leadFilters, setLeadFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS)

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  const filtered = useMemo(() => {
    let list = applyLeadFilters(leads ?? [], leadFilters)
    if (!query) return list
    const q = query.toLowerCase()
    return list.filter((l) => fullName(l).toLowerCase().includes(q) || (l.city ?? '').toLowerCase().includes(q))
  }, [leads, leadFilters, query])

  const selected = useMemo(() => {
    if (!selectedId) return null
    return filtered.find((l) => l.id === selectedId) ?? null
  }, [filtered, selectedId])

  const counts = useMemo(() => ({
    total: (leads ?? []).length,
    nouveau: (leads ?? []).filter((l) => l.status === 'nouveau').length,
    qualifie: (leads ?? []).filter((l) => l.status === 'qualifie').length,
    relance: (leads ?? []).filter((l) => (l.joursSansContact ?? 0) >= 1).length,
  }), [leads])

  return (
    <AppShell>
      <Topbar
        eyebrow="LEADS · SPLIT"
        title="Workflow inline"
      />
      <div className="flex flex-grow overflow-hidden">
        {/* Main: leads table */}
        <main className="flex-grow p-6 overflow-y-auto min-w-0">
          {loading ? (
            <div className="py-16 text-center text-faint text-sm">Chargement des leads…</div>
          ) : error ? (
            <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
          ) : (
            <div className="glass-card !p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between">
                <div>
                  <div className="font-semibold">{counts.total} leads{backgroundLoading ? ' · synchronisation…' : ''}</div>
                  <div className="text-xs text-muted">{counts.nouveau} nouveaux · {counts.qualifie} qualifiés · {counts.relance} en relance</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <LeadFiltersBar filters={leadFilters} onChange={setLeadFilters} total={(leads ?? []).length} filtered={filtered.length} />
                  <input
                    type="text"
                    placeholder="Rechercher…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-52"
                  />
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-or-tint">
                  <tr className="text-left eyebrow">
                    <th className="px-5 py-3">NOM</th>
                    <th className="px-5 py-3">TÉL.</th>
                    <th className="px-5 py-3">VILLE</th>
                    <th className="px-5 py-3">STATUT</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => setSelectedId(l.id)}
                      className={`border-b border-line-soft last:border-0 cursor-pointer transition-colors ${
                        selected?.id === l.id ? 'bg-cuivre-tint/30' : 'hover:bg-white/50'
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-cuivre-tint flex items-center justify-center text-[10px] font-bold">{leadInitials(l)}</div>
                          <span className="font-semibold">{fullName(l)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted">{l.phone ?? '—'}</td>
                      <td className="px-5 py-3 text-muted">{l.city ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className={`status-badge ${STATUS_BADGE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-12 text-center text-faint text-sm">Aucun lead ne correspond.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {selected ? (
          <SplitPanel lead={selected} userMap={userMap} onClose={() => setSelectedId(null)} onSaved={refetch} />
        ) : (
          <aside className="w-[420px] border-l border-line bg-white/30 backdrop-blur-md p-6 flex-shrink-0">
            <div className="glass-card p-5 text-sm text-muted">
              <span className="eyebrow">SIDEBAR LEAD</span>
              <h3 className="font-bold text-text mt-2">Sélectionne un lead</h3>
              <p className="mt-2">Clique sur une ligne pour ouvrir les informations, les actions d’appel et le workflow setter.</p>
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  )
}
