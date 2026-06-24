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
  buildSuiviPeriodRange,
  getDefaultSuiviPeriod,
  isDateInRange,
  readWorkflowState,
  SUIVI_PERIOD_OPTIONS,
  type SuiviPeriodState,
  type SuiviState,
  avg,
} from '../lib/suivi'
import { DossierCard } from '../components/suivi/DossierCard'

export function Suivi() {
  const role = useAuth((s) => s.user?.role)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()
  const { data: clients } = useClients()
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
  const [states, setStates] = useState<Record<string, SuiviState>>({})
  const [period, setPeriod] = useState<SuiviPeriodState>(getDefaultSuiviPeriod)
  const periodRange = useMemo(() => buildSuiviPeriodRange(period), [period])

  const allSignedDossiers = useMemo(
    () => buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states),
    [leads, rdvs, users, states],
  )
  const signedDossiers = useMemo(
    () => allSignedDossiers.filter((d) => isDateInRange(d.signedAt, periodRange.from, periodRange.to)),
    [allSignedDossiers, periodRange],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return signedDossiers
    return signedDossiers.filter((d) => [fullName(d.lead), d.lead.phone, d.lead.email, d.lead.city, d.commercial?.name].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [signedDossiers, query])

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

  if (role === 'technicien') return <Navigate to="/mes-interventions" replace />

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
  const progressAvg = Math.round(avg(signedDossiers.map((d) => d.progress)))
  const deliveredCount = signedDossiers.filter((d) => d.progress >= 100).length

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Dossiers signés" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <header className="suivi-hero">
          <div>
            <span className="eyebrow">Pipeline Délivrabilité</span>
            <h1>Prospects signés à suivre</h1>
            <p>Chaque card ouvre la fiche complète du prospect avec les données setter, commercial et le workflow associé.</p>
          </div>
          <div className="suivi-hero-actions">
            <div className="suivi-period" role="group" aria-label="Période">
              {SUIVI_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={period.mode === option.id ? 'active' : ''}
                  onClick={() => setPeriod((current) => ({ ...current, mode: option.id }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
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

        {isLoading ? (
          <LoadingBlock label="Chargement des dossiers signés…" />
        ) : filtered.length === 0 ? (
          <div className="suivi-empty">
            <p>{query ? 'Aucun dossier ne correspond à votre recherche.' : 'Aucun dossier signé pour cette période.'}</p>
            {query && <button type="button" onClick={() => setQuery('')}>Effacer la recherche</button>}
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
