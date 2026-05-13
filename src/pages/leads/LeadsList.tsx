import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { Spinner, LoadingBlock } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { LeadFiltersBar } from '../../components/LeadFiltersBar'
import { useAuth } from '../../lib/auth'
import { useLeadsProgressive, useUsers, useStartCall } from '../../lib/hooks'
import { useLeadSidebar } from '../../lib/leadSidebar'
import { DEFAULT_LEAD_FILTERS, applyLeadFilters, type LeadListFilters } from '../../lib/leadFilters'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  cleanField,
  fieldOrDash,
  fullName,
  initials,
  type LeadResponse,
  type UserResponse,
} from '../../lib/types'

type ColumnKey = string

const LEADS_PAGE_LIMIT = 500
const INITIAL_VISIBLE_ROWS = 80
const VISIBLE_ROWS_STEP = 120

type ColumnChoice = {
  key: ColumnKey
  label: string
}

// Contexte injecté à chaque renderCell — évite les closures imbriquées par cellule.
type SetterCellCtx = {
  userMap: Map<string, UserResponse>
  startCall: ReturnType<typeof useStartCall>
  setOpenComment: (data: { leadName: string; comment: string } | null) => void
}

// Définition d'une colonne setter : largeur fixe + libellé d'en-tête + fonction
// de rendu. L'ordre d'affichage et la visibilité sont stockés en localStorage
// par utilisateur ; la définition reste statique ici.
type SetterColumnDef = ColumnChoice & {
  width: string
  headLabel: string
  sticky?: boolean
  renderCell: (lead: LeadResponse, ctx: SetterCellCtx) => ReactNode
  tdClassName?: string | ((lead: LeadResponse, ctx: SetterCellCtx) => string)
  tdTitle?: (lead: LeadResponse, ctx: SetterCellCtx) => string | undefined
}

const SETTER_COLUMNS: SetterColumnDef[] = [
  {
    key: 'nom',
    label: 'Nom',
    headLabel: 'NOM',
    width: 'w-[240px]',
    sticky: true,
    tdClassName: 'lead-sticky-cell',
    renderCell: (l, ctx) => (
      <div className="flex items-center gap-3 min-w-0">
        <LeadCommentButton comment={l.latestCallComment} leadName={fullName(l)} onOpen={ctx.setOpenComment} />
        <div className="w-8 h-8 rounded-full bg-cuivre-tint flex flex-shrink-0 items-center justify-center text-xs font-bold">{initials(l)}</div>
        <span className="font-semibold truncate" title={fullName(l)}>{fullName(l)}</span>
      </div>
    ),
  },
  {
    key: 'telephone',
    label: 'Téléphone du Prospect',
    headLabel: 'TÉLÉPHONE DU PROSPECT',
    width: 'w-[190px]',
    renderCell: (l, ctx) => <PhoneCell lead={l} onStartCall={ctx.startCall} />,
  },
  {
    key: 'adresseComplete',
    label: 'Adresse complète',
    headLabel: 'ADRESSE COMPLÈTE',
    width: 'w-[260px]',
    tdClassName: 'text-muted truncate',
    tdTitle: (l) => addressFull(l),
    renderCell: (l) => addressFull(l),
  },
  {
    key: 'setter',
    label: 'Setter assigné',
    headLabel: 'SETTER ASSIGNÉ',
    width: 'w-[210px]',
    renderCell: (l, ctx) => <SetterChips lead={l} userMap={ctx.userMap} />,
  },
  {
    key: 'jaugeAppels',
    label: 'Jauge appels (4/jour)',
    headLabel: 'JAUGE APPELS (4/JOUR)',
    width: 'w-[160px]',
    renderCell: (l) => <DailyCallGauge count={l.callsToday ?? 0} />,
  },
  {
    key: 'dernierAppel',
    label: 'Dernier appel (date/heure)',
    headLabel: 'DERNIER APPEL',
    width: 'w-[170px]',
    tdClassName: 'text-faint',
    renderCell: (l) => lastCallDateTime(l.latestCallAt ?? l.lastContactAt),
  },
  {
    key: 'statut',
    label: 'Statut opportunité',
    headLabel: 'STATUT OPPORTUNITÉ',
    width: 'w-[160px]',
    renderCell: (l) => <span className={`status-badge ${STATUS_BADGE[l.status]}`}>{STATUS_LABEL[l.status]}</span>,
  },
  {
    key: 'appelDate',
    label: "Date/heure de l'appel (from Appels)",
    headLabel: "DATE/HEURE DE L'APPEL",
    width: 'w-[190px]',
    tdClassName: 'text-faint',
    renderCell: (l) => lastCallDateTime(l.latestCallAt ?? l.lastContactAt),
  },
  {
    key: 'jauge',
    label: 'Jauge 11 jours',
    headLabel: 'JAUGE 11 JOURS',
    width: 'w-[160px]',
    renderCell: (l) => <ElevenDayGauge jours={l.joursRelance ?? null} />,
  },
  {
    key: 'logAppel',
    label: 'Log appel',
    headLabel: 'LOG APPEL',
    width: 'w-[120px]',
    renderCell: (l, ctx) => <LeadCommentButton comment={l.latestCallComment} leadName={fullName(l)} onOpen={ctx.setOpenComment} />,
  },
  {
    key: 'appelsCommercial',
    label: 'Appels Commercial (from Rendez-vous)',
    headLabel: 'APPELS COMMERCIAL',
    width: 'w-[220px]',
    tdClassName: 'text-muted truncate',
    tdTitle: (l, ctx) => commercialLabel(l, ctx.userMap),
    renderCell: (l, ctx) => commercialLabel(l, ctx.userMap),
  },
]

