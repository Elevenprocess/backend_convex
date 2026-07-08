import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useClients, useLeads, useRdvList, useUsers } from '../lib/hooks'
import { fullName, type ClientResponse } from '../lib/types'
import {
  buildDossiers,
  readWorkflowState,
  type SuiviState,
  avg,
} from '../lib/suivi'
import { buildPeriodRange, defaultPeriod, type PeriodState } from '../lib/period'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { DossierCard } from '../components/suivi/DossierCard'
import { workflowPhaseProgress, PHASE_LABEL } from '../lib/suivi-board'
import { parseDeliveryPhase, clientMatchesPhase } from '../lib/deliveryOverview'
import { useCardGridVirtualizer } from '../lib/virtualGrid'
import { PhaseDonut } from '../components/delivery/PhaseDonut'
import { DeliveryTrendChart } from '../components/delivery/DeliveryTrendChart'
import { CountUp } from '../components/delivery/CountUp'
import type { Dossier } from '../lib/suivi'

type ProgressFilter = 'all' | 'todo' | 'running' | 'advanced' | 'blocked' | 'delivered'

const PROGRESS_FILTERS: { id: ProgressFilter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'todo', label: 'À démarrer' },
  { id: 'running', label: 'En cours' },
  { id: 'advanced', label: 'Avancés' },
  { id: 'blocked', label: 'Bloqués' },
  { id: 'delivered', label: 'Livrés' },
]

/** Le dossier appartient-il au bucket de progression demandé ? (source unique
 * pour la liste filtrée ET les compteurs de chips). */
function matchesProgress(filter: ProgressFilter, dossier: Dossier, client: ClientResponse | undefined): boolean {
  const pct = workflowPhaseProgress(client)?.pct ?? 0
  const delivered = client?.steps?.mes?.status === 'fait'
  const blocked = Boolean(client?.blocked || dossier.state.statuses[dossier.activeStep] === 'blocked')
  switch (filter) {
    case 'all': return true
    case 'todo': return pct <= 0 && !delivered
    case 'running': return pct > 0 && pct < 67 && !delivered && !blocked
    case 'advanced': return pct >= 67 && !delivered && !blocked
    case 'blocked': return blocked
    case 'delivered': return Boolean(delivered)
  }
}

