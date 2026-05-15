import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { EmptyState } from '../../components/EmptyState'
import { LeadFiltersBar } from '../../components/LeadFiltersBar'
import { useAuth } from '../../lib/auth'
import { deleteLead, useLeads, useUsers, useStartCall } from '../../lib/hooks'
import { useLeadSidebar } from '../../lib/leadSidebar'
import { DEFAULT_LEAD_FILTERS, applyLeadFilters, type LeadListFilters } from '../../lib/leadFilters'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  fullName,
  initials,
  type LeadResponse,
  type UserResponse,
} from '../../lib/types'

type ColumnKey = string

type ColumnChoice = {
  key: ColumnKey
  label: string
}

const SETTER_COLUMNS: ColumnChoice[] = [
  { key: 'nom', label: 'Nom' },
  { key: 'telephone', label: 'Téléphone du Prospect' },
  { key: 'adresseComplete', label: 'Adresse complète' },
  { key: 'setter', label: 'Setter assigné' },
  { key: 'jaugeAppels', label: 'Jauge appels (4/jour)' },
  { key: 'dernierAppel', label: 'Dernier appel (date/heure)' },
  { key: 'statut', label: 'Statut opportunité' },
  { key: 'appelDate', label: "Date/heure de l'appel (from Appels)" },
  { key: 'jauge', label: 'Jauge 11 jours' },
  { key: 'logAppel', label: 'Log appel' },
  { key: 'appelsCommercial', label: 'Appels Commercial (from Rendez-vous)' },
]

const ADMIN_COLUMNS: ColumnChoice[] = [
  { key: 'nom', label: 'Nom' },
  { key: 'statut', label: 'Statut opportunité' },
  { key: 'email', label: 'Email' },
  { key: 'telephone', label: 'Téléphone du Prospect' },
  { key: 'adresse', label: 'Adresse' },
  { key: 'ville', label: 'Ville' },
  { key: 'codePostal', label: 'Code Postal' },
  { key: 'leadGenere', label: 'Date/heure lead généré' },
  { key: 'canal', label: "Canal d'acquisition" },
  { key: 'campagne', label: 'Campagne' },
  { key: 'adset', label: 'Adset' },
  { key: 'ad', label: 'Ad' },
  { key: 'creationLead', label: 'Date de création du lead' },
  { key: 'datePassageRelance', label: 'Date de passage en Relance' },
  { key: 'setter', label: 'Setter assigné' },
  { key: 'appels', label: 'Appels' },
  { key: 'premierAppel', label: 'Premier appel (date/heure)' },
  { key: 'jourRelance', label: 'Jour de relance (from Appels)' },
  { key: 'nbAppelTotal', label: "Nb d'appel total" },
  { key: 'appel5min', label: '1er appel < 5 min ?' },
  { key: 'urlFormulaireAppel', label: 'URL formulaire appel' },
  { key: 'logAppel', label: 'Log appel' },
  { key: 'nbAppelsAujourdhui', label: "Nb appels aujourd'hui" },
  { key: 'recordId', label: 'Record ID' },
  { key: 'modification', label: 'Dernière modification' },
  { key: 'dernierAppel', label: 'Dernier appel (date/heure)' },
  { key: 'appelDate', label: "Date/heure de l'appel (from Appels)" },
  { key: 'pctLeadAppele5min', label: '% lead appelé < 5min' },
  { key: 'campagnes', label: 'Campagnes' },
  { key: 'jaugeAppels', label: 'Jauge appels (4/jour)' },
  { key: 'prochainRappel', label: 'Date/heure prochain rappel (à partir de Appels)' },
  { key: 'relanceMax', label: 'Jour relance max' },
  { key: 'jauge', label: 'Jauge 11 jours' },
  { key: 'projets', label: 'Projets' },
  { key: 'localisationMap', label: 'Localisation Map' },
  { key: 'contactId', label: 'Contact ID (GHL)' },
  { key: 'adresseComplete', label: 'Adresse complète' },
  { key: 'creation', label: 'Date de création' },
  { key: 'rdv', label: 'Rendez-vous' },
  { key: 'dateIso', label: 'Date ISO' },
  { key: 'kpis', label: "KPI's" },
  { key: 'commercialRdv', label: 'Commercial (from Rendez-vous)' },
  { key: 'actions', label: 'Actions' },
]


export function LeadsList() {
  const role = useAuth((s) => s.user?.role)
  if (role === 'admin') return <LeadsAdmin />
  return <LeadsSetter />
}

// ----- F5 Setter -----
// Seuil métier : un lead en "pas de réponse" ou "à rappeler" reste dans le
// flux de travail actif pendant 11 jours de contact/relance, puis passe dans
// "Relance à long terme". Les leads non éligibles restent classés "Non qualifiés".
const LONG_TERM_RELANCE_THRESHOLD_DAYS = 11

