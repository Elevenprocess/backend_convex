import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon, type IconName } from '../../components/Icon'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Spinner'
import { useAuth } from '../../lib/auth'
import { deleteLead, useLeadStats, useLeads, useLeadsProgressive, useUsers, useStartCall, useRdvList } from '../../lib/hooks'
import { useLeadSidebar } from '../../lib/leadSidebar'
import { emitLeadDeselect, emitLeadSelect, useLeadLocks, type LeadLockInfo } from '../../lib/realtime'
import { DossierCard } from '../../components/suivi/DossierCard'
import { buildDossiers, readWorkflowState } from '../../lib/suivi'
import { DEFAULT_LEAD_FILTERS, applyLeadFilters, leadFiltersActive, matchesLeadDateRange, sortCallbackLeadsByNextCallback, type LeadArrivedAtFilter, type LeadDateField, type LeadHasFilter, type LeadLastCallFilter, type LeadListFilters } from '../../lib/leadFilters'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  cleanField,
  fullName,
  initials,
  type LeadResponse,
  type LeadStatus,
  type Role,
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
  { key: 'prochainRappel', label: 'Date/heure prochain rappel' },
  { key: 'dateArrivee', label: "Date/heure d'arrivée" },
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
const ADMIN_DEFAULT_COLUMNS: ColumnKey[] = [
  'nom',
  'telephone',
  'statut',
  'leadGenere',
  'setter',
  'dernierAppel',
  'jaugeAppels',
  'prochainRappel',
  'rdv',
  'commercialRdv',
  'actions',
]


export function LeadsList() {
  const role = useAuth((s) => s.user?.role)
  if (role === 'admin') return <LeadsAdmin />
  // Les commerciaux ont leur propre URL (/client) et leur propre fichier
  // (pages/clients/ClientsList.tsx). On les y redirige depuis /leads pour
  // garder l'ancienne URL fonctionnelle (notifications, deep links…).
  if (role === 'commercial' || role === 'commercial_lead') return <Navigate to="/client" replace />
  if (role === 'delivrabilite' || role === 'responsable_technique' || role === 'back_office' || role === 'technicien') return <LeadsSuivi />
  return <LeadsSetter />
}

function LeadsSuivi() {
  const navigate = useNavigate()
  const { data: leadsData, loading, error } = useLeads({ limit: 500 })
  const { data: rdvsData, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: usersData } = useUsers()
  const [query, setQuery] = useState('')
  const dossiers = useMemo(() => {
    const states = Object.fromEntries((leadsData ?? []).map((lead) => [lead.id, readWorkflowState(lead.id)]))
    return buildDossiers(leadsData ?? [], rdvsData ?? [], usersData ?? [], states)
  }, [leadsData, rdvsData, usersData])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return dossiers
    return dossiers.filter((d) => [fullName(d.lead), d.lead.phone, d.lead.email, d.lead.city, d.commercial?.name].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [dossiers, query])

  return (
    <AppShell>
      <Topbar eyebrow="LEADS / DÉLIVRABILITÉ" title="Dossiers signés" />
      <main className="suivi-page p-4 sm:p-6 md:p-8 flex-grow overflow-auto">
        <div className="mb-4 glass-card !p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <span className="eyebrow text-[10px]">Vue dossier Délivrabilité</span>
            <h2 className="text-lg font-black">Tous les prospects signés en cards</h2>
            <p className="text-xs text-muted">Clique sur une card pour ouvrir la fiche prospect complète, puis le workflow du dossier sélectionné.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input
              type="search"
              placeholder="Rechercher prospect…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="suivi-search"
            />
            <button type="button" onClick={() => navigate('/suivi')} className="rounded-full bg-success text-white px-4 py-2 text-xs font-black">Suivi global</button>
          </div>
        </div>
        {(loading || rdvLoading) && filtered.length === 0 ? <LoadingBlock label="Chargement dossiers signés…" /> : error ? (
          <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="users" title="Aucun dossier signé" description="Dès qu'un RDV est signé, le dossier apparaît ici pour la Délivrabilité." />
        ) : (
          <section className="suivi-grid">
            {filtered.map((dossier) => (
              <DossierCard key={dossier.id} dossier={dossier} onClick={() => navigate(`/suivi/${dossier.id}`)} />
            ))}
          </section>
        )}
      </main>
    </AppShell>
  )
}


type SetterFilter = 'nouveau' | 'sans_reponse' | 'rappel' | 'qualifie' | 'perdu' | 'relance_lt'
type SetterMissingFilter = 'all' | 'any' | 'phone' | 'address' | 'postalCode' | 'email' | 'city'

const SETTER_MISSING_FILTERS: { key: SetterMissingFilter; label: string; icon: IconName }[] = [
  { key: 'all', label: 'Toutes les données', icon: 'inbox' },
  { key: 'any', label: 'Donnée manquante', icon: 'filter' },
  { key: 'phone', label: 'Sans numéro', icon: 'phone-off' },
  { key: 'address', label: 'Sans adresse', icon: 'map-pin' },
  { key: 'postalCode', label: 'Sans CP', icon: 'tag' },
  { key: 'email', label: 'Sans email', icon: 'mail' },
  { key: 'city', label: 'Sans ville', icon: 'map-pin' },
]

const SETTER_STATUS_FILTERS: { key: SetterFilter; label: string; icon: IconName; countKey: 'nouveau' | 'sansReponse' | 'rappel' | 'qualifie' | 'perdu' | 'relanceLt' }[] = [
  { key: 'nouveau', label: 'Nouveaux', icon: 'sparkles', countKey: 'nouveau' },
  { key: 'sans_reponse', label: 'Sans réponse', icon: 'phone-off', countKey: 'sansReponse' },
  { key: 'rappel', label: 'À rappeler', icon: 'phone', countKey: 'rappel' },
  { key: 'qualifie', label: 'Qualifiés', icon: 'check', countKey: 'qualifie' },
  { key: 'perdu', label: 'Non qualifiés', icon: 'x', countKey: 'perdu' },
  { key: 'relance_lt', label: 'Relance long terme', icon: 'clock', countKey: 'relanceLt' },
]