export function Suivi() {
  const role = useAuth((s) => s.user?.role)
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  // Arrivée depuis le funnel du dashboard délivrabilité (/suivi?phase=racco…) :
  // on filtre sur la phase COURANTE du dossier, annulés/clôturés exclus.
  const phaseFilter = parseDeliveryPhase(params.get('phase'))
  const clearPhaseFilter = () => {
    setSearchParams((prev) => {
      prev.delete('phase')
      return prev
    }, { replace: true })
  }
  // Pas de rafraîchissement temps réel sur cette page : elle ne doit pas se
  // recharger/clignoter en continu au fil des events realtime (lead/rdv/appel).
  const NO_RT = { noRealtimeRefresh: true }
  // Source = leads SIGNÉS (pas le top-500 récent) : la page suit les dossiers
  // délivrabilité, dont beaucoup ont été signés les mois/années précédents et
  // tombaient donc hors du cap 500 → dossiers invisibles. `status:'signe'` charge
  // exactement les ~120 dossiers signés (index by_status), quelle que soit la date.
  const { data: leads, loading: leadsLoading } = useLeads({ status: 'signe', limit: 500 }, NO_RT)
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 }, NO_RT)
  const { data: users } = useUsers(NO_RT)
  const { data: clients } = useClients(undefined, NO_RT)
  const clientByLead = useMemo(() => {
    const map = new Map<string, ClientResponse>()
    for (const c of clients ?? []) map.set(c.leadId, c)
    return map
  }, [clients])
  // Nombre de projets (clients) par lead — un lead peut avoir plusieurs projets.
  const projectCountByLead = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of clients ?? []) map.set(c.leadId, (map.get(c.leadId) ?? 0) + 1)
    return map
  }, [clients])
  const [query, setQuery] = useState('')
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all')
  const [states, setStates] = useState<Record<string, SuiviState>>({})
  const now = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod('this_year'))
  const periodRange = useMemo(() => buildPeriodRange(period), [period])
  const allSignedDossiers = useMemo(
    () => buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states),
    [leads, rdvs, users, states],
  )
  // Un dossier signé se suit jusqu'à la livraison, même signé une année
  // précédente : la liste montre TOUS les dossiers actifs (parité Render). Le
  // sélecteur de période ne borne plus la liste (il reste pour le graphe de
  // tendance), sinon les dossiers signés hors période disparaissaient à tort.
  const signedDossiers = allSignedDossiers
  // Base commune (phase + recherche appliquées, PAS le filtre de progression) :
  // sert à la fois à la liste finale et aux compteurs des chips.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Filtre phase actif → base NON bornée par la période : le funnel Overview
    // compte tous les dossiers actifs quelle que soit leur date de signature,
    // on doit donc retrouver les mêmes dossiers ici.
    const base = phaseFilter ? allSignedDossiers : signedDossiers
    return base.filter((d) => {
      const client = clientByLead.get(d.id)
      if (phaseFilter && !clientMatchesPhase(client, phaseFilter)) return false
      if (!q) return true
      return [fullName(d.lead), d.lead.phone, d.lead.email, d.lead.city, d.commercial?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [signedDossiers, allSignedDossiers, query, phaseFilter, clientByLead])

  const filtered = useMemo(
    () => searched.filter((d) => matchesProgress(progressFilter, d, clientByLead.get(d.id))),
    [searched, progressFilter, clientByLead],
  )

  // Compteurs par bucket de progression (sur la base recherchée, filtre courant exclu).
  const filterCounts = useMemo(() => {
    const counts = {} as Record<ProgressFilter, number>
    for (const f of PROGRESS_FILTERS) {
      counts[f.id] = f.id === 'all' ? searched.length : searched.filter((d) => matchesProgress(f.id, d, clientByLead.get(d.id))).length
    }
    return counts
  }, [searched, clientByLead])

  // Compat redirect : /suivi?lead=X → fiche client complète.
  const legacyLead = params.get('lead')
  useEffect(() => {
    if (legacyLead) navigate(`/suivi/${legacyLead}/fiche`, { replace: true })
  }, [legacyLead, navigate])

  useEffect(() => {
    const loaded: Record<string, SuiviState> = {}
    for (const d of signedDossiers) loaded[d.id] = readWorkflowState(d.id)
    setStates((prev) => ({ ...loaded, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedDossiers.map((d) => d.id).join('|')])

  const scrollRef = useRef<HTMLElement>(null)

  // ── Scroll-offset correction (Finding 2) ──────────────────────────────────
  // `scrollRef` est sur <main>, qui contient aussi le hero/KPIs/filtres
  // (~300-400 px au-dessus de la grille). Sans scrollMargin, react-virtual
  // calculerait la fenêtre visible depuis le haut de <main>, pas depuis le
  // début de la grille. On mesure `offsetTop` du wrapper de grille via un
  // callback ref (stable, vide deps) : il se déclenche quand le div monte
  // (après chargement des données) et non sur le composant entier.
  const [scrollMarginValue, setScrollMarginValue] = useState(0)
  const gridWrapperRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      const offset = el.offsetTop
      // Guard against no-layout env (jsdom → offsetTop=0, tests OK with margin=0).
      setScrollMarginValue((prev) => (prev === offset ? prev : offset))
    }
  }, [])

  // ── Colonnes responsives ───────────────────────────────────────────────────
  // Miroir de `.suivi-grid { repeat(auto-fill, minmax(320px, 1fr)) }`.
  // Le hook mesure via ResizeObserver + mesure synchrone au montage.
  const { virtualizer: rowVirtualizer, columns } = useCardGridVirtualizer(scrollRef, filtered.length, {
    columns: (w) => Math.max(1, Math.floor(w / 320)),
    estimateRowHeight: 220,
    gap: 16,
    scrollMargin: scrollMarginValue,
  })

  if (role === 'technicien') return <Navigate to="/mes-dossiers" replace />

  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
    && role !== 'finances'
    && role !== 'commercial'
    && role !== 'commercial_lead'
  ) return <Navigate to="/overview" replace />

  const isLoading = leadsLoading || rdvLoading
  const blockedCount = (clients && clients.length)
    ? signedDossiers.filter((d) => clientByLead.get(d.id)?.blocked).length
    : signedDossiers.filter((d) => d.state.statuses[d.activeStep] === 'blocked').length
  const realProgressValues = signedDossiers
    .map((d) => workflowPhaseProgress(clientByLead.get(d.id))?.pct)
    .filter((v): v is number => typeof v === 'number')
  const progressAvg = Math.round(avg(realProgressValues))
  const deliveredCount = signedDossiers.filter((d) => clientByLead.get(d.id)?.steps?.mes?.status === 'fait').length
  const deliveryRate = signedDossiers.length ? Math.round((deliveredCount / signedDossiers.length) * 100) : 0
  const clientList = clients ?? []

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Dossiers signés" />
      <main ref={scrollRef} className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <header className="suivi-hero">
          <div>
            <span className="eyebrow">Pipeline Délivrabilité</span>
            <h1>Prospects signés à suivre</h1>
            <p>Fiches clients, progression installation et blocages.</p>
          </div>
          <div className="suivi-hero-actions">
            <DateRangePicker value={period} onChange={setPeriod} align="right" />
            <input
              type="search"
              placeholder="Rechercher un dossier…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="suivi-search"
            />
          </div>
        </header>

        <section className="suivi-insights dfx-fade">
          <div className="suivi-stat-panel">
            <div className="suivi-stat-ring" style={{ ['--p' as string]: progressAvg }}>
              <div className="suivi-stat-ring-inner">
                <CountUp className="suivi-stat-ring-val" value={progressAvg} format={(n) => `${n}%`} />
                <small>progression</small>
              </div>
            </div>
            <div className="suivi-stat-figures">
              <div className="suivi-stat-fig">
                <CountUp className="suivi-stat-num" value={signedDossiers.length} />
                <span>Dossiers signés</span>
              </div>
              <div className="suivi-stat-fig">
                <CountUp className="suivi-stat-num suivi-stat-num--ok" value={deliveredCount} />
                <span>Livrés · {deliveryRate}%</span>
              </div>
              {blockedCount > 0 && (
                <button type="button" className="suivi-stat-alert" onClick={() => setProgressFilter('blocked')}>
                  <CountUp value={blockedCount} /> bloqué{blockedCount > 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
          <PhaseDonut clients={clientList} />
          <DeliveryTrendChart clients={clientList} now={now} subtitle={periodRange.label} />
        </section>

        <section className="suivi-filters" aria-label="Filtres de progression">
          {PROGRESS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={progressFilter === filter.id ? 'active' : ''}
              onClick={() => setProgressFilter(filter.id)}
            >
              {filter.label}
              <span className="suivi-filter-count">{filterCounts[filter.id]}</span>
            </button>
          ))}
          {phaseFilter && (
            <button
              type="button"
              className="active"
              title="Retirer le filtre de phase"
              onClick={clearPhaseFilter}
            >
              Phase : {PHASE_LABEL[phaseFilter]} ✕
            </button>
          )}
        </section>

        {isLoading ? (
          <LoadingBlock label="Chargement des dossiers signés…" />
        ) : filtered.length === 0 ? (
          <div className="suivi-empty">
            <p>{query || progressFilter !== 'all' || phaseFilter ? 'Aucun dossier ne correspond aux filtres.' : 'Aucun dossier signé pour cette période.'}</p>
            {(query || progressFilter !== 'all' || phaseFilter) && <button type="button" onClick={() => { setQuery(''); setProgressFilter('all'); clearPhaseFilter() }}>Réinitialiser les filtres</button>}
          </div>
        ) : (
          <div ref={gridWrapperRef} style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const start = vRow.index * columns
              const rowItems = filtered.slice(start, start + columns)
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
                    // vRow.start est absolu depuis le haut du scroll-element ;
                    // on soustrait scrollMarginValue pour obtenir la position
                    // relative au début du wrapper de grille (pattern officiel
                    // react-virtual scrollMargin).
                    transform: `translateY(${vRow.start - scrollMarginValue}px)`,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                    gap: 16,
                  }}
                >
                  {rowItems.map((d) => (
                    <DossierCard key={d.id} dossier={d} client={clientByLead.get(d.id)} projectCount={projectCountByLead.get(d.id)} onClick={() => navigate(`/suivi/${d.id}/fiche`)} />
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </AppShell>
  )
}