function LeadsSetter() {
  const [filter, setFilter] = useState<'nouveau' | 'rappel' | 'qualifie' | 'sans_reponse' | 'perdu'>('nouveau')
  const [leadFilters, setLeadFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS)
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('search') ?? '')
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  const [openComment, setOpenComment] = useState<{ leadName: string; comment: string } | null>(null)
  const [visibleColumns, setVisibleColumns] = useColumnVisibility('ecoi.leads.setter.columns.v3', SETTER_COLUMNS)
  const startCall = useStartCall()
  const orderedColumns = useOrderedColumns(SETTER_COLUMNS, visibleColumns)

  // Côté setter, l'écran s'ouvre directement sur les nouveaux leads.
  // Le filtre global "Tous" n'est pas affiché aux setters.
  const { data, loading, error } = useLeads({ limit: 1500 })
  const { data: usersList } = useUsers()
  const mine = data ?? []
  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of usersList ?? []) m.set(u.id, u)
    return m
  }, [usersList])

  const counts = useMemo(() => ({
    all: mine.length,
    nouveau: mine.filter(isNouveauLead).length,
    rappel: mine.filter(isCallbackLead).length,
    qualifie: mine.filter((l) => l.status === 'qualifie').length,
    sansReponse: mine.filter(isLongTermRelanceLead).length,
    perdu: mine.filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie').length,
  }), [mine])

  const filtered = useMemo(() => {
    let list = mine
    if (filter === 'nouveau') list = list.filter(isNouveauLead)
    if (filter === 'rappel') list = list.filter(isCallbackLead)
    if (filter === 'qualifie') list = list.filter((l) => l.status === 'qualifie')
    if (filter === 'sans_reponse') list = list.filter(isLongTermRelanceLead)
    if (filter === 'perdu') list = list.filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie')
    list = applyLeadFilters(list, leadFilters)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((l) => [fullName(l), l.phone, l.email, l.city].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return list
  }, [mine, filter, leadFilters, query])

  const selected = useMemo(
    () => (selectedId ? mine.find((l) => l.id === selectedId) ?? null : null),
    [mine, selectedId],
  )
  const tableScrollRef = useRememberedLeadTableScroll('ecoi.leads.setter.tableScroll.v1', filtered, selectedId)

  return (
    <AppShell>
      <Topbar
        eyebrow="LEADS / SETTER"
        title="Nouveaux leads"
      />
      <div className="flex flex-grow overflow-hidden">
        <div className="flex-grow flex flex-col min-w-0">
          <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
            <div className="relative flex-grow max-w-sm">
              <Icon name="search" size={16} className="absolute left-3 top-2.5 text-faint" />
              <input
                type="text"
                placeholder="Rechercher un lead…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-white border border-line rounded-[14px] pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-or"
              />
            </div>
          </div>

          <main className="p-8 pt-4 flex-grow flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-4 flex-wrap flex-shrink-0 bg-cream-darker/95 backdrop-blur z-20 pb-2">
              <FilterPill active={filter === 'nouveau'} onClick={() => setFilter('nouveau')}>Nouveaux ({counts.nouveau})</FilterPill>
              <FilterPill active={filter === 'rappel'} onClick={() => setFilter('rappel')}>À rappeler ({counts.rappel})</FilterPill>
              <FilterPill active={filter === 'qualifie'} onClick={() => setFilter('qualifie')}>Qualifiés ({counts.qualifie})</FilterPill>
              <FilterPill active={filter === 'sans_reponse'} onClick={() => setFilter('sans_reponse')}>Relance à long terme ({counts.sansReponse})</FilterPill>
              <FilterPill active={filter === 'perdu'} onClick={() => setFilter('perdu')}>Non qualifiés ({counts.perdu})</FilterPill>
              <LeadFiltersBar filters={leadFilters} onChange={setLeadFilters} total={mine.length} filtered={filtered.length} />
              <ColumnVisibilityMenu columns={SETTER_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
              {loading && mine.length > 0 && <span className="text-xs text-faint ml-auto">Actualisation…</span>}
            </div>

            {loading && mine.length === 0 ? (
              <div className="py-16 text-center text-faint text-sm">Chargement des leads…</div>
            ) : error ? (
              <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
            ) : filtered.length === 0 ? (
              <div className="py-16">
                <EmptyState
                  icon="users"
                  title={mine.length === 0 ? 'Aucun lead pour le moment' : 'Aucun lead ne correspond'}
                  description={mine.length === 0 ? "Aucun lead disponible pour le moment." : 'Essayez un autre filtre ou créez un nouveau lead.'}
                  secondaryAction={{ label: 'Voir les nouveaux leads', onClick: () => { setFilter('nouveau'); setQuery('') } }}
                />
              </div>
            ) : (
              <div className="glass-card !p-0 overflow-hidden flex-grow min-h-0">
                <div ref={tableScrollRef} data-preserve-scroll="true" className="overflow-auto h-full">
                <table className="min-w-[1640px] w-full text-sm table-fixed lead-table">
                  <thead className="text-left eyebrow sticky top-0 z-10 border-b border-white/60 bg-white/65 shadow-sm shadow-text/5 backdrop-blur-2xl">
                    <tr>
                      {orderedColumns.map((column) => renderSetterHeader(column.key))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr
                        key={l.id}
                        data-lead-id={l.id}
                        className={`border-b border-line-soft last:border-0 cursor-pointer transition-colors ${
                          selected?.id === l.id ? 'bg-or/20 shadow-[inset_4px_0_0_var(--color-or-dark)] !text-text' : 'hover:bg-white/40'
                        }`}
                        onClick={() => selectLead(l.id)}
                      >
                        {orderedColumns.map((column) => renderSetterCell(column.key, l, userMap, startCall, setOpenComment))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </main>
        </div>

        <CommentModal data={openComment} onClose={() => setOpenComment(null)} />

      </div>
    </AppShell>
  )
}

// ----- F6 Admin -----
function LeadsAdmin() {
  const exportCsv = (rows: LeadResponse[]) => {
    const header = ['nom', 'telephone', 'email', 'ville', 'statut', 'source', 'createdAt']
    const csv = [header.join(','), ...rows.map((l) => [fullName(l), l.phone ?? '', l.email ?? '', l.city ?? '', l.status, l.source, l.createdAt].map((v) => `\"${String(v).replace(/\"/g, '\\\"')}\"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  const [setterFilter, setSetterFilter] = useState('all')
  const [commercialFilter, setCommercialFilter] = useState('all')
  const [leadFilters, setLeadFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS)
  const [openComment, setOpenComment] = useState<{ leadName: string; comment: string } | null>(null)
  const [visibleColumns, setVisibleColumns] = useColumnVisibility('ecoi.leads.admin.columns.v3', ADMIN_COLUMNS)
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  const clearLead = useLeadSidebar((s) => s.clearLead)
  const orderedColumns = useOrderedColumns(ADMIN_COLUMNS, visibleColumns)
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])

  const { data: leadsData, loading, error, refetch } = useLeads({ limit: 1500 })
  const { data: users = [] } = useUsers()
  const leads = leadsData ?? []

  const setters = useMemo(() => (users ?? []).filter((u) => u.role === 'setter' && u.active), [users])
  const commerciaux = useMemo(() => (users ?? []).filter((u) => u.role === 'commercial' && u.active), [users])
  const userMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users ?? []) m.set(u.id, u.name)
    return m
  }, [users])

  const filtered = useMemo(() => {
    let list = leads ?? []
    if (setterFilter !== 'all') list = list.filter((l) => l.setterId === setterFilter)
    if (commercialFilter !== 'all') list = list.filter((l) => l.assignedToId === commercialFilter)
    list = applyLeadFilters(list, leadFilters)
    return list
  }, [leads, setterFilter, commercialFilter, leadFilters])

  const stats = useMemo(() => ({
    total: (leads ?? []).length,
    qualifies: (leads ?? []).filter((l) =>
      l.status === 'qualifie' || l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe',
    ).length,
    waiting: (leads ?? []).filter((l) => l.status === 'nouveau' || (l.joursSansContact ?? 0) >= 2).length,
    perdus: (leads ?? []).filter((l) => l.status === 'perdu').length,
  }), [leads])
  const selectedFilteredIds = useMemo(() => {
    const visibleIds = new Set(filtered.map((lead) => lead.id))
    return selectedLeadIds.filter((id) => visibleIds.has(id))
  }, [filtered, selectedLeadIds])
  const allFilteredSelected = filtered.length > 0 && selectedFilteredIds.length === filtered.length
  const someFilteredSelected = selectedFilteredIds.length > 0 && !allFilteredSelected
  const tableScrollRef = useRememberedLeadTableScroll('ecoi.leads.admin.tableScroll.v1', filtered, selectedId)

  useEffect(() => {
    const existingIds = new Set(leads.map((lead) => lead.id))
    setSelectedLeadIds((current) => current.filter((id) => existingIds.has(id)))
  }, [leads])

  const toggleLeadSelection = (leadId: string, checked: boolean) => {
    setSelectedLeadIds((current) => {
      if (checked) return current.includes(leadId) ? current : [...current, leadId]
      return current.filter((id) => id !== leadId)
    })
  }

  const toggleAllFiltered = (checked: boolean) => {
    const filteredIds = filtered.map((lead) => lead.id)
    if (checked) {
      setSelectedLeadIds((current) => Array.from(new Set([...current, ...filteredIds])))
      return
    }
    const filteredSet = new Set(filteredIds)
    setSelectedLeadIds((current) => current.filter((id) => !filteredSet.has(id)))
  }

  const handleDeleteLead = async (lead: LeadResponse) => {
    if (deletingLeadId) return
    const label = fullName(lead) || lead.email || lead.phone || 'ce lead'
    const confirmed = window.confirm(`Supprimer le lead ${label} ? Cette action le retirera du tableau.`)
    if (!confirmed) return

    setDeletingLeadId(lead.id)
    try {
      await deleteLead(lead.id)
      setSelectedLeadIds((current) => current.filter((id) => id !== lead.id))
      if (selectedId === lead.id) clearLead()
      refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible de supprimer le lead')
    } finally {
      setDeletingLeadId(null)
    }
  }

  const handleDeleteSelectedLeads = async () => {
    if (deletingLeadId || selectedFilteredIds.length === 0) return
    const count = selectedFilteredIds.length
    const confirmed = window.confirm(`Supprimer ${count} lead${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''} ? Cette action les retirera du tableau.`)
    if (!confirmed) return

    setDeletingLeadId('bulk')
    try {
      await Promise.all(selectedFilteredIds.map((id) => deleteLead(id)))
      if (selectedId && selectedFilteredIds.includes(selectedId)) clearLead()
      setSelectedLeadIds((current) => current.filter((id) => !selectedFilteredIds.includes(id)))
      refetch()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible de supprimer les leads sélectionnés')
    } finally {
      setDeletingLeadId(null)
    }
  }

  return (
    <AppShell>
      <Topbar
        eyebrow="LEADS / ADMIN — TOUTE L'ÉQUIPE"
        title="Tous les leads"
      />
      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
        <select
          value={setterFilter}
          onChange={(e) => setSetterFilter(e.target.value)}
          className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm"
        >
          <option value="all">Tous les setters</option>
          {setters.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={commercialFilter}
          onChange={(e) => setCommercialFilter(e.target.value)}
          className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm"
        >
          <option value="all">Tous les commerciaux</option>
          {commerciaux.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <LeadFiltersBar filters={leadFilters} onChange={setLeadFilters} total={(leads ?? []).length} filtered={filtered.length} />
        <ColumnVisibilityMenu columns={ADMIN_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
        {loading && leads.length > 0 && <span className="text-xs text-faint">Actualisation…</span>}
        <div className="ml-auto flex items-center gap-2">
          {selectedFilteredIds.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteSelectedLeads}
              disabled={Boolean(deletingLeadId)}
              className="inline-flex items-center gap-2 rounded-[14px] border border-rouille/30 bg-rouille-tint px-4 py-2 text-sm font-bold text-rouille hover:bg-rouille hover:text-white disabled:opacity-60"
            >
              <Icon name="trash" size={14} />
              {deletingLeadId === 'bulk' ? 'Suppression…' : `Supprimer (${selectedFilteredIds.length})`}
            </button>
          )}
          <button onClick={() => exportCsv(filtered)} className="btn-primary px-4 py-2 rounded-[14px] text-sm">Exporter CSV</button>
        </div>
      </div>

      <main className="p-8 pt-4 flex-grow flex flex-col min-h-0 overflow-hidden">
        <div className="grid grid-cols-4 gap-6 mb-4 flex-shrink-0">
          <StatCard label="TOTAL LEADS" value={stats.total.toLocaleString('fr-FR')} />
          <StatCard label="QUALIFIÉS" value={stats.qualifies.toString()} />
          <StatCard label="EN ATTENTE" value={stats.waiting.toString()} />
          <StatCard label="NON QUALIFIÉS" value={stats.perdus.toString()} />
        </div>

        {loading && leads.length === 0 ? (
          <div className="py-16 text-center text-faint text-sm">Chargement…</div>
        ) : error ? (
          <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-faint text-sm">Aucun lead ne correspond aux filtres.</div>
        ) : (
          <div className="glass-card !p-0 overflow-hidden flex-grow min-h-0">
            <div ref={tableScrollRef} data-preserve-scroll="true" className="overflow-auto h-full">
            <table className="min-w-[5540px] w-full text-sm table-fixed lead-table">
              <thead className="text-left eyebrow sticky top-0 z-10 border-b border-white/60 bg-white/65 shadow-sm shadow-text/5 backdrop-blur-2xl">
                <tr>
                  <Th className="w-[60px] text-center">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      ref={(input) => {
                        if (input) input.indeterminate = someFilteredSelected
                      }}
                      onChange={(event) => toggleAllFiltered(event.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-or"
                      aria-label="Sélectionner tous les leads visibles"
                    />
                  </Th>
                  {orderedColumns.map((column) => renderAdminHeader(column.key))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    data-lead-id={l.id}
                    className={`border-b border-line-soft last:border-0 cursor-pointer transition-colors ${
                      selectedId === l.id ? 'bg-or/20 shadow-[inset_4px_0_0_var(--color-or-dark)] !text-text' : selectedLeadIds.includes(l.id) ? 'bg-or/10' : 'hover:bg-white/40'
                    }`}
                    onDoubleClick={() => selectLead(l.id)}
                    title="Double-cliquer pour ouvrir le détail du lead"
                  >
                    <Td className="text-center" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.includes(l.id)}
                        onChange={(event) => toggleLeadSelection(l.id, event.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-or"
                        aria-label={`Sélectionner ${fullName(l) || 'ce lead'}`}
                      />
                    </Td>
                    {orderedColumns.map((column) => renderAdminCell(column.key, l, userMap, setOpenComment, { onDelete: handleDeleteLead, deletingLeadId }))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </main>
      <CommentModal data={openComment} onClose={() => setOpenComment(null)} />
    </AppShell>
  )
}

// ===== Helpers =====

function isCallbackLead(lead: LeadResponse): boolean {
  return (lead.status === 'a_rappeler' || lead.status === 'relance' || Boolean(lead.nextCallbackAt)) && !isLongTermRelanceLead(lead)
}

function isNouveauLead(lead: LeadResponse): boolean {
  if (lead.status === 'nouveau') return true
  if (lead.status === 'pas_de_reponse' && !isLongTermRelanceLead(lead)) return true
  return false
}

function isLongTermRelanceLead(lead: LeadResponse): boolean {
  const canAgeToLongTerm = lead.status === 'pas_de_reponse' || lead.status === 'a_rappeler' || lead.status === 'relance'
  if (!canAgeToLongTerm) return false
  const noAnswerAttempts = 'consecutiveNoAnswerCount' in lead ? Number(lead.consecutiveNoAnswerCount ?? 0) : 0
  const relanceAge = Math.max(lead.joursRelance ?? 0, noAnswerAttempts)
  return relanceAge >= LONG_TERM_RELANCE_THRESHOLD_DAYS
}

function statusLabelForLead(lead: LeadResponse): string {
  if (isLongTermRelanceLead(lead)) return 'Relance à long terme'
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'Non qualifié'
  return STATUS_LABEL[lead.status]
}

function statusBadgeForLead(lead: LeadResponse): string {
  if (isLongTermRelanceLead(lead)) return 'bg-cuivre-tint text-cuivre'
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'bg-rouille-tint text-rouille'
  return STATUS_BADGE[lead.status]
}

function lastCallDateTime(iso: string | null): string {
  if (!iso) return 'Jamais'
  const d = new Date(iso)
  return `${shortDate(iso)} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function prettySource(l: Pick<LeadResponse, 'source' | 'canalAcquisition' | 'utmSource'>): string {
  if (l.canalAcquisition) return l.canalAcquisition
  if (l.utmSource) return l.utmSource[0].toUpperCase() + l.utmSource.slice(1)
  switch (l.source) {
    case 'ghl': return 'GHL'
    case 'airtable_migration': return 'Migration'
    case 'manual': return 'Manuel'
    case 'referrer': return 'Parrain'
  }
}

function fullDateTime(iso: string): string {
  const d = new Date(iso)
  return `${shortDate(iso)} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function campaignName(l: Pick<LeadResponse, 'campaign' | 'utmCampaign'>): string | null {
  return l.campaign ?? l.utmCampaign ?? null
}

function campaignSummary(l: Pick<LeadResponse, 'campaign' | 'utmCampaign' | 'adset' | 'utmMedium' | 'ad' | 'utmSource'>): string {
  return [campaignName(l), l.adset ?? l.utmMedium, l.ad ?? l.utmSource].filter(Boolean).join(' / ') || '—'
}

function rdvLabel(l: Pick<LeadResponse, 'latestRdvAt' | 'latestRdvStatus'>): string {
  if (!l.latestRdvAt) return '—'
  const status = l.latestRdvStatus ? RDV_STATUS_LABEL[l.latestRdvStatus] : 'RDV'
  return `${status} · ${fullDateTime(l.latestRdvAt)}`
}

function addressFull(l: Pick<LeadResponse, 'addressLine' | 'postalCode' | 'city'>): string {
  return [l.addressLine, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'
}

function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—'
  return `${Math.max(0, days)}j`
}

function yesNo(value: boolean | null | undefined): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-faint">—</span>
  return <span className={`status-badge ${value ? 'bg-success-tint text-success' : 'bg-rouille-tint text-rouille'}`}>{value ? 'Oui' : 'Non'}</span>
}

function kpiSummary(l: Pick<LeadResponse, 'callCount' | 'callsToday' | 'revenuFiscal'>): string {
  const parts = [`${l.callCount ?? 0} appels`, `${l.callsToday ?? 0}/4 aujourd'hui`]
  if (l.revenuFiscal !== null && l.revenuFiscal !== undefined) parts.push(`RFR ${l.revenuFiscal.toLocaleString('fr-FR')}`)
  return parts.join(' · ')
}

function commercialLabel(lead: LeadResponse, userMap: Map<string, UserResponse> | Map<string, string>): string {
  const id = lead.latestRdvCommercialId ?? lead.assignedToId
  if (!id) return '—'
  const user = userMap.get(id)
  return (typeof user === 'string' ? user : user?.name) ?? '—'
}

const RDV_STATUS_LABEL = {
  planifie: 'Planifié',
  honore: 'Honoré',
  no_show: 'No-show',
  reporte: 'Reporté',
  annule: 'Annulé',
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

function renderSetterHeader(key: ColumnKey) {
  switch (key) {
    case 'nom': return <Th key={key} className="w-[240px] lead-sticky-head">NOM</Th>
    case 'telephone': return <Th key={key} className="w-[190px]">TÉLÉPHONE DU PROSPECT</Th>
    case 'adresseComplete': return <Th key={key} className="w-[260px]">ADRESSE COMPLÈTE</Th>
    case 'setter': return <Th key={key} className="w-[210px]">SETTER ASSIGNÉ</Th>
    case 'jaugeAppels': return <Th key={key} className="w-[160px]">JAUGE APPELS (4/JOUR)</Th>
    case 'dernierAppel': return <Th key={key} className="w-[170px]">DERNIER APPEL</Th>
    case 'statut': return <Th key={key} className="w-[160px]">STATUT OPPORTUNITÉ</Th>
    case 'appelDate': return <Th key={key} className="w-[190px]">DATE/HEURE DE L'APPEL</Th>
    case 'jauge': return <Th key={key} className="w-[160px]">JAUGE 11 JOURS</Th>
    case 'logAppel': return <Th key={key} className="w-[120px]">LOG APPEL</Th>
    case 'appelsCommercial': return <Th key={key} className="w-[220px]">APPELS COMMERCIAL</Th>
    default: return null
  }
}

function renderSetterCell(
  key: ColumnKey,
  lead: LeadResponse,
  userMap: Map<string, UserResponse>,
  startCall: ReturnType<typeof useStartCall>,
  setOpenComment: (data: { leadName: string; comment: string }) => void,
) {
  switch (key) {
    case 'nom':
      return (
        <Td key={key} className="lead-sticky-cell">
          <div className="flex items-center gap-3 min-w-0">
            <LeadCommentButton comment={lead.latestCallComment} leadName={fullName(lead)} onOpen={setOpenComment} />
            <div className="w-8 h-8 rounded-full bg-cuivre-tint flex flex-shrink-0 items-center justify-center text-xs font-bold">{initials(lead)}</div>
            <span className="font-semibold truncate" title={fullName(lead)}>{fullName(lead)}</span>
          </div>
        </Td>
      )
    case 'telephone': return <Td key={key}><PhoneCell lead={lead} onStartCall={startCall} /></Td>
    case 'adresseComplete': return <Td key={key} className="text-muted truncate" title={addressFull(lead)}>{addressFull(lead)}</Td>
    case 'setter': return <Td key={key}><SetterChips lead={lead} userMap={userMap} /></Td>
    case 'jaugeAppels': return <Td key={key}><DailyCallGauge count={lead.callsToday ?? 0} /></Td>
    case 'dernierAppel': return <Td key={key} className="text-faint">{lastCallDateTime(lead.latestCallAt ?? lead.lastContactAt)}</Td>
    case 'statut': return <Td key={key}><span className={`status-badge ${statusBadgeForLead(lead)}`}>{statusLabelForLead(lead)}</span></Td>
    case 'appelDate': return <Td key={key} className="text-faint">{lastCallDateTime(lead.latestCallAt ?? lead.lastContactAt)}</Td>
    case 'jauge': return <Td key={key}><ElevenDayGauge jours={lead.joursRelance ?? lead.joursSansContact} airtableGauge={lead.jauge11Jours} /></Td>
    case 'logAppel': return <Td key={key}><LeadCommentButton comment={lead.latestCallComment} leadName={fullName(lead)} onOpen={setOpenComment} /></Td>
    case 'appelsCommercial': return <Td key={key} className="text-muted truncate" title={commercialLabel(lead, userMap)}>{commercialLabel(lead, userMap)}</Td>
    default: return null
  }
}

function renderAdminHeader(key: ColumnKey) {
  switch (key) {
    case 'nom': return <Th key={key} className="w-[240px] lead-sticky-head">NOM</Th>
    case 'statut': return <Th key={key} className="w-[160px]">STATUT OPPORTUNITÉ</Th>
    case 'email': return <Th key={key} className="w-[220px]">EMAIL</Th>
    case 'telephone': return <Th key={key} className="w-[180px]">TÉLÉPHONE DU PROSPECT</Th>
    case 'adresse': return <Th key={key} className="w-[220px]">ADRESSE</Th>
    case 'ville': return <Th key={key} className="w-[140px]">VILLE</Th>
    case 'codePostal': return <Th key={key} className="w-[120px]">CODE POSTAL</Th>
    case 'leadGenere': return <Th key={key} className="w-[180px]">DATE/HEURE LEAD GÉNÉRÉ</Th>
    case 'canal': return <Th key={key} className="w-[180px]">CANAL D'ACQUISITION</Th>
    case 'campagne': return <Th key={key} className="w-[180px]">CAMPAGNE</Th>
    case 'adset': return <Th key={key} className="w-[160px]">ADSET</Th>
    case 'ad': return <Th key={key} className="w-[160px]">AD</Th>
    case 'creationLead': return <Th key={key} className="w-[190px]">DATE DE CRÉATION DU LEAD</Th>
    case 'datePassageRelance': return <Th key={key} className="w-[190px]">DATE DE PASSAGE EN RELANCE</Th>
    case 'setter': return <Th key={key} className="w-[210px]">SETTER ASSIGNÉ</Th>
    case 'appels': return <Th key={key} className="w-[160px]">APPELS</Th>
    case 'premierAppel': return <Th key={key} className="w-[180px]">PREMIER APPEL</Th>
    case 'jourRelance': return <Th key={key} className="w-[170px]">JOUR DE RELANCE</Th>
    case 'nbAppelTotal': return <Th key={key} className="w-[140px]">NB D'APPEL TOTAL</Th>
    case 'appel5min': return <Th key={key} className="w-[150px]">1ER APPEL &lt; 5 MIN ?</Th>
    case 'urlFormulaireAppel': return <Th key={key} className="w-[190px]">URL FORMULAIRE APPEL</Th>
    case 'logAppel': return <Th key={key} className="w-[120px]">LOG APPEL</Th>
    case 'nbAppelsAujourdhui': return <Th key={key} className="w-[150px]">NB APPELS AUJOURD'HUI</Th>
    case 'recordId': return <Th key={key} className="w-[180px]">RECORD ID</Th>
    case 'modification': return <Th key={key} className="w-[180px]">DERNIÈRE MODIFICATION</Th>
    case 'dernierAppel': return <Th key={key} className="w-[180px]">DERNIER APPEL</Th>
    case 'appelDate': return <Th key={key} className="w-[190px]">DATE/HEURE DE L'APPEL</Th>
    case 'pctLeadAppele5min': return <Th key={key} className="w-[160px]">% LEAD APPELÉ &lt; 5MIN</Th>
    case 'campagnes': return <Th key={key} className="w-[240px]">CAMPAGNES</Th>
    case 'jaugeAppels': return <Th key={key} className="w-[160px]">JAUGE APPELS (4/JOUR)</Th>
    case 'prochainRappel': return <Th key={key} className="w-[220px]">DATE/HEURE PROCHAIN RAPPEL</Th>
    case 'relanceMax': return <Th key={key} className="w-[160px]">JOUR RELANCE MAX</Th>
    case 'jauge': return <Th key={key} className="w-[170px]">JAUGE 11 JOURS</Th>
    case 'projets': return <Th key={key} className="w-[160px]">PROJETS</Th>
    case 'localisationMap': return <Th key={key} className="w-[220px]">LOCALISATION MAP</Th>
    case 'contactId': return <Th key={key} className="w-[180px]">CONTACT ID (GHL)</Th>
    case 'adresseComplete': return <Th key={key} className="w-[260px]">ADRESSE COMPLÈTE</Th>
    case 'creation': return <Th key={key} className="w-[160px]">DATE DE CRÉATION</Th>
    case 'rdv': return <Th key={key} className="w-[190px]">RENDEZ-VOUS</Th>
    case 'dateIso': return <Th key={key} className="w-[240px]">DATE ISO</Th>
    case 'kpis': return <Th key={key} className="w-[160px]">KPI'S</Th>
    case 'commercialRdv': return <Th key={key} className="w-[220px]">COMMERCIAL (FROM RENDEZ-VOUS)</Th>
    case 'actions': return <Th key={key} className="w-[130px]">ACTIONS</Th>
    default: return null
  }
}

function renderAdminCell(
  key: ColumnKey,
  lead: LeadResponse,
  userMap: Map<string, string>,
  setOpenComment: (data: { leadName: string; comment: string }) => void,
  actions: { onDelete: (lead: LeadResponse) => void; deletingLeadId: string | null },
) {
  switch (key) {
    case 'nom': return <Td key={key} className="lead-sticky-cell"><span className="font-semibold truncate" title={fullName(lead)}>{fullName(lead)}</span></Td>
    case 'statut': return <Td key={key}><span className={`status-badge ${statusBadgeForLead(lead)}`}>{statusLabelForLead(lead)}</span></Td>
    case 'email': return <Td key={key} className="text-muted truncate" title={lead.email ?? undefined}>{lead.email ?? '—'}</Td>
    case 'telephone': return <Td key={key} className="text-muted truncate" title={lead.phone ?? undefined}>{lead.phone ?? '—'}</Td>
    case 'adresse': return <Td key={key} className="text-muted truncate" title={lead.addressLine ?? undefined}>{lead.addressLine ?? '—'}</Td>
    case 'ville': return <Td key={key} className="text-muted truncate" title={lead.city ?? undefined}>{lead.city ?? '—'}</Td>
    case 'codePostal': return <Td key={key} className="text-muted truncate" title={lead.postalCode ?? undefined}>{lead.postalCode ?? '—'}</Td>
    case 'leadGenere': return <Td key={key} className="text-faint">{fullDateTime(lead.createdAt)}</Td>
    case 'canal': return <Td key={key} className="text-muted truncate" title={prettySource(lead)}>{prettySource(lead)}</Td>
    case 'campagne': return <Td key={key} className="text-muted truncate" title={campaignName(lead) ?? undefined}>{campaignName(lead) ?? '—'}</Td>
    case 'adset': return <Td key={key} className="text-muted truncate" title={lead.adset ?? lead.utmMedium ?? undefined}>{lead.adset ?? lead.utmMedium ?? '—'}</Td>
    case 'ad': return <Td key={key} className="text-muted truncate" title={lead.ad ?? lead.utmSource ?? undefined}>{lead.ad ?? lead.utmSource ?? '—'}</Td>
    case 'creationLead': return <Td key={key} className="text-faint">{fullDateTime(lead.createdAt)}</Td>
    case 'datePassageRelance': return <Td key={key} className="text-faint">{lead.datePassageRelance ? fullDateTime(lead.datePassageRelance) : '—'}</Td>
    case 'setter': return <Td key={key}><SetterChips lead={lead} userMap={userMap} /></Td>
    case 'appels': return <Td key={key} className="text-faint">{lead.callCount ?? 0} appel{(lead.callCount ?? 0) > 1 ? 's' : ''}</Td>
    case 'premierAppel': return <Td key={key} className="text-faint">{lastCallDateTime(lead.firstCallAt ?? null)}</Td>
    case 'jourRelance': return <Td key={key} className="text-faint">{formatDays(lead.joursRelance)}</Td>
    case 'nbAppelTotal': return <Td key={key} className="text-faint">{lead.callCount ?? 0}</Td>
    case 'appel5min': return <Td key={key}>{yesNo(lead.firstCallUnderFiveMin)}</Td>
    case 'urlFormulaireAppel': return <Td key={key} className="text-faint">—</Td>
    case 'logAppel': return <Td key={key}><LeadCommentButton comment={lead.latestCallComment} leadName={fullName(lead)} onOpen={setOpenComment} /></Td>
    case 'nbAppelsAujourdhui': return <Td key={key} className="text-faint">{lead.callsToday ?? 0}</Td>
    case 'recordId': return <Td key={key} className="text-muted truncate" title={lead.externalId ?? lead.id}>{lead.externalId ?? lead.id}</Td>
    case 'modification': return <Td key={key} className="text-faint">{fullDateTime(lead.updatedAt)}</Td>
    case 'dernierAppel': return <Td key={key} className="text-faint">{lastCallDateTime(lead.latestCallAt ?? lead.lastContactAt)}</Td>
    case 'appelDate': return <Td key={key} className="text-faint">{lastCallDateTime(lead.latestCallAt ?? lead.lastContactAt)}</Td>
    case 'pctLeadAppele5min': return <Td key={key}>{yesNo(lead.firstCallUnderFiveMin)}</Td>
    case 'campagnes': return <Td key={key} className="text-muted truncate" title={campaignSummary(lead)}>{campaignSummary(lead)}</Td>
    case 'jaugeAppels': return <Td key={key}><DailyCallGauge count={lead.callsToday ?? 0} /></Td>
    case 'prochainRappel': return <Td key={key} className="text-faint">{lastCallDateTime(lead.nextCallbackAt ?? null)}</Td>
    case 'relanceMax': return <Td key={key} className="text-faint">{formatDays(lead.joursRelance)}</Td>
    case 'jauge': return <Td key={key}><ElevenDayGauge jours={lead.joursRelance ?? lead.joursSansContact} airtableGauge={lead.jauge11Jours} /></Td>
    case 'projets': return <Td key={key} className="text-muted truncate" title={lead.typeLogement ?? undefined}>{lead.typeLogement ?? '—'}</Td>
    case 'localisationMap': return <Td key={key} className="text-muted truncate" title={lead.localisationMap ?? undefined}>{lead.localisationMap ?? '—'}</Td>
    case 'contactId': return <Td key={key} className="text-muted truncate" title={lead.externalId ?? undefined}>{lead.externalId ?? '—'}</Td>
    case 'adresseComplete': return <Td key={key} className="text-muted truncate" title={addressFull(lead)}>{addressFull(lead)}</Td>
    case 'creation': return <Td key={key} className="text-faint">{shortDate(lead.createdAt)}</Td>
    case 'rdv': return <Td key={key} className="text-faint">{rdvLabel(lead)}</Td>
    case 'dateIso': return <Td key={key} className="text-muted truncate" title={lead.latestRdvAt ?? lead.createdAt}>{lead.latestRdvAt ?? lead.createdAt}</Td>
    case 'kpis': return <Td key={key} className="text-muted truncate" title={kpiSummary(lead)}>{kpiSummary(lead)}</Td>
    case 'commercialRdv': return <Td key={key} className="text-muted truncate" title={commercialLabel(lead, userMap)}>{commercialLabel(lead, userMap)}</Td>
    case 'actions':
      return (
        <Td key={key}>
          <button
            type="button"
            disabled={actions.deletingLeadId === lead.id}
            onClick={(event) => {
              event.stopPropagation()
              actions.onDelete(lead)
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-rouille/30 bg-rouille-tint px-3 py-1.5 text-xs font-bold text-rouille hover:bg-rouille hover:text-white disabled:opacity-60"
            title="Supprimer ce lead"
          >
            <Icon name="trash" size={13} />
            {actions.deletingLeadId === lead.id ? 'Suppression…' : 'Supprimer'}
          </button>
        </Td>
      )
    default: return null
  }
}

// ===== Atoms =====

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`pill-tab ${active ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}
    >
      {children}
    </button>
  )
}

function useRememberedLeadTableScroll(
  storageKey: string,
  rows: LeadResponse[],
  selectedLeadId: string | null,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const raf = window.requestAnimationFrame(() => {
      if (selectedLeadId) {
        const selectedRow = Array.from(el.querySelectorAll<HTMLElement>('tr[data-lead-id]'))
          .find((row) => row.dataset.leadId === selectedLeadId)
        if (selectedRow) {
          const rowRect = selectedRow.getBoundingClientRect()
          const containerRect = el.getBoundingClientRect()
          const rowIsVisible = rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom
          if (!rowIsVisible) selectedRow.scrollIntoView({ block: 'center', inline: 'nearest' })
          return
        }
      }

      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return
      try {
        const saved = JSON.parse(raw) as { top?: number; left?: number }
        el.scrollTop = saved.top ?? 0
        el.scrollLeft = saved.left ?? 0
      } catch {
        window.localStorage.removeItem(storageKey)
      }
    })

    return () => window.cancelAnimationFrame(raf)
  }, [rows.length, selectedLeadId, storageKey])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const save = () => {
      window.localStorage.setItem(storageKey, JSON.stringify({ top: el.scrollTop, left: el.scrollLeft }))
    }

    el.addEventListener('scroll', save, { passive: true })
    return () => {
      save()
      el.removeEventListener('scroll', save)
    }
  }, [storageKey])

  return scrollRef
}

function useColumnVisibility(storageKey: string, columns: ColumnChoice[]) {
  const defaultKeys = columns.map((c) => c.key)
  const [visible, setVisible] = useState<ColumnKey[]>(() => {
    if (typeof window === 'undefined') return defaultKeys
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return defaultKeys
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return defaultKeys
      const valid = parsed.filter((key): key is string => defaultKeys.includes(String(key)))
      const missing = defaultKeys.filter((key) => !valid.includes(key))
      const merged = [...valid, ...missing]
      return merged.length ? merged : defaultKeys
    } catch {
      return defaultKeys
    }
  })

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(visible))
  }, [storageKey, visible])

  return [visible, setVisible] as const
}

function useOrderedColumns(columns: ColumnChoice[], visible: ColumnKey[]) {
  return useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]))
    return visible.map((key) => byKey.get(key)).filter((column): column is ColumnChoice => Boolean(column))
  }, [columns, visible])
}

function ColumnVisibilityMenu({
  columns,
  visible,
  onChange,
}: {
  columns: ColumnChoice[]
  visible: ColumnKey[]
  onChange: (next: ColumnKey[]) => void
}) {
  const [query, setQuery] = useState('')
  const filteredColumns = columns.filter((column) => column.label.toLowerCase().includes(query.trim().toLowerCase()))
  const hiddenCount = columns.length - visible.length
  const lockedKeys = new Set<ColumnKey>(['nom', 'actions'])
  const toggle = (key: ColumnKey) => {
    if (lockedKeys.has(key)) return
    if (visible.includes(key)) {
      if (visible.length === 1) return
      onChange(visible.filter((k) => k !== key))
      return
    }
    const order = columns.map((column) => column.key)
    const insertAt = visible.findIndex((visibleKey) => order.indexOf(visibleKey) > order.indexOf(key))
    if (insertAt === -1) onChange([...visible, key])
    else onChange([...visible.slice(0, insertAt), key, ...visible.slice(insertAt)])
  }

  const moveColumn = (key: ColumnKey, direction: -1 | 1) => {
    if (key === 'nom') return
    const index = visible.indexOf(key)
    const nextIndex = index + direction
    if (index <= 0 || nextIndex <= 0 || nextIndex >= visible.length) return
    const next = [...visible]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    onChange(next)
  }

  const showAll = () => onChange(columns.map((c) => c.key))
  const showEssentials = () => onChange(columns.filter((c) => ['nom', 'telephone', 'statut', 'setter', 'dernierAppel', 'jauge', 'actions'].includes(c.key)).map((c) => c.key))

  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer inline-flex items-center gap-2 rounded-[14px] border border-line bg-white px-4 py-2 text-sm font-bold text-text shadow-sm hover:border-or hover:text-or select-none">
        <Icon name="settings" size={15} />
        Colonnes
        <span className="rounded-full bg-or-tint px-2 py-0.5 text-[11px] text-or-dark">{visible.length}/{columns.length}</span>
      </summary>
      <div className="absolute right-0 mt-3 w-[340px] max-h-[520px] overflow-hidden rounded-[22px] border border-white/70 bg-white/70 shadow-2xl shadow-text/10 backdrop-blur-2xl z-40">
        <div className="border-b border-white/50 bg-white/35 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Vue du tableau</p>
              <h4 className="font-bold">Masquer / déplacer les colonnes</h4>
              <p className="text-xs text-faint mt-1">Utilise les flèches pour déplacer les colonnes. Nom reste fixé à gauche.</p>
            </div>
            <span className="rounded-full bg-line-soft px-2.5 py-1 text-xs font-bold text-muted">{hiddenCount} masquée{hiddenCount > 1 ? 's' : ''}</span>
          </div>
          <div className="relative mt-3">
            <Icon name="search" size={14} className="absolute left-3 top-2.5 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une colonne…"
              className="w-full rounded-[12px] border border-white/70 bg-white/55 px-8 py-2 text-sm backdrop-blur-md focus:outline-none focus:border-or"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="rounded-full bg-text px-3 py-1.5 text-xs font-bold text-white" onClick={showAll}>Tout afficher</button>
            <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-muted hover:text-text" onClick={showEssentials}>Essentiel</button>
          </div>
        </div>
        <div className="max-h-[330px] overflow-auto bg-white/20 p-2 backdrop-blur-xl">
          {filteredColumns.map((column) => {
            const checked = visible.includes(column.key)
            const locked = lockedKeys.has(column.key)
            const visibleIndex = visible.indexOf(column.key)
            return (
              <div key={column.key} className="flex items-center gap-2 rounded-[14px] px-3 py-2.5 text-sm hover:bg-white/45">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggle(column.key)}
                  className="accent-[var(--color-or)]"
                />
                <button
                  type="button"
                  disabled={!checked || locked || visibleIndex <= 1}
                  onClick={() => moveColumn(column.key, -1)}
                  className="h-7 w-7 rounded-full border border-line text-xs font-bold text-muted disabled:opacity-30 disabled:cursor-not-allowed hover:text-or"
                  title="Déplacer à gauche"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={!checked || visibleIndex === -1 || visibleIndex >= visible.length - 1}
                  onClick={() => moveColumn(column.key, 1)}
                  className="h-7 w-7 rounded-full border border-line text-xs font-bold text-muted disabled:opacity-30 disabled:cursor-not-allowed hover:text-or"
                  title="Déplacer à droite"
                >
                  →
                </button>
                <label className="flex min-w-0 flex-grow cursor-pointer items-center gap-2">
                  <span className="truncate" title={column.label}>{column.label}</span>
                </label>
                {locked && <span className="rounded-full bg-cuivre-tint px-2 py-0.5 text-[10px] font-bold text-cuivre">fixe</span>}
                {!checked && !locked && <span className="text-[11px] font-semibold text-faint">masquée</span>}
              </div>
            )
          })}
        </div>
      </div>
    </details>
  )
}


function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 whitespace-nowrap bg-white/25 backdrop-blur-xl ${className}`}>{children}</th>
}

function Td({
  children,
  className = '',
  title,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  title?: string
  onClick?: React.MouseEventHandler<HTMLTableCellElement>
}) {
  return <td className={`px-4 py-3 align-middle whitespace-nowrap ${className}`} title={title} onClick={onClick}>{children}</td>
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card p-5">
      <span className="eyebrow">{label}</span>
      <div className="text-[28px] font-bold mt-2 leading-none">{value}</div>
    </div>
  )
}

function ElevenDayGauge({ jours, airtableGauge }: { jours: number | null; airtableGauge?: string | null }) {
  const rawGauge = airtableGauge?.trim()
  const rawValue = rawGauge?.match(/(\d+)\s*\/\s*11/)?.[1]
  const displayDays = rawValue ? Number(rawValue) : jours
  const safeDays = Math.max(0, displayDays ?? 0)
  const progress = Math.min(100, Math.round((safeDays / 11) * 100))
  const barColor = safeDays >= 11 ? 'bg-rouille' : safeDays >= 8 ? 'bg-or' : 'bg-success'
  const label = displayDays === null ? '0/11j' : `${Math.min(safeDays, 11)}/11j`

  return (
    <div className="min-w-[86px]" title={rawGauge || label}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted">
        <span>{label}</span>
        {safeDays >= 11 && <span className="text-rouille">Urgent</span>}
      </div>
      <div className="mt-1 h-2 rounded-full bg-line-soft overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

function DailyCallGauge({ count }: { count: number }) {
  const safeCount = Math.max(0, count)
  const progress = Math.min(100, Math.round((safeCount / 4) * 100))
  const color = safeCount >= 4 ? 'bg-success' : safeCount >= 2 ? 'bg-or' : 'bg-rouille'
  return (
    <div className="min-w-[92px]" title={`${safeCount}/4 appels aujourd'hui`}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted">
        <span>{safeCount}/4</span>
        <span>jour</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-line-soft overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

function PhoneCell({ lead, onStartCall }: { lead: LeadResponse; onStartCall: ReturnType<typeof useStartCall> }) {
  if (!lead.phone) return <span className="text-faint">—</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onStartCall({ leadId: lead.id, leadName: fullName(lead), toNumber: lead.phone! }).catch((err) => {
          console.error('Phone copy failed', err)
          alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')
        })
      }}
      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-bold text-text hover:border-or hover:text-or"
      title="Copier le numéro pour appeler"
    >
      <Icon name="phone" size={13} />
      <span className="truncate">{lead.phone}</span>
    </button>
  )
}

function LeadCommentButton({
  comment,
  leadName,
  onOpen,
}: {
  comment: string | null
  leadName: string
  onOpen: (data: { leadName: string; comment: string }) => void
}) {
  if (!comment) {
    return (
      <span
        className="w-8 h-8 rounded-full border border-line text-faint flex flex-shrink-0 items-center justify-center"
        title="Aucun commentaire"
      >
        <Icon name="message" size={14} />
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen({ leadName, comment })
      }}
      className="w-8 h-8 rounded-full bg-info-tint text-info flex flex-shrink-0 items-center justify-center hover:bg-info hover:text-white transition-colors"
      title="Voir le commentaire"
      aria-label="Voir le commentaire"
    >
      <Icon name="message" size={15} />
    </button>
  )
}

function CommentModal({ data, onClose }: { data: { leadName: string; comment: string } | null; onClose: () => void }) {
  if (!data) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/35 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-[24px] bg-white shadow-2xl border border-line p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-info-tint text-info flex items-center justify-center flex-shrink-0">
            <Icon name="message" size={18} />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">COMMENTAIRE</p>
            <h3 className="font-bold truncate" title={data.leadName}>{data.leadName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto w-8 h-8 rounded-full border border-line text-muted flex items-center justify-center hover:bg-line-soft"
            aria-label="Fermer"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="text-sm leading-6 text-text whitespace-pre-wrap break-words">{data.comment}</p>
      </div>
    </div>
  )
}

function PersonChip({ name, tint }: { name: string; tint: string }) {
  const parts = name.split(' ').filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-6 h-6 rounded-full ${tint} flex flex-shrink-0 items-center justify-center text-[10px] font-bold`}>{inits}</div>
      <span className="truncate" title={name}>{name}</span>
    </div>
  )
}

function SetterChips({ lead, userMap }: { lead: LeadResponse; userMap: Map<string, UserResponse> | Map<string, string> }) {
  const ids = lead.assignedSetterIds?.length ? lead.assignedSetterIds : (lead.setterId ? [lead.setterId] : [])
  const names = ids
    .map((id) => {
      const user = userMap.get(id)
      return typeof user === 'string' ? user : user?.name
    })
    .filter((name): name is string => Boolean(name))

  if (names.length === 0) return <span className="text-faint">—</span>

  return (
    <div className="flex items-center gap-1.5 min-w-0" title={names.join(', ')}>
      <PersonChip name={names[0]} tint="bg-cuivre-tint" />
      {names.length > 1 && (
        <span className="rounded-full bg-line-soft px-2 py-1 text-[11px] font-bold text-muted flex-shrink-0">
          +{names.length - 1}
        </span>
      )}
    </div>
  )
}