const SETTER_COLUMNS_BY_KEY: Record<string, SetterColumnDef> = Object.fromEntries(
  SETTER_COLUMNS.map((c) => [c.key, c]),
)

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
]


export function LeadsList() {
  const role = useAuth((s) => s.user?.role)
  if (role === 'admin') return <LeadsAdmin />
  return <LeadsSetter />
}

// ----- F5 Setter -----
// Seuil au-delà duquel un lead "ne répond pas" sort de l'onglet "Nouveaux"
// pour rejoindre la catégorie dédiée "Sans réponse". Tant que < 7 tentatives
// consécutives infructueuses, le lead reste visible avec les nouveaux pour
// que le setter continue à le travailler.
const SANS_REPONSE_THRESHOLD = 7

function LeadsSetter() {
  const [filter, setFilter] = useState<'nouveau' | 'rappel' | 'qualifie' | 'sans_reponse' | 'perdu'>('nouveau')
  const [leadFilters, setLeadFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS)
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('search') ?? '')
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  const [openComment, setOpenComment] = useState<{ leadName: string; comment: string } | null>(null)
  const [visibleColumns, setVisibleColumns] = useColumnVisibility('ecoi.leads.setter.columns.v2', SETTER_COLUMNS)
  const startCall = useStartCall()
  // Colonnes effectivement rendues : on suit l'ordre choisi par l'utilisateur
  // (stocké en localStorage par useColumnVisibility), pas l'ordre statique du tableau.
  const orderedColumns = useMemo(
    () => visibleColumns.map((k) => SETTER_COLUMNS_BY_KEY[k]).filter(Boolean),
    [visibleColumns],
  )

  // Côté setter, l'écran s'ouvre directement sur les nouveaux leads.
  // Le filtre global "Tous" n'est pas affiché aux setters.
  const { data, loading, error } = useLeadsProgressive({ quickLimit: 50, fullLimit: LEADS_PAGE_LIMIT })
  const { data: usersList } = useUsers()
  const mine = data ?? []
  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of usersList ?? []) m.set(u.id, u)
    return m
  }, [usersList])

  const counts = useMemo(() => ({
    all: mine.length,
    // "Nouveaux" inclut les leads status=nouveau ET les leads pas_de_reponse
    // tant qu'ils n'ont pas atteint le seuil de SANS_REPONSE_THRESHOLD appels
    // consécutifs sans réponse. Idée : le setter doit continuer à essayer.
    nouveau: mine.filter(isNouveauLead).length,
    rappel: mine.filter(isCallbackLead).length,
    qualifie: mine.filter((l) => l.status === 'qualifie').length,
    sansReponse: mine.filter(isSansReponseLead).length,
    // DATA-2: le compteur doit refléter le même filtre que l'onglet (ligne ~143).
    // L'onglet "Perdus" inclut perdu + pas_qualifie.
    perdu: mine.filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie').length,
  }), [mine])

  const filtered = useMemo(() => {
    let list = mine
    const q = query.trim().toLowerCase()
    // Recherche globale : si l'utilisateur cherche un lead (depuis l'input ou un
    // click sur une notif qui pousse ?search=…), on bypass le filtre catégorie
    // pour qu'un lead "à rappeler" reste trouvable depuis l'onglet "Nouveaux".
    if (q) {
      list = list.filter((l) => [fullName(l), l.phone, l.email, l.city].filter(Boolean).join(' ').toLowerCase().includes(q))
    } else {
      if (filter === 'nouveau') list = list.filter(isNouveauLead)
      if (filter === 'rappel') list = list.filter(isCallbackLead)
      if (filter === 'qualifie') list = list.filter((l) => l.status === 'qualifie')
      if (filter === 'sans_reponse') list = list.filter(isSansReponseLead)
      if (filter === 'perdu') list = list.filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie')
    }
    list = applyLeadFilters(list, leadFilters)
    return list
  }, [mine, filter, leadFilters, query])

  const selected = useMemo(
    () => (selectedId ? mine.find((l) => l.id === selectedId) ?? null : null),
    [mine, selectedId],
  )
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS)
  const visibleFiltered = useMemo(() => filtered.slice(0, visibleRows), [filtered, visibleRows])
  useEffect(() => setVisibleRows(INITIAL_VISIBLE_ROWS), [filter, leadFilters, query])
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
              <FilterPill active={filter === 'sans_reponse'} onClick={() => setFilter('sans_reponse')}>Sans réponse ({counts.sansReponse})</FilterPill>
              <FilterPill active={filter === 'perdu'} onClick={() => setFilter('perdu')}>Perdus ({counts.perdu})</FilterPill>
              <LeadFiltersBar filters={leadFilters} onChange={setLeadFilters} total={mine.length} filtered={filtered.length} />
              <ColumnVisibilityMenu columns={SETTER_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
              {loading && mine.length > 0 && <span className="text-xs text-faint ml-auto inline-flex items-center gap-1"><Spinner size={12} stroke={2} />Actualisation…</span>}
            </div>

            {loading && mine.length === 0 ? (
              <LoadingBlock label="Chargement des leads…" />
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
                  <thead className="text-left eyebrow bg-or-tint sticky top-0 z-10 shadow-sm">
                    <tr>
                      {orderedColumns.map((col) => (
                        <Th key={col.key} className={`${col.width}${col.sticky ? ' lead-sticky-head' : ''}`}>
                          {col.headLabel}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFiltered.map((l) => {
                      const ctx: SetterCellCtx = { userMap, startCall, setOpenComment }
                      return (
                        <tr
                          key={l.id}
                          data-lead-id={l.id}
                          className={`border-b border-line-soft last:border-0 cursor-pointer transition-colors ${
                            selected?.id === l.id ? 'bg-or/20 shadow-[inset_4px_0_0_var(--color-or-dark)] !text-text' : 'hover:bg-white/40'
                          }`}
                          onDoubleClick={() => selectLead(l.id)}
                          title="Double-cliquez pour ouvrir la fiche lead"
                        >
                          {orderedColumns.map((col) => {
                            const cls = typeof col.tdClassName === 'function' ? col.tdClassName(l, ctx) : (col.tdClassName ?? '')
                            const title = col.tdTitle?.(l, ctx)
                            return (
                              <Td key={col.key} className={cls} title={title}>
                                {col.renderCell(l, ctx)}
                              </Td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {visibleFiltered.length < filtered.length && (
                  <div className="sticky left-0 flex justify-center border-t border-line-soft bg-white/80 p-3 backdrop-blur">
                    <button
                      type="button"
                      onClick={() => setVisibleRows((count) => count + VISIBLE_ROWS_STEP)}
                      className="btn-secondary rounded-xl px-4 py-2 text-sm"
                    >
                      Afficher plus de leads ({visibleFiltered.length}/{filtered.length})
                    </button>
                  </div>
                )}
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
  const [visibleColumns, setVisibleColumns] = useColumnVisibility('ecoi.leads.admin.columns.v2', ADMIN_COLUMNS)
  const selectedId = useLeadSidebar((s) => s.selectedLeadId)
  const selectLead = useLeadSidebar((s) => s.selectLead)
  const showColumn = (key: ColumnKey) => visibleColumns.includes(key)

  const { data: leadsData, loading, error } = useLeadsProgressive({ quickLimit: 50, fullLimit: LEADS_PAGE_LIMIT })
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
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS)
  const visibleFiltered = useMemo(() => filtered.slice(0, visibleRows), [filtered, visibleRows])
  useEffect(() => setVisibleRows(INITIAL_VISIBLE_ROWS), [setterFilter, commercialFilter, leadFilters])
  const tableScrollRef = useRememberedLeadTableScroll('ecoi.leads.admin.tableScroll.v1', filtered, selectedId)

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
        <button onClick={() => exportCsv(filtered)} className="btn-primary px-4 py-2 rounded-[14px] text-sm ml-auto">Exporter CSV</button>
      </div>

      <main className="p-8 pt-4 flex-grow flex flex-col min-h-0 overflow-hidden">
        <div className="grid grid-cols-4 gap-6 mb-4 flex-shrink-0">
          <StatCard label="TOTAL LEADS" value={stats.total.toLocaleString('fr-FR')} />
          <StatCard label="QUALIFIÉS" value={stats.qualifies.toString()} />
          <StatCard label="EN ATTENTE" value={stats.waiting.toString()} />
          <StatCard label="PERDUS" value={stats.perdus.toString()} />
        </div>

        {loading && leads.length === 0 ? (
          <LoadingBlock />
        ) : error ? (
          <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-faint text-sm">Aucun lead ne correspond aux filtres.</div>
        ) : (
          <div className="glass-card !p-0 overflow-hidden flex-grow min-h-0">
            <div ref={tableScrollRef} data-preserve-scroll="true" className="overflow-auto h-full">
            <table className="min-w-[5480px] w-full text-sm table-fixed lead-table">
              <thead className="text-left eyebrow bg-or-tint sticky top-0 z-10 shadow-sm">
                <tr>
                  {showColumn('nom') && <Th className="w-[240px] lead-sticky-head">NOM</Th>}
                  {showColumn('statut') && <Th className="w-[160px]">STATUT OPPORTUNITÉ</Th>}
                  {showColumn('email') && <Th className="w-[220px]">EMAIL</Th>}
                  {showColumn('telephone') && <Th className="w-[180px]">TÉLÉPHONE DU PROSPECT</Th>}
                  {showColumn('adresse') && <Th className="w-[220px]">ADRESSE</Th>}
                  {showColumn('ville') && <Th className="w-[140px]">VILLE</Th>}
                  {showColumn('codePostal') && <Th className="w-[120px]">CODE POSTAL</Th>}
                  {showColumn('leadGenere') && <Th className="w-[180px]">DATE/HEURE LEAD GÉNÉRÉ</Th>}
                  {showColumn('canal') && <Th className="w-[180px]">CANAL D'ACQUISITION</Th>}
                  {showColumn('campagne') && <Th className="w-[180px]">CAMPAGNE</Th>}
                  {showColumn('adset') && <Th className="w-[160px]">ADSET</Th>}
                  {showColumn('ad') && <Th className="w-[160px]">AD</Th>}
                  {showColumn('creationLead') && <Th className="w-[190px]">DATE DE CRÉATION DU LEAD</Th>}
                  {showColumn('datePassageRelance') && <Th className="w-[190px]">DATE DE PASSAGE EN RELANCE</Th>}
                  {showColumn('setter') && <Th className="w-[210px]">SETTER ASSIGNÉ</Th>}
                  {showColumn('appels') && <Th className="w-[160px]">APPELS</Th>}
                  {showColumn('premierAppel') && <Th className="w-[180px]">PREMIER APPEL</Th>}
                  {showColumn('jourRelance') && <Th className="w-[170px]">JOUR DE RELANCE</Th>}
                  {showColumn('nbAppelTotal') && <Th className="w-[140px]">NB D'APPEL TOTAL</Th>}
                  {showColumn('appel5min') && <Th className="w-[150px]">1ER APPEL &lt; 5 MIN ?</Th>}
                  {showColumn('urlFormulaireAppel') && <Th className="w-[190px]">URL FORMULAIRE APPEL</Th>}
                  {showColumn('logAppel') && <Th className="w-[120px]">LOG APPEL</Th>}
                  {showColumn('nbAppelsAujourdhui') && <Th className="w-[150px]">NB APPELS AUJOURD'HUI</Th>}
                  {showColumn('recordId') && <Th className="w-[180px]">RECORD ID</Th>}
                  {showColumn('modification') && <Th className="w-[180px]">DERNIÈRE MODIFICATION</Th>}
                  {showColumn('dernierAppel') && <Th className="w-[180px]">DERNIER APPEL</Th>}
                  {showColumn('appelDate') && <Th className="w-[190px]">DATE/HEURE DE L'APPEL</Th>}
                  {showColumn('pctLeadAppele5min') && <Th className="w-[160px]">% LEAD APPELÉ &lt; 5MIN</Th>}
                  {showColumn('campagnes') && <Th className="w-[240px]">CAMPAGNES</Th>}
                  {showColumn('jaugeAppels') && <Th className="w-[160px]">JAUGE APPELS (4/JOUR)</Th>}
                  {showColumn('prochainRappel') && <Th className="w-[220px]">DATE/HEURE PROCHAIN RAPPEL</Th>}
                  {showColumn('relanceMax') && <Th className="w-[160px]">JOUR RELANCE MAX</Th>}
                  {showColumn('jauge') && <Th className="w-[170px]">JAUGE 11 JOURS</Th>}
                  {showColumn('projets') && <Th className="w-[160px]">PROJETS</Th>}
                  {showColumn('localisationMap') && <Th className="w-[220px]">LOCALISATION MAP</Th>}
                  {showColumn('contactId') && <Th className="w-[180px]">CONTACT ID (GHL)</Th>}
                  {showColumn('adresseComplete') && <Th className="w-[260px]">ADRESSE COMPLÈTE</Th>}
                  {showColumn('creation') && <Th className="w-[160px]">DATE DE CRÉATION</Th>}
                  {showColumn('rdv') && <Th className="w-[190px]">RENDEZ-VOUS</Th>}
                  {showColumn('dateIso') && <Th className="w-[240px]">DATE ISO</Th>}
                  {showColumn('kpis') && <Th className="w-[160px]">KPI'S</Th>}
                  {showColumn('commercialRdv') && <Th className="w-[220px]">COMMERCIAL (FROM RENDEZ-VOUS)</Th>}
                </tr>
              </thead>
              <tbody>
                {visibleFiltered.map((l) => (
                  <tr
                    key={l.id}
                    data-lead-id={l.id}
                    className={`border-b border-line-soft last:border-0 cursor-pointer transition-colors ${
                      selectedId === l.id ? 'bg-or/20 shadow-[inset_4px_0_0_var(--color-or-dark)] !text-text' : 'hover:bg-white/40'
                    }`}
                    onClick={() => selectLead(l.id)}
                  >
                    {showColumn('nom') && <Td className="lead-sticky-cell"><span className="font-semibold truncate" title={fullName(l)}>{fullName(l)}</span></Td>}
                    {showColumn('statut') && <Td><span className={`status-badge ${STATUS_BADGE[l.status]}`}>{STATUS_LABEL[l.status]}</span></Td>}
                    {showColumn('email') && <Td className="text-muted truncate" title={cleanField(l.email) ?? undefined}>{fieldOrDash(l.email)}</Td>}
                    {showColumn('telephone') && <Td className="text-muted truncate" title={cleanField(l.phone) ?? undefined}>{fieldOrDash(l.phone)}</Td>}
                    {showColumn('adresse') && <Td className="text-muted truncate" title={cleanField(l.addressLine) ?? undefined}>{fieldOrDash(l.addressLine)}</Td>}
                    {showColumn('ville') && <Td className="text-muted truncate" title={cleanField(l.city) ?? undefined}>{fieldOrDash(l.city)}</Td>}
                    {showColumn('codePostal') && <Td className="text-muted truncate" title={cleanField(l.postalCode) ?? undefined}>{fieldOrDash(l.postalCode)}</Td>}
                    {showColumn('leadGenere') && <Td className="text-faint">{fullDateTime(l.createdAt)}</Td>}
                    {showColumn('canal') && <Td className="text-muted truncate" title={prettySource(l)}>{prettySource(l)}</Td>}
                    {showColumn('campagne') && <Td className="text-muted truncate" title={cleanField(campaignName(l)) ?? undefined}>{fieldOrDash(campaignName(l))}</Td>}
                    {showColumn('adset') && <Td className="text-muted truncate" title={cleanField(l.adset) ?? cleanField(l.utmMedium) ?? undefined}>{fieldOrDash(l.adset ?? l.utmMedium)}</Td>}
                    {showColumn('ad') && <Td className="text-muted truncate" title={cleanField(l.ad) ?? cleanField(l.utmSource) ?? undefined}>{fieldOrDash(l.ad ?? l.utmSource)}</Td>}
                    {showColumn('creationLead') && <Td className="text-faint">{fullDateTime(l.createdAt)}</Td>}
                    {showColumn('datePassageRelance') && <Td className="text-faint">{l.datePassageRelance ? fullDateTime(l.datePassageRelance) : '—'}</Td>}
                    {showColumn('setter') && <Td><SetterChips lead={l} userMap={userMap} /></Td>}
                    {showColumn('appels') && <Td className="text-faint">{l.callCount ?? 0} appel{(l.callCount ?? 0) > 1 ? 's' : ''}</Td>}
                    {showColumn('premierAppel') && <Td className="text-faint">{lastCallDateTime(l.firstCallAt ?? null)}</Td>}
                    {showColumn('jourRelance') && <Td className="text-faint">{formatDays(l.joursRelance)}</Td>}
                    {showColumn('nbAppelTotal') && <Td className="text-faint">{l.callCount ?? 0}</Td>}
                    {showColumn('appel5min') && <Td>{yesNo(l.firstCallUnderFiveMin)}</Td>}
                    {showColumn('urlFormulaireAppel') && <Td className="text-faint">—</Td>}
                    {showColumn('logAppel') && <Td><LeadCommentButton comment={l.latestCallComment} leadName={fullName(l)} onOpen={setOpenComment} /></Td>}
                    {showColumn('nbAppelsAujourdhui') && <Td className="text-faint">{l.callsToday ?? 0}</Td>}
                    {showColumn('recordId') && <Td className="text-muted truncate" title={l.externalId ?? l.id}>{l.externalId ?? l.id}</Td>}
                    {showColumn('modification') && <Td className="text-faint">{fullDateTime(l.updatedAt)}</Td>}
                    {showColumn('dernierAppel') && <Td className="text-faint">{lastCallDateTime(l.latestCallAt ?? l.lastContactAt)}</Td>}
                    {showColumn('appelDate') && <Td className="text-faint">{lastCallDateTime(l.latestCallAt ?? l.lastContactAt)}</Td>}
                    {showColumn('pctLeadAppele5min') && <Td>{yesNo(l.firstCallUnderFiveMin)}</Td>}
                    {showColumn('campagnes') && <Td className="text-muted truncate" title={campaignSummary(l)}>{campaignSummary(l)}</Td>}
                    {showColumn('jaugeAppels') && <Td><DailyCallGauge count={l.callsToday ?? 0} /></Td>}
                    {showColumn('prochainRappel') && <Td className="text-faint">{lastCallDateTime(l.nextCallbackAt ?? null)}</Td>}
                    {showColumn('relanceMax') && <Td className="text-faint">{formatDays(l.joursRelance)}</Td>}
                    {showColumn('jauge') && <Td><ElevenDayGauge jours={l.joursRelance ?? null} /></Td>}
                    {showColumn('projets') && <Td className="text-muted truncate" title={l.typeLogement ?? undefined}>{l.typeLogement ?? '—'}</Td>}
                    {showColumn('localisationMap') && <Td className="text-muted truncate" title={l.localisationMap ?? undefined}>{l.localisationMap ?? '—'}</Td>}
                    {showColumn('contactId') && <Td className="text-muted truncate" title={l.externalId ?? undefined}>{l.externalId ?? '—'}</Td>}
                    {showColumn('adresseComplete') && <Td className="text-muted truncate" title={addressFull(l)}>{addressFull(l)}</Td>}
                    {showColumn('creation') && <Td className="text-faint">{shortDate(l.createdAt)}</Td>}
                    {showColumn('rdv') && <Td className="text-faint">{rdvLabel(l)}</Td>}
                    {showColumn('dateIso') && <Td className="text-muted truncate" title={l.latestRdvAt ?? l.createdAt}>{l.latestRdvAt ?? l.createdAt}</Td>}
                    {showColumn('kpis') && <Td className="text-muted truncate" title={kpiSummary(l)}>{kpiSummary(l)}</Td>}
                    {showColumn('commercialRdv') && <Td className="text-muted truncate" title={commercialLabel(l, userMap)}>{commercialLabel(l, userMap)}</Td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleFiltered.length < filtered.length && (
              <div className="sticky left-0 flex justify-center border-t border-line-soft bg-white/80 p-3 backdrop-blur">
                <button
                  type="button"
                  onClick={() => setVisibleRows((count) => count + VISIBLE_ROWS_STEP)}
                  className="btn-secondary rounded-xl px-4 py-2 text-sm"
                >
                  Afficher plus de leads ({visibleFiltered.length}/{filtered.length})
                </button>
              </div>
            )}
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
  return lead.status === 'a_rappeler' || lead.status === 'relance' || Boolean(lead.nextCallbackAt)
}

/**
 * "Nouveau" inclut les leads jamais traités (status=nouveau) ET les leads en
 * pas_de_reponse tant qu'ils ont moins de SANS_REPONSE_THRESHOLD tentatives
 * consécutives sans décroché. On veut que le setter continue à les essayer
 * plutôt que de les oublier dans une catégorie séparée.
 */
function isNouveauLead(lead: LeadResponse): boolean {
  if (lead.status === 'nouveau') return true
  if (lead.status === 'pas_de_reponse' && (lead.consecutiveNoAnswerCount ?? 0) < SANS_REPONSE_THRESHOLD) return true
  return false
}

/**
 * "Sans réponse" : lead avec ≥ SANS_REPONSE_THRESHOLD appels consécutifs
 * infructueux. Sortir de la vue "Nouveaux" évite que le setter perde du temps
 * à rappeler des numéros morts ; ces leads sont à retravailler autrement
 * (relance email, WhatsApp, ou suppression).
 */
function isSansReponseLead(lead: LeadResponse): boolean {
  return (lead.consecutiveNoAnswerCount ?? 0) >= SANS_REPONSE_THRESHOLD
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
    // DATA-4: si l'enum LeadResponse['source'] s'enrichit côté backend
    // sans MAJ ici, on retombe sur un fallback explicite plutôt qu'undefined.
    default: return l.source ?? '—'
  }
}

function fullDateTime(iso: string): string {
  const d = new Date(iso)
  return `${shortDate(iso)} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function campaignName(l: Pick<LeadResponse, 'campaign' | 'utmCampaign'>): string | null {
  return cleanField(l.campaign) ?? cleanField(l.utmCampaign)
}

function campaignSummary(l: Pick<LeadResponse, 'campaign' | 'utmCampaign' | 'adset' | 'utmMedium' | 'ad' | 'utmSource'>): string {
  return [campaignName(l), cleanField(l.adset) ?? cleanField(l.utmMedium), cleanField(l.ad) ?? cleanField(l.utmSource)].filter(Boolean).join(' / ') || '—'
}

function rdvLabel(l: Pick<LeadResponse, 'latestRdvAt' | 'latestRdvStatus'>): string {
  if (!l.latestRdvAt) return '—'
  const status = l.latestRdvStatus ? RDV_STATUS_LABEL[l.latestRdvStatus] : 'RDV'
  return `${status} · ${fullDateTime(l.latestRdvAt)}`
}

function addressFull(l: Pick<LeadResponse, 'addressLine' | 'postalCode' | 'city'>): string {
  // DATA-1 défensif : cleanField filtre les "undefined"/"null" littéraux stockés
  // par certains imports legacy. On affiche toujours le lead — juste un tiret
  // pour les pièces manquantes.
  const addr = cleanField(l.addressLine)
  const postal = cleanField(l.postalCode)
  const city = cleanField(l.city)
  const tail = [postal, city].filter(Boolean).join(' ')
  return [addr, tail].filter(Boolean).join(', ') || '—'
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
          selectedRow.scrollIntoView({ block: 'center', inline: 'nearest' })
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
      return valid.length ? valid : defaultKeys
    } catch {
      return defaultKeys
    }
  })

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(visible))
  }, [storageKey, visible])

  return [visible, setVisible] as const
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
  // Index drag/drop : on retient l'index source au début du drag puis on swap
  // au drop. Si null → pas de drag en cours.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const hiddenCount = columns.length - visible.length
  const columnByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns])

  // Liste affichée : visibles dans l'ordre choisi, puis masquées dans l'ordre source.
  const visibleEntries = visible
    .map((k) => columnByKey[k])
    .filter((c): c is ColumnChoice => Boolean(c))
  const hiddenEntries = columns.filter((c) => !visible.includes(c.key))
  const q = query.trim().toLowerCase()
  const matchQuery = (c: ColumnChoice) => !q || c.label.toLowerCase().includes(q)

  const toggle = (key: ColumnKey) => {
    if (key === 'nom') return
    if (visible.includes(key)) {
      if (visible.length === 1) return
      onChange(visible.filter((k) => k !== key))
      return
    }
    onChange([...visible, key])
  }

  const moveVisible = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    if (from >= visible.length || to >= visible.length) return
    const next = [...visible]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const showAll = () => onChange(columns.map((c) => c.key))
  const showEssentials = () =>
    onChange(columns.filter((c) => ['nom', 'telephone', 'statut', 'setter', 'dernierAppel', 'jauge'].includes(c.key)).map((c) => c.key))

  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer inline-flex items-center gap-2 rounded-[14px] border border-line bg-white px-4 py-2 text-sm font-bold text-text shadow-sm hover:border-or hover:text-or select-none">
        <Icon name="settings" size={15} />
        Colonnes
        <span className="rounded-full bg-or-tint px-2 py-0.5 text-[11px] text-or-dark">{visible.length}/{columns.length}</span>
      </summary>
      <div className="absolute right-0 mt-3 w-[360px] max-h-[560px] overflow-hidden rounded-[22px] border border-line bg-white shadow-2xl z-40">
        <div className="border-b border-line-soft p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Vue du tableau</p>
              <h4 className="font-bold">Réorganiser & masquer les colonnes</h4>
              <p className="text-xs text-faint mt-1">Glissez les lignes visibles pour changer l'ordre. Le nom reste fixé à gauche.</p>
            </div>
            <span className="rounded-full bg-line-soft px-2.5 py-1 text-xs font-bold text-muted">{hiddenCount} masquée{hiddenCount > 1 ? 's' : ''}</span>
          </div>
          <div className="relative mt-3">
            <Icon name="search" size={14} className="absolute left-3 top-2.5 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une colonne…"
              className="w-full rounded-[12px] border border-line bg-cream px-8 py-2 text-sm focus:outline-none focus:border-or"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="rounded-full bg-text px-3 py-1.5 text-xs font-bold text-white" onClick={showAll}>Tout afficher</button>
            <button type="button" className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-muted hover:text-text" onClick={showEssentials}>Essentiel</button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-auto p-2">
          {/* Section visibles : drag-and-drop pour réordonner */}
          {visibleEntries.filter(matchQuery).length > 0 && (
            <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-faint">
              Affichées · glisser pour réordonner
            </p>
          )}
          {visibleEntries.map((column, idx) => {
            if (!matchQuery(column)) return null
            const locked = column.key === 'nom'
            const isDragOver = dragOverIndex === idx && dragIndex !== null && dragIndex !== idx
            return (
              <div
                key={column.key}
                draggable={!locked}
                onDragStart={(e) => {
                  if (locked) return
                  setDragIndex(idx)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (dragIndex === null || locked) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverIndex !== idx) setDragOverIndex(idx)
                }}
                onDragLeave={() => {
                  if (dragOverIndex === idx) setDragOverIndex(null)
                }}
                onDrop={(e) => {
                  if (dragIndex === null || locked) return
                  e.preventDefault()
                  moveVisible(dragIndex, idx)
                  setDragIndex(null)
                  setDragOverIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDragOverIndex(null)
                }}
                className={`flex items-center gap-2 rounded-[14px] px-2 py-2 text-sm transition-colors ${
                  isDragOver ? 'bg-or-tint' : 'hover:bg-line-soft'
                } ${locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
                title={locked ? 'Colonne fixe' : 'Glisser pour réorganiser'}
              >
                <span className={`text-faint ${locked ? 'opacity-30' : ''}`} aria-hidden>
                  <Icon name="grid" size={14} />
                </span>
                <input
                  type="checkbox"
                  checked={true}
                  disabled={locked || visible.length === 1}
                  onChange={() => toggle(column.key)}
                  className="accent-[var(--color-or)]"
                />
                <span className="flex-grow truncate" title={column.label}>{column.label}</span>
                {locked && <span className="rounded-full bg-cuivre-tint px-2 py-0.5 text-[10px] font-bold text-cuivre">fixe</span>}
              </div>
            )
          })}

          {/* Section masquées : cases à cocher seulement */}
          {hiddenEntries.filter(matchQuery).length > 0 && (
            <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-faint">Masquées</p>
          )}
          {hiddenEntries.map((column) => {
            if (!matchQuery(column)) return null
            return (
              <label
                key={column.key}
                className="flex items-center gap-3 rounded-[14px] px-3 py-2 text-sm hover:bg-line-soft cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggle(column.key)}
                  className="accent-[var(--color-or)]"
                />
                <span className="flex-grow truncate" title={column.label}>{column.label}</span>
                <span className="text-[11px] font-semibold text-faint">masquée</span>
              </label>
            )
          })}
        </div>
      </div>
    </details>
  )
}


function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 whitespace-nowrap ${className}`}>{children}</th>
}

function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-4 py-3 align-middle whitespace-nowrap ${className}`} title={title}>{children}</td>
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card p-5">
      <span className="eyebrow">{label}</span>
      <div className="text-[28px] font-bold mt-2 leading-none">{value}</div>
    </div>
  )
}

function ElevenDayGauge({ jours }: { jours: number | null }) {
  const safeDays = Math.max(0, jours ?? 0)
  const progress = Math.min(100, Math.round((safeDays / 11) * 100))
  const barColor = safeDays >= 11 ? 'bg-rouille' : safeDays >= 8 ? 'bg-or' : 'bg-success'
  const label = `${Math.min(safeDays, 11)}/11j`

  return (
    <div className="min-w-[86px]" title={label}>
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
  const phone = cleanField(lead.phone)
  if (!phone) return <span className="text-faint">—</span>
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onStartCall({ leadId: lead.id, leadName: fullName(lead), toNumber: phone }).catch((err) => {
          console.error('Phone copy failed', err)
          alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')
        })
      }}
      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-bold text-text hover:border-or hover:text-or"
      title="Copier le numéro pour appeler"
    >
      <Icon name="phone" size={13} />
      <span className="truncate">{phone}</span>
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
  const [open, setOpen] = useState(false)
  const ids = lead.assignedSetterIds?.length ? lead.assignedSetterIds : (lead.setterId ? [lead.setterId] : [])
  const names = ids
    .map((id) => {
      const user = userMap.get(id)
      return typeof user === 'string' ? user : user?.name
    })
    .filter((name): name is string => Boolean(name))
  const extraNames = names.slice(1)

  if (names.length === 0) return <span className="text-faint">—</span>

  return (
    <div className="relative flex items-center gap-1.5 min-w-0" title={names.join(', ')}>
      <PersonChip name={names[0]} tint="bg-cuivre-tint" />
      {extraNames.length > 0 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((current) => !current)
            }}
            className="rounded-full bg-line-soft px-2 py-1 text-[11px] font-bold text-muted flex-shrink-0 hover:bg-or-tint hover:text-or-dark"
            aria-label="Voir les autres setters assignés"
          >
            +{extraNames.length}
          </button>
          {open && (
            <div
              className="absolute left-0 top-full z-50 mt-2 w-64 rounded-[18px] border border-line bg-white p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-faint">Autres setters assignés</div>
              <div className="space-y-2">
                {extraNames.map((name) => (
                  <PersonChip key={name} name={name} tint="bg-or-tint" />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
