// Vue commercial — 100% indépendante de pages/leads/LeadsList.tsx.
// Côté commercial, un "lead qualifié" est appelé un "client".
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon, type IconName } from '../../components/Icon'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Spinner'
import { useAuth } from '../../lib/auth'
import { useLeadsProgressive, useUsers } from '../../lib/hooks'
import { useLeadSidebar } from '../../lib/leadSidebar'
import type { LeadDateField } from '../../lib/leadFilters'
import { fullName, type LeadResponse, type UserResponse } from '../../lib/types'
import { clientBucketForLead, clientStatusBadge, type ClientBucket } from '../../lib/clientStatus'
import { AssignCommercialModal } from '../../components/leads/AssignCommercialModal'
import { ManualLeadModal } from '../../components/leads/ManualLeadModal'
import { useCardGridVirtualizer } from '../../lib/virtualGrid'

// ─── Types ────────────────────────────────────────────────
type ClientStatusFilter = 'all' | ClientBucket
type ClientDocFilter = 'all' | 'devis' | 'debrief'
type ClientDateFilter =
  | 'all' | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'

const STATUS_FILTERS: Array<{ key: ClientStatusFilter; label: string; icon: IconName }> = [
  { key: 'all', label: 'Tout', icon: 'inbox' },
  { key: 'rdv_a_faire', label: 'RDV à faire', icon: 'calendar' },
  { key: 'qualifie', label: 'Qualifié', icon: 'check' },
  { key: 'non_qualifie', label: 'Non qualifié', icon: 'x' },
]

const DOC_FILTERS: Array<{ key: ClientDocFilter; label: string; icon: IconName }> = [
  { key: 'all', label: 'Tous documents', icon: 'inbox' },
  { key: 'devis', label: 'Avec devis', icon: 'tag' },
  { key: 'debrief', label: 'Avec debrief', icon: 'message' },
]

const DATE_FILTERS: Array<{ key: ClientDateFilter; label: string; icon: IconName }> = [
  { key: 'all', label: 'Toutes dates', icon: 'inbox' },
  { key: 'today', label: "Aujourd'hui", icon: 'calendar' },
  { key: 'yesterday', label: 'Hier', icon: 'calendar' },
  { key: 'this_week', label: 'Cette semaine', icon: 'calendar' },
  { key: 'last_week', label: 'Semaine dernière', icon: 'calendar' },
  { key: 'this_month', label: 'Ce mois-ci', icon: 'calendar' },
  { key: 'last_month', label: 'Mois dernier', icon: 'calendar' },
]

const DATE_FIELD_FILTERS: Array<{ key: LeadDateField; label: string; icon: IconName }> = [
  { key: 'arrival', label: 'Arrivée du client', icon: 'inbox' },
  { key: 'devis', label: 'Date du devis', icon: 'tag' },
  { key: 'debrief', label: 'Date du débrief', icon: 'message' },
  { key: 'call', label: 'Dernier appel', icon: 'phone' },
]

const RAIL_COLLAPSED_KEY = 'ecoi.clients.rail.collapsed'

// ─── Helpers locaux ───────────────────────────────────────
function leadArrivalDate(lead: Pick<LeadResponse, 'createdAt' | 'arrivalAt'>): string {
  return lead.arrivalAt || lead.createdAt
}