// ----- F5 Setter -----

function LeadsSetter() {
  const me = useAuth((s) => s.user)
  const [filter, setFilter] = useState<SetterFilter>('nouveau')
  const [missingFilter, setMissingFilter] = useState<SetterMissingFilter>('all')
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('search') ?? '')
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  const leadLocks = useLeadLocks()

  // Émet "lead:select" quand un lead devient sélectionné, "lead:deselect"
  // quand on passe à un autre / quitte / unmount. Permet aux autres setters
  // de voir une marque grisée sur le lead en cours.
  useEffect(() => {
    if (!selectedId || !me?.id) return
    const setterName = me.name || me.email || 'Setter'
    emitLeadSelect(selectedId, me.id, setterName)
    return () => emitLeadDeselect(selectedId)
  }, [selectedId, me?.id, me?.name, me?.email])
  const [openComment, setOpenComment] = useState<{ leadName: string; comment: string } | null>(null)
  const [visibleColumns, setVisibleColumns] = useColumnVisibility('ecoi.leads.setter.columns.v5', SETTER_COLUMNS)
  const startCall = useStartCall()
  const orderedColumns = useOrderedColumns(SETTER_COLUMNS, visibleColumns)
  const setterTableWidth = useMemo(
    () => orderedColumns.reduce((total, column) => total + setterColumnWidth(column.key), 0),
    [orderedColumns],
  )
  // Côté setter, l'écran s'ouvre directement sur les nouveaux leads.
  // Le filtre global "Tous" n'est pas affiché aux setters.
  // On reste dans la limite backend (/leads max 500) pour éviter les erreurs 400.
  const baseLeadsState = useLeadsProgressive({ quickLimit: 100, fullLimit: 500 })
  const searchTerm = query.trim()
  const searchLeadsState = useLeadsProgressive(searchTerm ? { quickLimit: 100, fullLimit: 500, search: searchTerm } : null)
  const data = searchTerm ? searchLeadsState.data : baseLeadsState.data
  const loading = searchTerm ? searchLeadsState.loading : baseLeadsState.loading
  const error = searchTerm ? searchLeadsState.error : baseLeadsState.error
  const backgroundLoading = searchTerm ? searchLeadsState.backgroundLoading : baseLeadsState.backgroundLoading
  const { data: usersList } = useUsers()
  const mine = data ?? []
  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of usersList ?? []) m.set(u.id, u)
    return m
  }, [usersList])

  const categoryLeads = mine

  const counts = useMemo(() => ({
    all: categoryLeads.length,
    nouveau: categoryLeads.filter(isNouveauLead).length,
    sansReponse: categoryLeads.filter(isShortTermSansReponseLead).length,
    rappel: categoryLeads.filter(isCallbackLead).length,
    qualifie: categoryLeads.filter(isQualifiedLeadStatus).length,
    perdu: categoryLeads.filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie').length,
    relanceLt: categoryLeads.filter(isLongTermRelanceLead).length,
  }), [categoryLeads])

  const missingCounts = useMemo(() => {
    const withinStatus = filterSetterLeadsByStatus(categoryLeads, filter)
    return Object.fromEntries(
      SETTER_MISSING_FILTERS.map((item) => [item.key, withinStatus.filter((lead) => matchesMissingFilter(lead, item.key)).length]),
    ) as Record<SetterMissingFilter, number>
  }, [categoryLeads, filter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qPhoneVariants = phoneSearchVariants(q)
    // Si une recherche est saisie, elle doit être globale sur toutes les catégories
    // setter, même si l’onglet actif est "Nouveaux", "À rappeler", etc.
    let list = q ? categoryLeads : filterSetterLeadsByStatus(categoryLeads, filter)
    if (missingFilter !== 'all') list = list.filter((l) => matchesMissingFilter(l, missingFilter))
    if (q) {
      list = list.filter((l) => {
        const textMatch = [fullName(l), l.phone, l.email, l.city].filter(Boolean).join(' ').toLowerCase().includes(q)
        const leadPhoneVariants = phoneSearchVariants(l.phone ?? '')
        const phoneMatch = qPhoneVariants.some((queryPhone) =>
          leadPhoneVariants.some((leadPhone) => leadPhone.includes(queryPhone) || queryPhone.includes(leadPhone)),
        )
        return textMatch || phoneMatch
      })
    }
    // Onglet "À rappeler" : on trie par date de prochain rappel (futurs proches en haut,
    // en retard regroupés en bas). On ne le fait pas en recherche globale (liste multi-catégories).
    if (!q && filter === 'rappel') list = sortCallbackLeadsByNextCallback(list)
    return list
  }, [categoryLeads, filter, missingFilter, query])

  const selected = useMemo(
    () => (selectedId ? mine.find((l) => l.id === selectedId) ?? null : null),
    [mine, selectedId],
  )
  const tableScrollRef = useRememberedLeadTableScroll('ecoi.leads.setter.tableScroll.v1', filtered, selectedId)

  return (
    <AppShell>
      <Topbar
        eyebrow="LEADS / SETTER"
        title="Suivi leads"
      />
      <div className="flex flex-grow overflow-hidden">
        <LeadsRail
          statusFilters={SETTER_STATUS_FILTERS}
          missingFilters={SETTER_MISSING_FILTERS}
          filter={filter}
          missingFilter={missingFilter}
          onFilter={setFilter}
          onMissingFilter={setMissingFilter}
          counts={counts}
          missingCounts={missingCounts}
        />

        <div className="flex-grow flex flex-col min-w-0">
          <div className="px-4 sm:px-8 pt-4 flex items-center gap-3 flex-shrink-0 flex-wrap">
            <div className="relative flex-grow max-w-sm min-w-[200px]">
              <Icon name="search" size={16} className="absolute left-3 top-2.5 text-faint" />
              <input
                type="text"
                placeholder="Rechercher un lead…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-white border border-line rounded-[14px] pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-or"
              />
            </div>

            <span className="text-xs text-faint font-semibold ml-auto">{filtered.length}/{categoryLeads.length}</span>
            <ColumnVisibilityMenu columns={SETTER_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
            {(loading || backgroundLoading) && mine.length > 0 && <span className="text-xs text-faint">Actualisation…</span>}
          </div>

          <main className="p-3 pt-3 sm:p-8 sm:pt-4 flex-grow flex flex-col min-h-0 overflow-hidden">

            {loading && mine.length === 0 ? (
              <LoadingBlock label="Chargement des leads…" />
            ) : error ? (
              <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
            ) : filtered.length === 0 ? (
              <div className="py-16">
                <EmptyState
                  icon="users"
                  title={mine.length === 0 ? 'Aucun lead pour le moment' : 'Aucun lead ne correspond'}
                  description={mine.length === 0 ? "Aucun lead disponible pour le moment." : 'Aucun lead ne correspond à cette catégorie.'}
                  secondaryAction={{ label: 'Voir les nouveaux leads', onClick: () => { setFilter('nouveau'); setMissingFilter('all'); setQuery('') } }}
                />
              </div>
            ) : (
              <div className="glass-card !p-0 overflow-hidden flex-grow min-h-0">
                <div ref={tableScrollRef} data-preserve-scroll="true" className="overflow-auto h-full">
                <table className="text-sm table-fixed lead-table" style={{ width: `${setterTableWidth}px` }}>
                  <colgroup>
                    {orderedColumns.map((column) => (
                      <col key={column.key} style={{ width: `${setterColumnWidth(column.key)}px` }} />
                    ))}
                  </colgroup>
                  <thead className="text-left eyebrow sticky top-0 z-10 border-b border-white/60 bg-white/65 shadow-sm shadow-text/5 backdrop-blur-2xl">
                    <tr>
                      {orderedColumns.map((column) => renderSetterHeader(column.key))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => {
                      const lockedBy = leadLocks.get(l.id)
                      const lockedByOther = lockedBy && lockedBy.setterId !== me?.id
                      return (
                        <tr
                          key={l.id}
                          data-lead-id={l.id}
                          className={`border-b border-line-soft last:border-0 cursor-pointer transition-colors ${
                            selected?.id === l.id ? 'bg-or/20 shadow-[inset_4px_0_0_var(--color-or-dark)] !text-text' :
                            lockedByOther ? 'bg-line-soft/40 opacity-60' : 'hover:bg-white/40'
                          }`}
                          title={lockedByOther ? `${lockedBy!.setterName} est en train de bosser sur ce lead` : undefined}
                          onClick={() => selectLead(l.id)}
                        >
                          {orderedColumns.map((column) => renderSetterCell(column.key, l, userMap, startCall, setOpenComment, lockedByOther ? lockedBy : null))}
                        </tr>
                      )
                    })}
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
  const [visibleColumns, setVisibleColumns] = useColumnVisibility('ecoi.leads.admin.columns.v6', ADMIN_COLUMNS, ADMIN_DEFAULT_COLUMNS)
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  const clearLead = useLeadSidebar((s) => s.clearLead)
  const orderedColumns = useOrderedColumns(ADMIN_COLUMNS, visibleColumns)
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])

  const { data: leadsData, loading, error, backgroundLoading, refetch } = useLeadsProgressive({ quickLimit: 100, fullLimit: 500 })
  const { data: leadStats } = useLeadStats()
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

  const stats = useMemo(() => {
    const byStatus = leadStats?.byStatus
    if (leadStats && byStatus) {
      return {
        total: leadStats.total,
        imported: leadStats.imported,
        directGhl: leadStats.directGhl,
        qualifies: (byStatus.qualifie ?? 0) + (byStatus.rdv_pris ?? 0) + (byStatus.rdv_honore ?? 0) + (byStatus.signe ?? 0),
        waiting: (byStatus.nouveau ?? 0) + (byStatus.a_rappeler ?? 0) + (byStatus.relance ?? 0),
        perdus: (byStatus.perdu ?? 0) + (byStatus.pas_qualifie ?? 0),
      }
    }
    return {
      total: (leads ?? []).length,
      imported: (leads ?? []).filter((l) => l.source === 'ghl' || l.source === 'airtable_migration').length,
      directGhl: (leads ?? []).filter((l) => l.source === 'ghl').length,
      qualifies: (leads ?? []).filter((l) =>
        l.status === 'qualifie' || l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe',
      ).length,
      waiting: (leads ?? []).filter((l) => l.status === 'nouveau' || l.status === 'a_rappeler' || l.status === 'relance').length,
      perdus: (leads ?? []).filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie').length,
    }
  }, [leadStats, leads])
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
      <div className="flex flex-grow overflow-hidden">
        <AdminLeadsRail
          leads={leads}
          leadFilters={leadFilters}
          setLeadFilters={setLeadFilters}
          setterFilter={setterFilter}
          setSetterFilter={setSetterFilter}
          commercialFilter={commercialFilter}
          setCommercialFilter={setCommercialFilter}
          setters={setters}
          commerciaux={commerciaux}
        />

        <div className="flex-grow flex flex-col min-w-0">
          <div className="px-4 sm:px-8 pt-4 flex items-center gap-3 flex-shrink-0 flex-wrap">
            <span className="text-xs text-faint font-semibold">{filtered.length}/{(leads ?? []).length}</span>
            {leadFiltersActive(leadFilters) || setterFilter !== 'all' || commercialFilter !== 'all' ? (
              <button
                type="button"
                onClick={() => { setLeadFilters(DEFAULT_LEAD_FILTERS); setSetterFilter('all'); setCommercialFilter('all') }}
                className="text-xs font-bold text-muted underline underline-offset-4"
              >
                Réinitialiser les filtres
              </button>
            ) : null}
            <ColumnVisibilityMenu columns={ADMIN_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
            {(loading || backgroundLoading) && leads.length > 0 && <span className="text-xs text-faint">{backgroundLoading ? `100 premiers affichés, hydratation du reste (${leads.length.toLocaleString('fr-FR')} visibles)…` : 'Actualisation…'}</span>}
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

      <main className="p-4 sm:p-8 pt-3 flex-grow flex flex-col min-h-0 overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3 flex-shrink-0">
          <StatCard label="TOTAL IMPORTÉ" value={stats.total.toLocaleString('fr-FR')} />
          <StatCard label="IMPORT DIRECT GHL" value={stats.directGhl.toLocaleString('fr-FR')} />
          <StatCard label="QUALIFIÉS" value={stats.qualifies.toLocaleString('fr-FR')} />
          <StatCard label="NON QUALIFIÉS" value={stats.perdus.toLocaleString('fr-FR')} />
        </div>

        {loading && leads.length === 0 ? (
          <LoadingBlock label="Chargement des leads…" />
        ) : error ? (
          <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-faint text-sm">Aucun lead ne correspond aux filtres.</div>
        ) : (
          <div className="glass-card !p-0 overflow-hidden flex-grow min-h-0">
            <div ref={tableScrollRef} data-preserve-scroll="true" className="overflow-auto h-full">
            <table className="min-w-[1800px] w-full text-sm table-fixed lead-table">
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
        </div>
      </div>
      <CommentModal data={openComment} onClose={() => setOpenComment(null)} />
    </AppShell>
  )
}

// ===== Helpers =====

function isCallbackLead(lead: LeadResponse): boolean {
  return lead.status === 'a_rappeler' || lead.status === 'relance'
}

function isNouveauLead(lead: LeadResponse): boolean {
  return lead.status === 'nouveau'
}

function isQualifiedLeadStatus(lead: LeadResponse): boolean {
  return lead.status === 'qualifie' || lead.status === 'rdv_pris'
}

const RELANCE_LONG_TERM_THRESHOLD = 11

function isLongTermRelanceLead(lead: LeadResponse): boolean {
  return lead.status === 'pas_de_reponse' && (lead.joursRelance ?? 0) >= RELANCE_LONG_TERM_THRESHOLD
}

function isShortTermSansReponseLead(lead: LeadResponse): boolean {
  return lead.status === 'pas_de_reponse' && (lead.joursRelance ?? 0) < RELANCE_LONG_TERM_THRESHOLD
}

function filterSetterLeadsByStatus(leads: LeadResponse[], filter: SetterFilter): LeadResponse[] {
  switch (filter) {
    case 'nouveau':
      return leads.filter(isNouveauLead)
    case 'sans_reponse':
      return leads.filter(isShortTermSansReponseLead)
    case 'rappel':
      return leads.filter(isCallbackLead)
    case 'qualifie':
      return leads.filter(isQualifiedLeadStatus)
    case 'perdu':
      return leads.filter((lead) => lead.status === 'perdu' || lead.status === 'pas_qualifie')
    case 'relance_lt':
      return leads.filter(isLongTermRelanceLead)
  }
}

function matchesMissingFilter(lead: LeadResponse, filter: SetterMissingFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'any':
      return !hasValue(lead.phone) || !hasValue(lead.addressLine) || !hasValue(lead.postalCode) || !hasValue(lead.email) || !hasValue(lead.city)
    case 'phone':
      return !hasValue(lead.phone)
    case 'address':
      return !hasValue(lead.addressLine)
    case 'postalCode':
      return !hasValue(lead.postalCode)
    case 'email':
      return !hasValue(lead.email)
    case 'city':
      return !hasValue(lead.city)
  }
}

function hasValue(value: string | null | undefined): boolean {
  return Boolean(cleanField(value))
}

function normalizePhoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function phoneSearchVariants(value: string): string[] {
  const digits = normalizePhoneDigits(value)
  if (digits.length < 4) return []
  const variants = new Set<string>([digits])
  if (digits.startsWith('262') && digits.length > 3) variants.add(`0${digits.slice(3)}`)
  if (digits.startsWith('33') && digits.length > 2) variants.add(`0${digits.slice(2)}`)
  if (digits.length >= 8) variants.add(digits.slice(-8))
  if (digits.length >= 9) variants.add(digits.slice(-9))
  return Array.from(variants).filter((variant) => variant.length >= 4)
}


// Statut côté setter = 3 buckets visibles :
//   "Qualifié" (job du setter terminé)
//   "Non qualifié" (lead clôturé en perte)
//   "En attente" (pas encore qualifié — nouveau, relance, à rappeler, pas de réponse)
function setterBucketForLead(lead: LeadResponse): 'qualifie' | 'non_qualifie' | 'en_attente' {
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'non_qualifie'
  if (lead.status === 'qualifie' || lead.status === 'rdv_pris' || lead.status === 'rdv_honore' || lead.status === 'signe') return 'qualifie'
  return 'en_attente'
}

// Statut côté commercial = 5 buckets visibles :
//   "Signature en cours" (en train de signer)
//   "Signé" (vente conclue)
//   "Perdu" (RDV finalement perdu / non qualifié)
//   "En attente" (RDV passé au commercial mais pas encore signé)
function commercialBucketForLead(
  lead: LeadResponse,
): 'signature_en_cours' | 'signe' | 'perdu' | 'non_qualifie' | 'en_attente' {
  if (lead.status === 'signe') return 'signe'
  if (lead.status === 'signature_en_cours') return 'signature_en_cours'
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'perdu'
  return 'en_attente'
}

const BUCKET_LABEL: Record<'qualifie' | 'signature_en_cours' | 'signe' | 'perdu' | 'non_qualifie' | 'en_attente', string> = {
  qualifie: 'Qualifié',
  signature_en_cours: 'Signature en cours',
  signe: 'Signé',
  perdu: 'Perdu',
  non_qualifie: 'Non qualifié',
  en_attente: 'En attente',
}

const BUCKET_BADGE: Record<'qualifie' | 'signature_en_cours' | 'signe' | 'perdu' | 'non_qualifie' | 'en_attente', string> = {
  qualifie: 'bg-success-tint text-success',
  signature_en_cours: 'bg-cuivre-tint text-cuivre',
  signe: 'bg-success-tint text-success',
  perdu: 'bg-rouille-tint text-rouille',
  non_qualifie: 'bg-rouille-tint text-rouille',
  en_attente: 'bg-cuivre-tint text-cuivre',
}

function statusLabelForLead(lead: LeadResponse, role?: Role | null): string {
  if (role === 'setter') return BUCKET_LABEL[setterBucketForLead(lead)]
  if (role === 'commercial') return BUCKET_LABEL[commercialBucketForLead(lead)]
  // admin (et défaut) : labels granulaires, juste perdu/pas_qualifie coalescés
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'Non qualifié'
  return STATUS_LABEL[lead.status]
}

function statusBadgeForLead(lead: LeadResponse, role?: Role | null): string {
  if (role === 'setter') return BUCKET_BADGE[setterBucketForLead(lead)]
  if (role === 'commercial') return BUCKET_BADGE[commercialBucketForLead(lead)]
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

function leadArrivalDate(lead: Pick<LeadResponse, 'createdAt' | 'arrivalAt'>): string {
  return lead.arrivalAt || lead.createdAt
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

function setterColumnWidth(key: ColumnKey): number {
  switch (key) {
    case 'nom': return 240
    case 'telephone': return 200
    case 'prochainRappel': return 200
    case 'dateArrivee': return 180
    case 'adresseComplete': return 260
    case 'setter': return 210
    case 'jaugeAppels': return 160
    case 'dernierAppel': return 170
    case 'statut': return 160
    case 'appelDate': return 190
    case 'jauge': return 160
    case 'logAppel': return 120
    case 'appelsCommercial': return 220
    default: return 160
  }
}

function renderSetterHeader(key: ColumnKey) {
  switch (key) {
    case 'nom': return <Th key={key} className="w-[240px] lead-sticky-head">NOM</Th>
    case 'telephone': return <Th key={key} className="w-[200px]">TÉLÉPHONE DU PROSPECT</Th>
    case 'prochainRappel': return <Th key={key} className="w-[200px]">DATE/HEURE PROCHAIN RAPPEL</Th>
    case 'dateArrivee': return <Th key={key} className="w-[180px]">DATE/HEURE D'ARRIVÉE</Th>
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
  lockedBy?: LeadLockInfo | null,
) {
  switch (key) {
    case 'nom':
      return (
        <Td key={key} className="lead-sticky-cell">
          <div className="flex items-center gap-3 min-w-0">
            <LeadCommentButton comment={lead.latestCallComment} leadName={fullName(lead)} onOpen={setOpenComment} />
            <div className="lead-avatar" data-shade={leadAvatarShade(lead.id)}>{initials(lead)}</div>
            <div className="min-w-0 flex flex-col leading-tight">
              <span className="lead-name-text" title={fullName(lead)}>{fullName(lead)}</span>
              {lockedBy ? (
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-cuivre flex items-center gap-1" title={`${lockedBy.setterName} est en cours sur ce lead`}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cuivre opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cuivre" />
                  </span>
                  {lockedBy.setterName} en cours
                </span>
              ) : lead.city && (
                <span className="lead-name-sub" title={lead.city}>{lead.city}</span>
              )}
            </div>
          </div>
        </Td>
      )
    case 'telephone': return <Td key={key} className="min-w-[200px]"><PhoneCell lead={lead} onStartCall={startCall} /></Td>
    case 'prochainRappel': return <Td key={key} className="text-faint">{lead.nextCallbackAt ? fullDateTime(lead.nextCallbackAt) : '—'}</Td>
    case 'dateArrivee': return <Td key={key} className="text-faint">{fullDateTime(leadArrivalDate(lead))}</Td>
    case 'adresseComplete': return <Td key={key} className="text-muted truncate" title={addressFull(lead)}>{addressFull(lead)}</Td>
    case 'setter': return <Td key={key}><SetterChips lead={lead} userMap={userMap} /></Td>
    case 'jaugeAppels': return <Td key={key}><DailyCallGauge count={lead.callsToday ?? 0} /></Td>
    case 'dernierAppel': return <Td key={key} className="text-faint">{lastCallDateTime(lead.latestCallAt ?? lead.lastContactAt)}</Td>
    case 'statut': return <Td key={key}><span className={`status-badge ${statusBadgeForLead(lead, 'setter')}`}>{statusLabelForLead(lead, 'setter')}</span></Td>
    case 'appelDate': return <Td key={key} className="text-faint">{lastCallDateTime(lead.latestCallAt ?? lead.lastContactAt)}</Td>
    case 'jauge': return <Td key={key}><ElevenDayGauge jours={lead.joursRelance} /></Td>
    case 'logAppel': return <Td key={key}><LeadCommentButton comment={lead.latestCallComment} leadName={fullName(lead)} onOpen={setOpenComment} /></Td>
    case 'appelsCommercial': return <Td key={key} className="text-muted truncate" title={commercialLabel(lead, userMap)}>{commercialLabel(lead, userMap)}</Td>
    default: return null
  }
}

function renderAdminHeader(key: ColumnKey) {
  switch (key) {
    case 'nom': return <Th key={key} className="w-[190px] lead-sticky-head">NOM</Th>
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
    case 'nom': return <Td key={key} className="lead-sticky-cell"><span className="block max-w-[155px] font-semibold truncate" title={fullName(lead)}>{fullName(lead)}</span></Td>
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
    case 'jauge': return <Td key={key}><ElevenDayGauge jours={lead.joursRelance} /></Td>
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

// Index 0–5 stable dérivé de l'id pour varier les nuances d'avatar lead (look Linear/Notion).
function leadAvatarShade(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash) % 6
}

export function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`pill-tab ${active ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}
    >
      {children}
    </button>
  )
}

const LEADS_RAIL_COLLAPSED_KEY = 'ecoi.leads.setter.rail.collapsed'

function LeadsRail({
  statusFilters,
  missingFilters,
  filter,
  missingFilter,
  onFilter,
  onMissingFilter,
  counts,
  missingCounts,
}: {
  statusFilters: typeof SETTER_STATUS_FILTERS
  missingFilters: typeof SETTER_MISSING_FILTERS
  filter: SetterFilter
  missingFilter: SetterMissingFilter
  onFilter: (f: SetterFilter) => void
  onMissingFilter: (f: SetterMissingFilter) => void
  counts: Record<string, number>
  missingCounts: Record<SetterMissingFilter, number>
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(LEADS_RAIL_COLLAPSED_KEY) === '1'
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(LEADS_RAIL_COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <aside className={`leads-rail hidden lg:flex ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="leads-rail-toggle-row">
        <button
          type="button"
          onClick={toggle}
          className="leads-rail-toggle"
          title={collapsed ? 'Étendre les filtres' : 'Réduire les filtres'}
          aria-label={collapsed ? 'Étendre les filtres' : 'Réduire les filtres'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {collapsed ? <polyline points="9 6 15 12 9 18" /> : <polyline points="15 6 9 12 15 18" />}
          </svg>
        </button>
      </div>

      {collapsed ? (
        <>
          <div className="leads-rail-collapsed-group">
            {statusFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilter(item.key)}
                className={`leads-rail-mini ${filter === item.key ? 'is-active' : ''}`}
                title={`${item.label} (${counts[item.countKey]})`}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={16} strokeWidth={1.75} />
                {counts[item.countKey] > 0 && (
                  <span className="leads-rail-mini-dot">{counts[item.countKey] > 99 ? '99+' : counts[item.countKey]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="leads-rail-collapsed-sep" />
          <div className="leads-rail-collapsed-group">
            {missingFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onMissingFilter(item.key)}
                className={`leads-rail-mini ${missingFilter === item.key ? 'is-active' : ''}`}
                title={`${item.label} (${missingCounts[item.key]})`}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={16} strokeWidth={1.75} />
                {missingCounts[item.key] > 0 && (
                  <span className="leads-rail-mini-dot">{missingCounts[item.key] > 99 ? '99+' : missingCounts[item.key]}</span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <CollapsibleSection storageKey="ecoi.leads.setter.section.statut" label="Statut">
            {statusFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilter(item.key)}
                className={`sb-item leads-rail-item ${filter === item.key ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">{item.label}</span>
                <span className="leads-rail-count">{counts[item.countKey]}</span>
              </button>
            ))}
          </CollapsibleSection>
          <CollapsibleSection storageKey="ecoi.leads.setter.section.donnees" label="Données">
            {missingFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onMissingFilter(item.key)}
                className={`sb-item leads-rail-item ${missingFilter === item.key ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">{item.label}</span>
                <span className="leads-rail-count">{missingCounts[item.key]}</span>
              </button>
            ))}
          </CollapsibleSection>
        </>
      )}
    </aside>
  )
}

const ADMIN_RAIL_COLLAPSED_KEY = 'ecoi.leads.admin.rail.collapsed'

const ADMIN_STATUS_FILTERS: Array<{ key: 'all' | LeadStatus; label: string; icon: IconName }> = [
  { key: 'all', label: 'Tous statuts', icon: 'inbox' },
  { key: 'nouveau', label: 'Nouveau', icon: 'sparkles' },
  { key: 'qualifie', label: 'Qualifié', icon: 'check' },
  { key: 'a_rappeler', label: 'À rappeler', icon: 'phone' },
  { key: 'pas_de_reponse', label: 'Sans réponse', icon: 'phone-off' },
  { key: 'pas_qualifie', label: 'Non qualifié', icon: 'x' },
  { key: 'rdv_honore', label: 'RDV honoré', icon: 'calendar' },
  { key: 'signe', label: 'Signé', icon: 'check' },
  { key: 'perdu', label: 'Perdu', icon: 'x' },
  { key: 'relance', label: 'Relance', icon: 'clock' },
]

const ADMIN_LAST_CALL_FILTERS: Array<{ key: LeadLastCallFilter; label: string; icon: IconName }> = [
  { key: 'all', label: 'Tous', icon: 'inbox' },
  { key: 'never', label: 'Jamais appelé', icon: 'phone-off' },
  { key: 'today', label: "Aujourd'hui", icon: 'phone' },
  { key: 'older_3d', label: '≥ 3 jours sans appel', icon: 'clock' },
  { key: 'older_7d', label: '≥ 7 jours sans appel', icon: 'clock' },
]

const ADMIN_DATE_RANGE_FILTERS: Array<{ key: LeadArrivedAtFilter; label: string; icon: IconName }> = [
  { key: 'all', label: 'Toutes dates', icon: 'inbox' },
  { key: 'today', label: "Aujourd'hui", icon: 'calendar' },
  { key: 'yesterday', label: 'Hier', icon: 'calendar' },
  { key: 'this_week', label: 'Cette semaine', icon: 'calendar' },
  { key: 'last_week', label: 'Semaine dernière', icon: 'calendar' },
  { key: 'this_month', label: 'Ce mois-ci', icon: 'calendar' },
  { key: 'last_month', label: 'Mois dernier', icon: 'calendar' },
]

const ADMIN_DATE_FIELD_FILTERS: Array<{ key: LeadDateField; label: string; icon: IconName }> = [
  { key: 'arrival', label: 'Arrivée du lead', icon: 'inbox' },
  { key: 'devis', label: 'Date du devis', icon: 'tag' },
  { key: 'debrief', label: 'Date du débrief', icon: 'message' },
  { key: 'call', label: 'Dernier appel', icon: 'phone' },
]

const ADMIN_HAS_FILTERS: Array<{ key: LeadHasFilter; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'with', label: 'Avec' },
  { key: 'without', label: 'Sans' },
]

function AdminLeadsRail({
  leads,
  leadFilters,
  setLeadFilters,
  setterFilter,
  setSetterFilter,
  commercialFilter,
  setCommercialFilter,
  setters,
  commerciaux,
}: {
  leads: LeadResponse[]
  leadFilters: LeadListFilters
  setLeadFilters: (f: LeadListFilters) => void
  setterFilter: string
  setSetterFilter: (id: string) => void
  commercialFilter: string
  setCommercialFilter: (id: string) => void
  setters: UserResponse[]
  commerciaux: UserResponse[]
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(ADMIN_RAIL_COLLAPSED_KEY) === '1'
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(ADMIN_RAIL_COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length }
    for (const lead of leads) c[lead.status] = (c[lead.status] ?? 0) + 1
    return c
  }, [leads])

  const lastCallCounts = useMemo(() => ({
    all: leads.length,
    never: leads.filter((l) => l.joursSansContact === null).length,
    today: leads.filter((l) => l.joursSansContact === 0).length,
    older_3d: leads.filter((l) => l.joursSansContact !== null && l.joursSansContact >= 3).length,
    older_7d: leads.filter((l) => l.joursSansContact !== null && l.joursSansContact >= 7).length,
  } as Record<LeadLastCallFilter, number>), [leads])

  // Compteurs croisés : chaque dimension compte sur les leads qui passent
  // tous les AUTRES filtres (sauf la dimension elle-même).
  const dateRangeCounts = useMemo(() => {
    const base = applyLeadFilters(leads, { ...leadFilters, arrivedAt: 'all' })
    const out = {} as Record<LeadArrivedAtFilter, number>
    for (const f of ADMIN_DATE_RANGE_FILTERS) {
      out[f.key] = f.key === 'all' ? base.length : base.filter((l) => matchesLeadDateRange(l, f.key, leadFilters.dateField)).length
    }
    return out
  }, [leads, leadFilters])

  const hasDevisCounts = useMemo(() => {
    const base = applyLeadFilters(leads, { ...leadFilters, hasDevis: 'all' })
    return {
      all: base.length,
      with: base.filter((l) => l.hasDevis === true).length,
      without: base.filter((l) => l.hasDevis !== true).length,
    } as Record<LeadHasFilter, number>
  }, [leads, leadFilters])

  const hasDebriefCounts = useMemo(() => {
    const base = applyLeadFilters(leads, { ...leadFilters, hasDebrief: 'all' })
    return {
      all: base.length,
      with: base.filter((l) => l.hasDebrief === true).length,
      without: base.filter((l) => l.hasDebrief !== true).length,
    } as Record<LeadHasFilter, number>
  }, [leads, leadFilters])

  const setterCounts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length }
    for (const lead of leads) if (lead.setterId) c[lead.setterId] = (c[lead.setterId] ?? 0) + 1
    return c
  }, [leads])

  const commercialCounts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length }
    for (const lead of leads) if (lead.assignedToId) c[lead.assignedToId] = (c[lead.assignedToId] ?? 0) + 1
    return c
  }, [leads])

  if (collapsed) {
    return (
      <aside className="leads-rail hidden lg:flex is-collapsed">
        <div className="leads-rail-toggle-row">
          <button type="button" onClick={toggle} className="leads-rail-toggle" title="Étendre les filtres" aria-label="Étendre">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
          </button>
        </div>
        <div className="leads-rail-collapsed-group">
          <button type="button" onClick={() => setLeadFilters({ ...leadFilters, onlyNew: !leadFilters.onlyNew })} className={`leads-rail-mini ${leadFilters.onlyNew ? 'is-active' : ''}`} title="Nouveaux uniquement">
            <Icon name="sparkles" size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="leads-rail-collapsed-sep" />
        <div className="leads-rail-collapsed-group">
          {ADMIN_STATUS_FILTERS.slice(0, 6).map((item) => (
            <button key={item.key} type="button" onClick={() => setLeadFilters({ ...leadFilters, status: item.key })} className={`leads-rail-mini ${leadFilters.status === item.key ? 'is-active' : ''}`} title={`${item.label} (${statusCounts[item.key] ?? 0})`} aria-label={item.label}>
              <Icon name={item.icon} size={16} strokeWidth={1.75} />
              {(statusCounts[item.key] ?? 0) > 0 && <span className="leads-rail-mini-dot">{(statusCounts[item.key] ?? 0) > 99 ? '99+' : (statusCounts[item.key] ?? 0)}</span>}
            </button>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="leads-rail hidden lg:flex">
      <div className="leads-rail-toggle-row">
        <button type="button" onClick={toggle} className="leads-rail-toggle" title="Réduire les filtres" aria-label="Réduire">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 6 9 12 15 18" /></svg>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setLeadFilters({ ...leadFilters, onlyNew: !leadFilters.onlyNew })}
        className={`sb-item leads-rail-item ${leadFilters.onlyNew ? 'is-active' : ''}`}
      >
        <span className="sb-item-icon"><Icon name="sparkles" size={15} strokeWidth={1.75} /></span>
        <span className="sb-item-label">Nouveaux uniquement</span>
        <span className="leads-rail-count">{leads.filter((l) => l.status === 'nouveau').length}</span>
      </button>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.statut" label="Statut">
        {ADMIN_STATUS_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setLeadFilters({ ...leadFilters, status: item.key })}
            className={`sb-item leads-rail-item ${leadFilters.status === item.key ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{item.label}</span>
            <span className="leads-rail-count">{statusCounts[item.key] ?? 0}</span>
          </button>
        ))}
      </CollapsibleSection>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.derniercall" label="Dernier appel">
        {ADMIN_LAST_CALL_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setLeadFilters({ ...leadFilters, lastCall: item.key })}
            className={`sb-item leads-rail-item ${leadFilters.lastCall === item.key ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{item.label}</span>
            <span className="leads-rail-count">{lastCallCounts[item.key] ?? 0}</span>
          </button>
        ))}
      </CollapsibleSection>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.periode" label="Période">
        {ADMIN_DATE_RANGE_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setLeadFilters({ ...leadFilters, arrivedAt: item.key })}
            className={`sb-item leads-rail-item ${leadFilters.arrivedAt === item.key ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{item.label}</span>
            <span className="leads-rail-count">{dateRangeCounts[item.key] ?? 0}</span>
          </button>
        ))}
      </CollapsibleSection>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.champdate" label="Champ date">
        {ADMIN_DATE_FIELD_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setLeadFilters({ ...leadFilters, dateField: item.key })}
            className={`sb-item leads-rail-item ${leadFilters.dateField === item.key ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{item.label}</span>
          </button>
        ))}
      </CollapsibleSection>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.documents" label="Documents">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-faint">Devis</div>
        {ADMIN_HAS_FILTERS.map((item) => (
          <button
            key={`devis-${item.key}`}
            type="button"
            onClick={() => setLeadFilters({ ...leadFilters, hasDevis: item.key })}
            className={`sb-item leads-rail-item ${leadFilters.hasDevis === item.key ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name="tag" size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{item.label}</span>
            <span className="leads-rail-count">{hasDevisCounts[item.key] ?? 0}</span>
          </button>
        ))}
        <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-faint">Débrief</div>
        {ADMIN_HAS_FILTERS.map((item) => (
          <button
            key={`debrief-${item.key}`}
            type="button"
            onClick={() => setLeadFilters({ ...leadFilters, hasDebrief: item.key })}
            className={`sb-item leads-rail-item ${leadFilters.hasDebrief === item.key ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name="message" size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{item.label}</span>
            <span className="leads-rail-count">{hasDebriefCounts[item.key] ?? 0}</span>
          </button>
        ))}
      </CollapsibleSection>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.setter" label="Setter">
        <button
          type="button"
          onClick={() => setSetterFilter('all')}
          className={`sb-item leads-rail-item ${setterFilter === 'all' ? 'is-active' : ''}`}
        >
          <span className="sb-item-icon"><Icon name="users" size={15} strokeWidth={1.75} /></span>
          <span className="sb-item-label">Tous</span>
          <span className="leads-rail-count">{setterCounts.all ?? 0}</span>
        </button>
        {setters.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSetterFilter(s.id)}
            className={`sb-item leads-rail-item ${setterFilter === s.id ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name="users" size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{s.name}</span>
            <span className="leads-rail-count">{setterCounts[s.id] ?? 0}</span>
          </button>
        ))}
      </CollapsibleSection>

      <CollapsibleSection storageKey="ecoi.leads.admin.section.commercial" label="Commercial">
        <button
          type="button"
          onClick={() => setCommercialFilter('all')}
          className={`sb-item leads-rail-item ${commercialFilter === 'all' ? 'is-active' : ''}`}
        >
          <span className="sb-item-icon"><Icon name="users" size={15} strokeWidth={1.75} /></span>
          <span className="sb-item-label">Tous</span>
          <span className="leads-rail-count">{commercialCounts.all ?? 0}</span>
        </button>
        {commerciaux.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCommercialFilter(c.id)}
            className={`sb-item leads-rail-item ${commercialFilter === c.id ? 'is-active' : ''}`}
          >
            <span className="sb-item-icon"><Icon name="users" size={15} strokeWidth={1.75} /></span>
            <span className="sb-item-label">{c.name}</span>
            <span className="leads-rail-count">{commercialCounts[c.id] ?? 0}</span>
          </button>
        ))}
      </CollapsibleSection>
    </aside>
  )
}

function CollapsibleSection({
  storageKey,
  label,
  children,
}: {
  storageKey: string
  label: string
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(storageKey) === '1'
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(storageKey, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <nav className={`sb-section sb-section-collapsible ${collapsed ? 'is-collapsed' : ''}`} aria-label={label}>
      <button
        type="button"
        onClick={toggle}
        className="sb-section-header"
        aria-expanded={!collapsed}
      >
        <span className="sb-section-label">{label}</span>
        <svg className="sb-section-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && <div className="sb-section-body">{children}</div>}
    </nav>
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

function useColumnVisibility(storageKey: string, columns: ColumnChoice[], defaultVisibleKeys?: ColumnKey[]) {
  const allKeys = columns.map((c) => c.key)
  const defaultKeys = (defaultVisibleKeys?.filter((key) => allKeys.includes(key)) ?? allKeys)
  // Scope par user-id pour que chaque utilisateur garde SES propres prefs colonnes,
  // même si plusieurs comptes utilisent le même navigateur.
  const userId = useAuth((s) => s.user?.id ?? '')
  const scopedKey = userId ? `${storageKey}:${userId}` : storageKey

  const readStored = (key: string): ColumnKey[] | null => {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      const valid = parsed.filter((k): k is string => allKeys.includes(String(k)))
      return valid.length ? valid : null
    } catch {
      return null
    }
  }

  const [visible, setVisible] = useState<ColumnKey[]>(() => {
    // 1) Essaye la clé scopée user, 2) fallback ancien storage non-scopé (one-shot migration)
    return readStored(scopedKey) ?? readStored(storageKey) ?? defaultKeys
  })

  // Si l'utilisateur change (login d'un autre compte, sortie de view-as), recharger ses prefs.
  useEffect(() => {
    const stored = readStored(scopedKey)
    if (stored) setVisible(stored)
    else if (userId) setVisible(defaultKeys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(scopedKey, JSON.stringify(visible))
  }, [scopedKey, visible])

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
      <div className="absolute right-0 mt-3 w-[340px] max-h-[min(80vh,640px)] flex flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white/70 shadow-2xl shadow-text/10 backdrop-blur-2xl z-40">
        <div className="shrink-0 border-b border-white/50 bg-white/35 p-4">
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
        <div className="flex-1 min-h-0 overflow-y-auto bg-white/20 p-2 pb-3 backdrop-blur-xl">
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
    <div className="glass-card !p-3 min-h-[58px]">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow text-[10px] leading-none truncate">{label}</span>
        <div className="text-xl font-bold leading-none tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function ElevenDayGauge({ jours }: { jours: number | null }) {
  const displayDays = jours
  const safeDays = Math.max(0, displayDays ?? 0)
  const progress = Math.min(100, Math.round((safeDays / 11) * 100))
  const barColor = safeDays >= 11 ? 'bg-rouille' : safeDays >= 8 ? 'bg-or' : 'bg-success'
  const label = displayDays === null ? '0/11j' : `${Math.min(safeDays, 11)}/11j`
  const title = `${label} — compte les jours distincts où au moins un appel a été fait`

  return (
    <div className="min-w-[86px]" title={title}>
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
      className="inline-flex min-w-[170px] max-w-full items-center justify-start gap-2 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-bold text-text hover:border-or hover:text-or"
      title="Copier le numéro pour appeler"
    >
      <Icon name="phone" size={13} />
      <span className="whitespace-nowrap">{lead.phone}</span>
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
