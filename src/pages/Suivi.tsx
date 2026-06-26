import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useClients, useLeads, useRdvList, useUsers } from '../lib/hooks'
import { fullName, type ClientResponse } from '../lib/types'
import {
  buildDossiers,
  isDateInRange,
  readWorkflowState,
  type SuiviState,
  avg,
} from '../lib/suivi'
import { buildPeriodRange, defaultPeriod, type PeriodState } from '../lib/period'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { DossierCard } from '../components/suivi/DossierCard'
import { workflowPhaseProgress } from '../lib/suivi-board'

type ProgressFilter = 'all' | 'todo' | 'running' | 'advanced' | 'blocked' | 'delivered'

const PROGRESS_FILTERS: { id: ProgressFilter; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'todo', label: 'À démarrer' },
  { id: 'running', label: 'En cours' },
  { id: 'advanced', label: 'Avancés' },
  { id: 'blocked', label: 'Bloqués' },
  { id: 'delivered', label: 'Livrés' },
]

export function Suivi() {
  const role = useAuth((s) => s.user?.role)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Pas de rafraîchissement temps réel sur cette page : elle ne doit pas se
  // recharger/clignoter en continu au fil des events realtime (lead/rdv/appel).
  const NO_RT = { noRealtimeRefresh: true }
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 }, NO_RT)
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
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod('this_year'))
  const periodRange = useMemo(() => buildPeriodRange(period), [period])
  const periodFrom = useMemo(() => new Date(periodRange.from), [periodRange.from])
  const periodTo = useMemo(() => new Date(periodRange.to), [periodRange.to])

  const allSignedDossiers = useMemo(
    () => buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states),
    [leads, rdvs, users, states],
  )
  const signedDossiers = useMemo(
    () => allSignedDossiers.filter((d) => isDateInRange(d.signedAt, periodFrom, periodTo)),
    [allSignedDossiers, periodFrom, periodTo],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return signedDossiers.filter((d) => {
      const client = clientByLead.get(d.id)
      const pct = workflowPhaseProgress(client)?.pct ?? 0
      const delivered = client?.steps?.mes?.status === 'fait'
      const blocked = client?.blocked || d.state.statuses[d.activeStep] === 'blocked'
      if (progressFilter === 'todo' && (pct > 0 || delivered)) return false
      if (progressFilter === 'running' && (pct <= 0 || pct >= 67 || delivered || blocked)) return false
      if (progressFilter === 'advanced' && (pct < 67 || delivered || blocked)) return false
      if (progressFilter === 'blocked' && !blocked) return false
      if (progressFilter === 'delivered' && !delivered) return false
      if (!q) return true
      return [fullName(d.lead), d.lead.phone, d.lead.email, d.lead.city, d.commercial?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [signedDossiers, query, progressFilter, clientByLead])

  // Compat redirect : /suivi?lead=X → /suivi/X
  const legacyLead = params.get('lead')
  useEffect(() => {
    if (legacyLead) navigate(`/suivi/${legacyLead}`, { replace: true })
  }, [legacyLead, navigate])

  useEffect(() => {
    const loaded: Record<string, SuiviState> = {}
    for (const d of signedDossiers) loaded[d.id] = readWorkflowState(d.id)
    setStates((prev) => ({ ...loaded, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedDossiers.map((d) => d.id).join('|')])

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

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Dossiers signés" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
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

        <section className="suivi-kpis">
          <div className="kpi-card suivi-kpi"><strong>{signedDossiers.length}</strong><span>Dossiers signés</span></div>
          <div className="kpi-card suivi-kpi"><strong>{progressAvg}%</strong><span>Progression moyenne</span></div>
          <div className="kpi-card suivi-kpi"><strong>{blockedCount}</strong><span>Bloqués</span></div>
          <div className="kpi-card suivi-kpi"><strong>{deliveredCount}</strong><span>Livrés</span></div>
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
            </button>
          ))}
        </section>

        {isLoading ? (
          <LoadingBlock label="Chargement des dossiers signés…" />
        ) : filtered.length === 0 ? (
          <div className="suivi-empty">
            <p>{query || progressFilter !== 'all' ? 'Aucun dossier ne correspond aux filtres.' : 'Aucun dossier signé pour cette période.'}</p>
            {(query || progressFilter !== 'all') && <button type="button" onClick={() => { setQuery(''); setProgressFilter('all') }}>Réinitialiser les filtres</button>}
          </div>
        ) : (
          <section className="suivi-grid">
            {filtered.map((d) => (
              <DossierCard key={d.id} dossier={d} client={clientByLead.get(d.id)} projectCount={projectCountByLead.get(d.id)} onClick={() => navigate(`/suivi/${d.id}/fiche`)} />
            ))}
          </section>
        )}
      </main>
    </AppShell>
  )
}