function matchesClientDateFilter(
  lead: LeadResponse,
  filter: ClientDateFilter,
  field: LeadDateField = 'arrival',
): boolean {
  if (filter === 'all') return true
  const iso =
    field === 'devis' ? lead.latestDevisAt :
    field === 'debrief' ? lead.latestDebriefAt :
    field === 'call' ? lead.latestCallAt :
    leadArrivalDate(lead)
  if (!iso) return false
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(now)
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const dayOfWeek = (today.getDay() + 6) % 7
  const startThisWeek = new Date(today.getTime() - dayOfWeek * 24 * 60 * 60 * 1000)
  const startNextWeek = new Date(startThisWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
  const startLastWeek = new Date(startThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  const startLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  switch (filter) {
    case 'today':      return date >= today && date < tomorrow
    case 'yesterday':  return date >= yesterday && date < today
    case 'this_week':  return date >= startThisWeek && date < startNextWeek
    case 'last_week':  return date >= startLastWeek && date < startThisWeek
    case 'this_month': return date >= startThisMonth && date < startNextMonth
    case 'last_month': return date >= startLastMonth && date < startThisMonth
  }
}

function fullDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

function addressFull(l: Pick<LeadResponse, 'addressLine' | 'postalCode' | 'city'>): string {
  return [l.addressLine, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'
}

function rdvLabel(l: Pick<LeadResponse, 'latestRdvAt'>): string {
  if (!l.latestRdvAt) return '—'
  return fullDateTime(l.latestRdvAt)
}

// ─── Page ─────────────────────────────────────────────────
export function ClientsList() {
  const me = useAuth((s) => s.user)
  const redirectTech = me?.role === 'technicien'
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  // L'admin accède à cette page via le lien « Clients » de la sidebar et doit voir
  // tout le portefeuille (comme un commercial_lead), pas seulement les clients qui
  // lui seraient assignés — sinon la liste est vide (« Aucun client assigné »).
  const isManager = me?.role === 'commercial_lead' || me?.role === 'admin'
  // Délivrabilité & ops (RT / back-office) accèdent à cette page via
  // « Dossier client » : ils voient TOUT le portefeuille (comme un manager) mais en
  // lecture — pas de réattribution commerciale. Le technicien, lui, est redirigé
  // vers « Mes interventions » (voir redirectTech ci-dessus).
  const isOps =
    me?.role === 'delivrabilite' ||
    me?.role === 'responsable_technique' ||
    me?.role === 'back_office'
  const seesFullPortfolio = isManager || isOps
  // Page client : on ne charge QUE les leads arrivés au RDV planifié et au-delà
  // (chemin positif), filtré côté backend via scope=clients. limit relevée car le
  // chemin positif dépasse 250 → sinon les compteurs du rail seraient tronqués.
  const leadsFilter = seesFullPortfolio
    ? { scope: 'clients' as const, fullLimit: 1000 }
    : me?.id
      ? { assignedToId: me.id, scope: 'clients' as const, fullLimit: 1000 }
      : { scope: 'clients' as const, fullLimit: 1000 }
  const { data, loading, error, refetch, canLoadMore, loadMore } = useLeadsProgressive(leadsFilter)
  // Les filtres et compteurs du rail portent sur TOUTE la population client
  // (bornée, ~centaines de dossiers) : on déroule la pagination jusqu'au bout
  // au lieu de rester sur la première fenêtre.
  useEffect(() => {
    if (canLoadMore && loadMore) loadMore()
  }, [canLoadMore, loadMore, data])
  const { data: usersData } = useUsers()
  const allClients = data ?? []
  const [filter, setFilter] = useState<ClientStatusFilter>('all')
  const [docFilter, setDocFilter] = useState<ClientDocFilter>('all')
  const [dateFilter, setDateFilter] = useState<ClientDateFilter>('all')
  const [dateFieldFilter, setDateFieldFilter] = useState<LeadDateField>('arrival')
  const [commercialFilter, setCommercialFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  // Client en cours d'attribution (responsable commercial / admin uniquement).
  const [assignTarget, setAssignTarget] = useState<LeadResponse | null>(null)
  const [manualOpen, setManualOpen] = useState(false)

  const teamCommerciaux = useMemo(
    () => (usersData ?? []).filter((u) => (u.role === 'commercial' || u.role === 'commercial_lead') && u.active),
    [usersData],
  )

  // Vue admin / responsable commercial : on affiche le commercial attribué sur
  // chaque carte. Priorité au commercial assigné, repli sur celui du dernier RDV
  // (même logique que les compteurs « Par commercial »).
  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const u of usersData ?? []) map.set(u.id, u.name)
    return map
  }, [usersData])
  const commercialNameForLead = (l: LeadResponse): string | null => {
    const id = l.assignedToId ?? l.latestRdvCommercialId
    return id ? userNameById.get(id) ?? null : null
  }

  const matchStatus = (l: LeadResponse, f: ClientStatusFilter) => f === 'all' || clientBucketForLead(l) === f
  const matchDoc = (l: LeadResponse, f: ClientDocFilter) =>
    f === 'all' || (f === 'devis' ? l.hasDevis === true : l.hasDebrief === true)
  const matchDate = (l: LeadResponse, f: ClientDateFilter) => matchesClientDateFilter(l, f, dateFieldFilter)
  const matchCommercial = (l: LeadResponse, f: string) =>
    f === 'all' || l.assignedToId === f || l.latestRdvCommercialId === f

  // Compteurs croisés : chaque dimension ignore son propre filtre.
  const counts = useMemo(() => {
    const base = allClients.filter(
      (l) => matchDoc(l, docFilter) && matchDate(l, dateFilter) && matchCommercial(l, commercialFilter),
    )
    return {
      all: base.length,
      rdv_a_faire: base.filter((l) => clientBucketForLead(l) === 'rdv_a_faire').length,
      qualifie: base.filter((l) => clientBucketForLead(l) === 'qualifie').length,
      non_qualifie: base.filter((l) => clientBucketForLead(l) === 'non_qualifie').length,
    }
  }, [allClients, docFilter, dateFilter, dateFieldFilter, commercialFilter])

  const docCounts = useMemo(() => {
    const base = allClients.filter(
      (l) => matchStatus(l, filter) && matchDate(l, dateFilter) && matchCommercial(l, commercialFilter),
    )
    return {
      all: base.length,
      devis: base.filter((l) => l.hasDevis === true).length,
      debrief: base.filter((l) => l.hasDebrief === true).length,
    }
  }, [allClients, filter, dateFilter, dateFieldFilter, commercialFilter])

  const dateCounts = useMemo(() => {
    const base = allClients.filter(
      (l) => matchStatus(l, filter) && matchDoc(l, docFilter) && matchCommercial(l, commercialFilter),
    )
    return {
      all: base.length,
      today: base.filter((l) => matchDate(l, 'today')).length,
      yesterday: base.filter((l) => matchDate(l, 'yesterday')).length,
      this_week: base.filter((l) => matchDate(l, 'this_week')).length,
      last_week: base.filter((l) => matchDate(l, 'last_week')).length,
      this_month: base.filter((l) => matchDate(l, 'this_month')).length,
      last_month: base.filter((l) => matchDate(l, 'last_month')).length,
    }
  }, [allClients, filter, docFilter, dateFieldFilter, commercialFilter])

  const commercialCounts = useMemo(() => {
    const base = allClients.filter(
      (l) => matchStatus(l, filter) && matchDoc(l, docFilter) && matchDate(l, dateFilter),
    )
    const out: Record<string, number> = { all: base.length }
    for (const l of base) {
      const id = l.assignedToId ?? l.latestRdvCommercialId
      if (id) out[id] = (out[id] ?? 0) + 1
    }
    return out
  }, [allClients, filter, docFilter, dateFilter, dateFieldFilter])

  const clients = useMemo(() => {
    let base = filter === 'all' ? allClients : allClients.filter((l) => clientBucketForLead(l) === filter)
    if (docFilter !== 'all') base = base.filter((l) => matchDoc(l, docFilter))
    if (dateFilter !== 'all') base = base.filter((l) => matchDate(l, dateFilter))
    if (commercialFilter !== 'all') base = base.filter((l) => matchCommercial(l, commercialFilter))
    const q = query.trim().toLowerCase()
    if (q) {
      base = base.filter((l) =>
        [fullName(l), l.phone, l.email, l.city, l.addressLine]
          .filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    }
    return base
  }, [allClients, filter, docFilter, dateFilter, dateFieldFilter, commercialFilter, query])

  const scrollRef = useRef<HTMLDivElement>(null)
  // Colonnes responsives : miroir du CSS original grid-cols-1 sm:2 lg:3 xl:4
  // (sm=640 px, lg=1024 px, xl=1280 px). Le hook mesure la largeur du container
  // via ResizeObserver et prend une mesure synchrone au montage (offsetWidth
  // mocké à 1024 dans jsdom → 3 colonnes en test).
  const { virtualizer: rowVirtualizer, columns } = useCardGridVirtualizer(scrollRef, clients.length, {
    columns: (w) => (w < 640 ? 1 : w < 1024 ? 2 : w < 1280 ? 3 : 4),
    estimateRowHeight: 220,
    gap: 16,
  })

  if (redirectTech) return <Navigate to="/mes-interventions" replace />

  return (
    <AppShell>
      <Topbar
        eyebrow={isManager ? 'CLIENTS / COMMERCIAL LEAD' : 'CLIENTS / COMMERCIAL'}
        title={isManager ? "Clients de l'équipe commerciale" : 'Mes clients'}
      />
      <div className="flex flex-grow overflow-hidden">
        <ClientsRail
          filter={filter} onFilter={setFilter} counts={counts}
          docFilter={docFilter} onDocFilter={setDocFilter} docCounts={docCounts}
          dateFilter={dateFilter} onDateFilter={setDateFilter} dateCounts={dateCounts}
          dateFieldFilter={dateFieldFilter} onDateFieldFilter={setDateFieldFilter}
          isManager={isManager}
          commercialFilter={commercialFilter} onCommercialFilter={setCommercialFilter}
          commerciaux={teamCommerciaux} commercialCounts={commercialCounts}
        />
        <main className="p-4 sm:p-6 md:p-8 flex-grow overflow-hidden flex flex-col">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-grow max-w-md">
              <Icon name="search" size={16} className="absolute left-3 top-2.5 text-faint" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un client (nom, téléphone, email…)"
                className="w-full bg-white border border-line rounded-[14px] pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-or"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-faint font-semibold whitespace-nowrap">{clients.length}/{allClients.length}</span>
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-success px-3 py-2 text-xs font-black text-white shadow-sm hover:brightness-95"
              >
                <Icon name="plus" size={14} />
                Ajouter un client
              </button>
            </div>
          </div>
          <div ref={scrollRef} style={{ overflowY: 'auto', flex: '1 1 0', minHeight: 0 }}>
            {loading && clients.length === 0 ? (
              <LoadingBlock label="Chargement des clients…" />
            ) : error ? (
              <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
            ) : clients.length === 0 ? (
              <EmptyState
                icon="users"
                title={allClients.length === 0
                  ? (isManager ? "Aucun client dans l'équipe" : 'Aucun client assigné')
                  : 'Aucun client pour ce filtre'}
                description={
                  allClients.length === 0
                    ? (isManager
                        ? "Aucun lead n'est rattaché à un commercial de l'équipe pour le moment."
                        : "Aucun client n'est rattaché à ton compte commercial pour le moment.")
                    : 'Essaie un autre filtre ou affine ta recherche.'
                }
              />
            ) : (
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const start = vRow.index * columns
                  const rowItems = clients.slice(start, start + columns)
                  return (
                    <div
                      key={vRow.key}
                      data-index={vRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vRow.start}px)`,
                        display: 'grid',
                        gridTemplateColumns: `repeat(${columns}, 1fr)`,
                        gap: 16,
                      }}
                    >
                      {rowItems.map((c) => (
                        <ClientCard
                          key={c.id}
                          client={c}
                          selected={selectedId === c.id}
                          onClick={() => selectLead(c.id)}
                          commercialName={seesFullPortfolio ? commercialNameForLead(c) : null}
                          onAssign={isManager ? () => setAssignTarget(c) : undefined}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {assignTarget && (
        <AssignCommercialModal
          lead={assignTarget}
          commerciaux={teamCommerciaux}
          onClose={() => setAssignTarget(null)}
        />
      )}
      {manualOpen && (
        <ManualLeadModal
          mode="client"
          role={me?.role}
          commerciaux={teamCommerciaux}
          onClose={() => setManualOpen(false)}
          onCreated={(lead) => {
            refetch()
            selectLead(lead.id)
          }}
        />
      )}
    </AppShell>
  )
}

function ClientCard({ client, selected, onClick, commercialName, onAssign }: { client: LeadResponse; selected: boolean; onClick: () => void; commercialName?: string | null; onAssign?: () => void }) {
  // Une fois le projet signé transmis à la délivrabilité, le badge reflète
  // l'avancement du dossier (VT à faire, Installation planifiée…) plutôt que
  // le statut commercial 'Signé'.
  const { label: badgeLabel, className: badgeClass } = clientStatusBadge(client)
  const address = addressFull(client)
  const rdv = rdvLabel(client)
  return (
    <div className="relative h-full">
    <button
      type="button"
      onClick={onClick}
      title="Cliquer pour ouvrir le débriefing commercial"
      className={`glass-card !p-4 text-left transition-all w-full h-full ${selected ? 'ring-2 ring-or shadow-lg' : 'hover:bg-white/70 hover:shadow'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-black text-sm text-text truncate" title={fullName(client)}>{fullName(client)}</p>
          <p className="mt-0.5 text-[11px] text-muted truncate">{client.phone ?? '—'}</p>
        </div>
        <span className={`status-badge ${badgeClass} shrink-0 text-[10px]`}>{badgeLabel}</span>
      </div>
      <div className={`mt-2 space-y-1 text-[11px] text-muted ${onAssign ? 'pb-7' : ''}`}>
        {address !== '—' && (
          <div className="flex items-start gap-1.5">
            <Icon name="map-pin" size={12} className="mt-0.5 shrink-0 text-faint" />
            <span className="truncate" title={address}>{address}</span>
          </div>
        )}
        {rdv !== '—' && (
          <div className="flex items-start gap-1.5">
            <Icon name="calendar" size={12} className="mt-0.5 shrink-0 text-faint" />
            <span className="truncate" title={rdv}>{rdv}</span>
          </div>
        )}
        {client.transferredAt && (
          <div className="flex items-start gap-1.5">
            <Icon name="clock" size={12} className="mt-0.5 shrink-0 text-faint" />
            <span className="truncate">Transféré le {fullDateTime(client.transferredAt)}</span>
          </div>
        )}
        {commercialName && (
          <div className="flex items-start gap-1.5">
            <Icon name="users" size={12} className="mt-0.5 shrink-0 text-faint" />
            <span className="truncate" title={`Commercial : ${commercialName}`}>{commercialName}</span>
          </div>
        )}
      </div>
    </button>
      {onAssign && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAssign() }}
          title="Donner ce client à un commercial"
          aria-label="Donner ce client à un commercial"
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-line bg-white/90 px-2.5 py-1 text-[10px] font-bold text-muted hover:border-or hover:text-or-dark shadow-sm"
        >
          <Icon name="users" size={12} />
          Donner à…
        </button>
      )}
    </div>
  )
}

// ─── Sidebar / Rail ─────────────────────────────────────
function ClientsRail({
  filter, onFilter, counts,
  docFilter, onDocFilter, docCounts,
  dateFilter, onDateFilter, dateCounts,
  dateFieldFilter, onDateFieldFilter,
  isManager,
  commercialFilter, onCommercialFilter, commerciaux, commercialCounts,
}: {
  filter: ClientStatusFilter
  onFilter: (f: ClientStatusFilter) => void
  counts: Record<ClientStatusFilter, number>
  docFilter: ClientDocFilter
  onDocFilter: (f: ClientDocFilter) => void
  docCounts: Record<ClientDocFilter, number>
  dateFilter: ClientDateFilter
  onDateFilter: (f: ClientDateFilter) => void
  dateCounts: Record<ClientDateFilter, number>
  dateFieldFilter: LeadDateField
  onDateFieldFilter: (f: LeadDateField) => void
  isManager: boolean
  commercialFilter: string
  onCommercialFilter: (id: string) => void
  commerciaux: UserResponse[]
  commercialCounts: Record<string, number>
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1'
  })
  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(RAIL_COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
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
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilter(item.key)}
                className={`leads-rail-mini ${filter === item.key ? 'is-active' : ''}`}
                title={`${item.label} (${counts[item.key]})`}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={16} strokeWidth={1.75} />
                {counts[item.key] > 0 && (
                  <span className="leads-rail-mini-dot">{counts[item.key] > 99 ? '99+' : counts[item.key]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="leads-rail-collapsed-sep" />
          <div className="leads-rail-collapsed-group">
            {DOC_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onDocFilter(item.key)}
                className={`leads-rail-mini ${docFilter === item.key ? 'is-active' : ''}`}
                title={`${item.label} (${docCounts[item.key]})`}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={16} strokeWidth={1.75} />
                {docCounts[item.key] > 0 && (
                  <span className="leads-rail-mini-dot">{docCounts[item.key] > 99 ? '99+' : docCounts[item.key]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="leads-rail-collapsed-sep" />
          <div className="leads-rail-collapsed-group">
            {DATE_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onDateFilter(item.key)}
                className={`leads-rail-mini ${dateFilter === item.key ? 'is-active' : ''}`}
                title={`${item.label} (${dateCounts[item.key]})`}
                aria-label={item.label}
              >
                <Icon name={item.icon} size={16} strokeWidth={1.75} />
                {dateCounts[item.key] > 0 && (
                  <span className="leads-rail-mini-dot">{dateCounts[item.key] > 99 ? '99+' : dateCounts[item.key]}</span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <CollapsibleSection storageKey="ecoi.clients.section.statut" label="Statut" onCollapse={() => onFilter('all')}>
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onFilter(item.key)}
                className={`sb-item leads-rail-item ${filter === item.key ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">{item.label}</span>
                <span className="leads-rail-count">{counts[item.key]}</span>
              </button>
            ))}
          </CollapsibleSection>
          <CollapsibleSection storageKey="ecoi.clients.section.documents" label="Documents" onCollapse={() => onDocFilter('all')}>
            {DOC_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onDocFilter(item.key)}
                className={`sb-item leads-rail-item ${docFilter === item.key ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">{item.label}</span>
                <span className="leads-rail-count">{docCounts[item.key]}</span>
              </button>
            ))}
          </CollapsibleSection>
          <CollapsibleSection storageKey="ecoi.clients.section.date" label="Période" onCollapse={() => onDateFilter('all')}>
            {DATE_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onDateFilter(item.key)}
                className={`sb-item leads-rail-item ${dateFilter === item.key ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">{item.label}</span>
                <span className="leads-rail-count">{dateCounts[item.key]}</span>
              </button>
            ))}
          </CollapsibleSection>
          <CollapsibleSection storageKey="ecoi.clients.section.champdate" label="Champ date" onCollapse={() => onDateFieldFilter('arrival')}>
            {DATE_FIELD_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onDateFieldFilter(item.key)}
                className={`sb-item leads-rail-item ${dateFieldFilter === item.key ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name={item.icon} size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">{item.label}</span>
              </button>
            ))}
          </CollapsibleSection>
          {isManager && (
            <CollapsibleSection storageKey="ecoi.clients.section.commercial" label="Par commercial" onCollapse={() => onCommercialFilter('all')}>
              <button
                type="button"
                onClick={() => onCommercialFilter('all')}
                className={`sb-item leads-rail-item ${commercialFilter === 'all' ? 'is-active' : ''}`}
              >
                <span className="sb-item-icon"><Icon name="users" size={15} strokeWidth={1.75} /></span>
                <span className="sb-item-label">Toute l'équipe</span>
                <span className="leads-rail-count">{commercialCounts.all ?? 0}</span>
              </button>
              {commerciaux.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCommercialFilter(c.id)}
                  className={`sb-item leads-rail-item ${commercialFilter === c.id ? 'is-active' : ''}`}
                >
                  <span className="sb-item-icon"><Icon name="users" size={15} strokeWidth={1.75} /></span>
                  <span className="sb-item-label">{c.name}</span>
                  <span className="leads-rail-count">{commercialCounts[c.id] ?? 0}</span>
                </button>
              ))}
            </CollapsibleSection>
          )}
        </>
      )}
    </aside>
  )
}

function CollapsibleSection({
  storageKey,
  label,
  children,
  onCollapse,
}: {
  storageKey: string
  label: string
  children: React.ReactNode
  // Replier une section = exclure ce filtre : on remet la dimension à sa valeur
  // par défaut (« Tout ») via ce callback. Cf. demande « on réduit un filtre si
  // on ne veut pas l'inclure ».
  onCollapse?: () => void
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(storageKey) === '1'
  })
  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(storageKey, next ? '1' : '0') } catch { /* ignore */ }
      if (next) onCollapse?.()
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
