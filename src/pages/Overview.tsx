import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { MagicKpi } from '../components/kpi/MagicKpi'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useDisplayUser } from '../lib/role'
import { useCallLogs, useClients, useLeads, useRdvList, useUsers, useStartCall, useAnalyticsFunnel, useAnalyticsSummary, useDebriefAnalytics, prefetchAnalyticsFunnel, prefetchAnalyticsSummary, type DebriefAnalyticsResponse } from '../lib/hooks'
import { STATUS_LABEL, DEBRIEF_ACCEPTANCE_FACTOR_LABEL, DEBRIEF_NON_SALE_REASON_LABEL, fullName, initials, type AnalyticsFunnelResponse, type CallLogResponse, type DebriefAcceptanceFactor, type DebriefNonSaleReason, type LeadResponse, type LeadStatus, type RdvResponse, type UserResponse } from '../lib/types'
import { computeTechnicienStats, computeTerrainPipeline, selectUnassignedVt, type TechnicienStat } from '../lib/technicienStats'
import { buildSuiviPeriodRange, getDefaultSuiviPeriod, SUIVI_PERIOD_OPTIONS, type SuiviPeriodState } from '../lib/suivi'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { previousRange } from '../lib/period'
import { buildEvolutionTicks, computeEvolutionDomain, type EvolutionGranularity } from '../lib/evolutionAxis'

type FunnelPeriodMode = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'last_n_days' | 'custom'
type FunnelPeriodState = { mode: FunnelPeriodMode; customFrom: string; customTo: string; lastN?: number; includeToday?: boolean }
type FunnelPeriodRange = { from: string; to: string; label: string; days: number }

const funnelTodayInput = toDateInputValue(new Date())
const DEFAULT_FUNNEL_PERIOD: FunnelPeriodState = { mode: 'today', customFrom: funnelTodayInput, customTo: funnelTodayInput }
const FUNNEL_PERIOD_OPTIONS: { id: FunnelPeriodMode; label: string }[] = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'yesterday', label: 'Hier' },
  { id: 'this_week', label: 'Cette semaine' },
  { id: 'last_week', label: 'Semaine dernière' },
  { id: 'this_month', label: 'Ce mois-ci' },
  { id: 'last_month', label: 'Mois dernier' },
  { id: 'this_year', label: 'Cette année' },
  { id: 'last_year', label: "L'année dernière" },
  { id: 'last_n_days', label: 'Période personnalisée' },
  { id: 'custom', label: 'Plage de dates' },
]

const EMPTY_FUNNEL_TOTALS: AnalyticsFunnelResponse['totals'] = {
  newLeads: 0,
  calls: 0,
  answered: 0,
  responseRate: 0,
  qualified: 0,
  qualificationRate: 0,
  notQualified: 0,
  notQualifiedRate: 0,
  noAnswer: 0,
  relances: 0,
  rdv: 0,
  globalConversionRate: 0,
  lossesBeforeCall: 0,
  lossesAfterNoAnswer: 0,
  lossesAfterNotQualified: 0,
}

export function Overview() {
  const role = useAuth((s) => s.user?.role)

  if (role === 'admin') return <OverviewAdmin />
  // commercial_lead = responsable commercial : même UI que commercial mais
  // sans filtre me.id (cf. OverviewCommercial → `isManager`), il supervise
  // toute l'équipe closing.
  if (role === 'commercial' || role === 'commercial_lead') return <OverviewCommercial />
  // Délivrabilité (legacy) + son split : responsable_technique / back_office / technicien.
  // responsable_technique a sa propre vue de pilotage techniciens.
  if (role === 'responsable_technique') return <OverviewResponsableTechnique />
  // back_office / technicien / délivrabilité voient la vue Suivi (basée sur /leads et /rdv).
  if (role === 'delivrabilite' || role === 'back_office' || role === 'technicien') return <OverviewSuivi />
  return <OverviewSetter />
}

function OverviewSuivi() {
  const navigate = useNavigate()
  const { data: leadsData } = useLeads({ limit: 500 })
  const { data: rdvsData } = useRdvList({ limit: 200 })
  const leads = leadsData ?? []
  const rdvs = rdvsData ?? []
  const signedRdvs = rdvs.filter((r) => r.result === 'signe' || Boolean(r.signatureAt))
  const signedLeadIds = new Set(signedRdvs.map((r) => r.leadId))
  const signedLeads = leads.filter((l) => l.status === 'signe' || signedLeadIds.has(l.id))
  const inTech = signedLeads.filter((l) => l.latestRdvStatus === 'honore' || l.status === 'signe').length
  const blocked = signedLeads.filter((l) => l.lostReason || l.ghlStageName?.toLowerCase().includes('perdu')).length
  const ca = signedRdvs.reduce((sum, r) => sum + (Number(r.montantTotal ?? 0) || 0), 0)

  return (
    <AppShell flat>
      <Topbar eyebrow="DÉLIVRABILITÉ" title="Overview suivi dossiers" />
      <main className="overview-shot-page flex-grow overflow-auto">
        <div className="overview-air-header">
          <div>
            <span className="shot-eyebrow">Post-signature · AD</span>
            <h1>Suivi complet des prospects signés</h1>
          </div>
          <button type="button" className="rounded-full bg-success text-white px-4 py-2 text-xs font-black" onClick={() => navigate('/suivi')}>Ouvrir le workflow</button>
        </div>
        <section className="overview-air-grid">
          <AirKpi icon="trophy" label="Dossiers signés" value={fmtCompact(signedLeads.length)} sub="devis à livrer" />
          <AirKpi icon="settings" label="Technique / pose" value={fmtCompact(inTech)} sub="VT, CNO ou installation" />
          <AirKpi icon="shield" label="Blocages" value={fmtCompact(blocked)} sub="à débloquer rapidement" />
          <AirKpi icon="tag" label="CA signé" value={fmtKEur(ca)} sub="base RDV signés" />
          <div className="overview-air-card overview-role-wide">
            <CardHead title="Workflow livraison" icon="grid" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {['Devis signé', 'VT sous 72h', 'DP / CNO', 'Installation'].map((label, i) => (
                <button key={label} type="button" onClick={() => navigate('/suivi')} className="rounded-[18px] border border-line-soft bg-white/70 px-4 py-5 text-left hover:border-success/50 transition">
                  <span className="text-[10px] font-black text-faint">0{i + 1}</span>
                  <strong className="block mt-2 text-sm">{label}</strong>
                  <small className="text-muted">cliquer pour piloter</small>
                </button>
              ))}
            </div>
          </div>
          <div className="overview-air-card overview-role-side">
            <CardHead title="À suivre maintenant" icon="bell" />
            <div className="overview-role-list">
              {signedLeads.slice(0, 5).map((lead) => (
                <div key={lead.id} className="overview-role-row">
                  <div className="overview-role-avatar">{initials(lead)}</div>
                  <div><strong>{fullName(lead) || lead.phone}</strong><small>{lead.city ?? '—'} · {STATUS_LABEL[lead.status]}</small></div>
                  <button onClick={() => navigate(`/suivi?lead=${lead.id}`)}>Suivi</button>
                </div>
              ))}
              {signedLeads.length === 0 && <div className="text-xs text-faint">Aucun dossier signé chargé.</div>}
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  )
}

function OverviewResponsableTechnique() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<SuiviPeriodState>(getDefaultSuiviPeriod())
  const { data: clients = [] } = useClients()
  const { data: users = [] } = useUsers()

  const techniciens = useMemo(
    () => (users ?? []).filter((u) => u.role === 'technicien'),
    [users],
  )
  const range = useMemo(() => buildSuiviPeriodRange(period), [period])

  const stats = useMemo<TechnicienStat[]>(
    () => computeTechnicienStats(clients ?? [], techniciens, { from: range.from, to: range.to }),
    [clients, techniciens, range],
  )
  const pipeline = useMemo(() => computeTerrainPipeline(clients ?? []), [clients])
  const unassigned = useMemo(() => selectUnassignedVt(clients ?? []), [clients])

  const totalCharge = stats.reduce((s, t) => s + t.chargeEnCours, 0)
  const totalRetard = stats.reduce((s, t) => s + t.retardOuProbleme, 0)
  const installAVenir = pipeline.installation.a_faire + pipeline.installation.planifie

  return (
    <AppShell flat>
      <Topbar eyebrow="RESPONSABLE TECHNIQUE" title="Pilotage technique" />
      <main className="overview-shot-page flex-grow overflow-auto">
        <div className="overview-air-header">
          <div>
            <span className="shot-eyebrow">Terrain · VT & Installation</span>
            <h1>Suivi des techniciens</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            {SUIVI_PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod((p) => ({ ...p, mode: opt.id }))}
                className={`rounded-full px-3 py-1.5 text-xs font-black border transition ${period.mode === opt.id ? 'bg-text text-white border-text' : 'border-line-soft text-muted'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <section className="overview-air-grid">
          <AirKpi icon="inbox" label="VT à attribuer" value={fmtCompact(unassigned.length)} sub="sans technicien" />
          <AirKpi icon="settings" label="VT en cours" value={fmtCompact(totalCharge)} sub="charge active" />
          <AirKpi icon="shield" label="VT en retard / problème" value={fmtCompact(totalRetard)} sub="à débloquer" />
          <AirKpi icon="check" label="Installations à venir" value={fmtCompact(installAVenir)} sub="à faire + planifiées" />

          <div className="overview-air-card overview-role-wide">
            <CardHead title="Techniciens" icon="users" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              {stats.length === 0 && <div className="text-xs text-faint">Aucun technicien.</div>}
              {stats.map((s) => (
                <div key={s.technicien.id} className="rounded-[18px] border border-line-soft bg-white/70 px-4 py-4">
                  <div className="flex items-center justify-between">
                    <strong className="text-sm">{s.technicien.name}</strong>
                    <span className="text-[10px] font-black text-faint">{s.tauxValidation}% validées</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <div><strong className="block text-lg tabular-nums">{s.chargeEnCours}</strong><small className="text-muted">en cours</small></div>
                    <div><strong className="block text-lg tabular-nums text-danger">{s.retardOuProbleme}</strong><small className="text-muted">retard</small></div>
                    <div><strong className="block text-lg tabular-nums">{s.realiseesPeriode}</strong><small className="text-muted">réalisées</small></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overview-air-card overview-role-side">
            <CardHead title="VT à attribuer" icon="bell" />
            <div className="overview-role-list">
              {unassigned.slice(0, 6).map((c) => (
                <div key={c.id} className="overview-role-row">
                  <div><strong>{c.lead.fullName ?? c.lead.phone ?? 'Dossier'}</strong><small>{c.lead.city ?? '—'}</small></div>
                  <button onClick={() => navigate(`/suivi/${c.leadId}`)}>Attribuer</button>
                </div>
              ))}
              {unassigned.length === 0 && <div className="text-xs text-faint">Tout est attribué 🎉</div>}
            </div>
          </div>

          <div className="overview-air-card overview-role-wide">
            <CardHead title="Pipeline terrain" icon="grid" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {([
                { label: 'VT à planifier', value: pipeline.vt.a_faire },
                { label: 'VT planifiées', value: pipeline.vt.planifie },
                { label: 'VT réalisées', value: pipeline.vt.en_cours },
                { label: 'VT validées', value: pipeline.vt.fait },
                { label: 'Install. à faire', value: pipeline.installation.a_faire },
                { label: 'Install. planifiées', value: pipeline.installation.planifie },
                { label: 'Install. en cours', value: pipeline.installation.en_cours },
                { label: 'Install. posées', value: pipeline.installation.fait },
              ]).map((stage) => (
                <button key={stage.label} type="button" onClick={() => navigate('/suivi')} className="rounded-[18px] border border-line-soft bg-white/70 px-4 py-4 text-left hover:border-success/50 transition">
                  <strong className="block text-2xl tabular-nums">{stage.value}</strong>
                  <small className="text-muted">{stage.label}</small>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  )
}

// ----- F2 Setter -----
function OverviewSetter() {
  const navigate = useNavigate()
  const startCall = useStartCall()
  const display = useDisplayUser()
  const me = useAuth((s) => s.user)
  const [tab, setTab] = useState('overview')
  const [callbackTab, setCallbackTab] = useState<'late' | 'today' | 'tomorrow'>('today')
  const [activityRange, setActivityRange] = useState<'today' | 'week'>('today')
  const { data: leads = [] } = useLeads({ limit: 500 })
  const { data: calls = [] } = useCallLogs(me?.id ? { setterId: me.id, limit: 3000 } : { limit: 3000 })

  const callbacks = useMemo(
    () =>
      (leads ?? [])
        .filter((l) => belongsToSetter(l, me?.id))
        .filter((l) => l.nextCallbackAt && (l.status === 'a_rappeler' || l.status === 'relance' || Boolean(l.nextCallbackAt)))
        .filter((l) => callbackBucket(l.nextCallbackAt) === callbackTab)
        .sort((a, b) => new Date(a.nextCallbackAt!).getTime() - new Date(b.nextCallbackAt!).getTime()),
    [leads, me?.id, callbackTab],
  )

  const stats = useMemo(() => {
    const list = leads ?? []
    const ownLeads = list.filter((l) => belongsToSetter(l, me?.id))
    const classified = ownLeads.filter(isClassifiedLead)
    const loggedCalls = calls ?? []
    const appels = Math.max(loggedCalls.length, classified.length)
    // A lead is "connected" if we actually spoke to them — includes qualifie, pas_qualifie, rdv_*, signe, perdu.
    // Status nouveau/relance/a_rappeler/pas_de_reponse = no contact yet.
    const connectedStatuses: LeadStatus[] = ['qualifie', 'pas_qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu']
    const qualifiedStatuses: LeadStatus[] = ['qualifie', 'rdv_pris', 'rdv_honore', 'signe']
    const connexions = Math.max(
      loggedCalls.filter((c) => c.result === 'joint' || c.result === 'rdv_pris').length,
      classified.filter((l) => connectedStatuses.includes(l.status)).length,
    )
    const qualifies = classified.filter((l) => qualifiedStatuses.includes(l.status)).length
    const rdvPris = classified.filter((l) => l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length
    const leadsToday = ownLeads.filter((l) => isCreatedToday(l.createdAt)).length
    return {
      appels,
      connexions,
      qualifies,
      rdvPris,
      leadsToday,
      total: ownLeads.length,
      ownLeads,
      qualifRate: ratePct(connexions, qualifies),
      connectionRate: ratePct(appels, connexions),
      activityToday: todayLogicalCallSeries(loggedCalls, classified),
      activityWeek: weekLogicalCallSeries(loggedCalls, classified),
    }
  }, [leads, calls, me?.id])

  return (
    <AppShell flat>
      <Topbar
        eyebrow="SETTER"
        title={`Bonjour, ${display.firstName}`}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'performance', label: 'Performance' },
          { id: 'notifications', label: 'Notification' },
          { id: 'leads', label: 'Leads' },
        ]}
        activeTab={tab}
        onTabChange={(id) => {
          setTab(id)
          if (id === 'leads') navigate('/leads')
          if (id === 'notifications') navigate('/notifications')
          if (id === 'performance') navigate('/analytics')
        }}
      />
      <main className="overview-shot-page flex-grow overflow-auto">
        <div className="overview-air-header">
          <div>
            <span className="shot-eyebrow">ECOI SaaS · setter</span>
            <h1>Mon activité appels</h1>
          </div>
          <div className="overview-profile-chip">
            <div className="overview-profile-photo">
              {me?.image ? <img src={me.image} alt={me.name ?? 'Profil'} /> : <span>{userInitials(me?.name ?? display.firstName)}</span>}
            </div>
            <div>
              <strong>{me?.name ?? display.firstName}</strong>
              <small>{me?.email ?? 'Setter ECOI'}</small>
            </div>
          </div>
        </div>

        <section className="overview-air-grid overview-setter-grid">
          <div className="overview-setter-summary">
            <div className="overview-profile-panel">
              <div className="overview-profile-large">
                {me?.image ? <img src={me.image} alt={me.name ?? 'Profil'} /> : <span>{userInitials(me?.name ?? display.firstName)}</span>}
              </div>
              <div>
                <span className="shot-eyebrow">Portefeuille</span>
                <h2>{fmtCompact(stats.total)} leads</h2>
                <p>{fmtCompact(callbacks.length)} rappels sur le créneau sélectionné</p>
              </div>
            </div>
            <div className="overview-setter-kpis">
              <AirKpi icon="inbox" label="Nouveaux aujourd'hui" value={fmtCompact(stats.leadsToday)} sub="leads arrivés" />
              <AirKpi icon="phone" label="Appels" value={fmtCompact(stats.appels)} sub={`${stats.connectionRate}% connexion`} />
              <AirKpi icon="users" label="Connexions" value={fmtCompact(stats.connexions)} sub="contacts joints" />
              <AirKpi icon="target" label="Qualifiés" value={fmtCompact(stats.qualifies)} sub={`${stats.qualifRate}% qualification`} />
              <AirKpi icon="trophy" label="RDV pris" value={fmtCompact(stats.rdvPris)} sub="issus de tes leads" />
            </div>
          </div>

          <div className="overview-air-card overview-role-wide">
            <div className="shot-card-head">
              <h3>Appels setter</h3>
              <PillTabs
                items={[{ id: 'today', label: "Aujourd'hui" }, { id: 'week', label: 'Semaine' }]}
                active={activityRange}
                onChange={(id) => setActivityRange(id as 'today' | 'week')}
              />
            </div>
            <div className="overview-role-chart">
              <FuturisticLineChart
                points={activityRange === 'today' ? stats.activityToday : stats.activityWeek}
                color="#1F7857"
                caption={activityRange === 'today' ? "Aujourd'hui" : '7 derniers jours'}
              />
            </div>
          </div>

          <LeadPieAnalysis leads={stats.ownLeads} />

          <div className="overview-air-card overview-role-side">
            <CardHead title="À rappeler" icon="phone" />
            <PillTabs
              items={[{ id: 'late', label: 'Oubliés' }, { id: 'today', label: "Aujourd'hui" }, { id: 'tomorrow', label: 'Demain' }]}
              active={callbackTab}
              onChange={(id) => setCallbackTab(id as 'late' | 'today' | 'tomorrow')}
            />
            <div className="overview-role-list">
              {callbacks.length === 0 ? (
                <div className="text-xs text-faint">Aucun appel à faire sur ce créneau.</div>
              ) : callbacks.slice(0, 5).map((l) => (
                <div key={l.id} className="overview-role-row">
                  <div className="overview-role-avatar">{initials(l)}</div>
                  <div>
                    <strong>{fullName(l)}</strong>
                    <small>{formatCallbackTime(l.nextCallbackAt)} · {l.phone ?? 'sans téléphone'}</small>
                  </div>
                  <button
                    onClick={() => {
                      if (!l.phone) return
                      startCall({ leadId: l.id, leadName: fullName(l), toNumber: l.phone }).catch((err) => {
                        console.error('Phone copy failed', err)
                        alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')
                      })
                    }}
                    disabled={!l.phone}
                  >Appeler</button>
                </div>
              ))}
            </div>
          </div>

          <div className="overview-air-card overview-role-side">
            <CardHead title="Progression réelle" icon="check" />
            <TaskLine icon="phone" title="Appels" sub={`${fmtCompact(stats.appels)} appels enregistrés`} done={stats.appels > 0} />
            <TaskLine icon="users" title="Connexions" sub={`${fmtCompact(stats.connexions)} contacts joints`} done={stats.connexions > 0} />
            <TaskLine icon="target" title="Qualifiés" sub={`${fmtCompact(stats.qualifies)} leads qualifiés`} done={stats.qualifies > 0} />
            <TaskLine icon="trophy" title="RDV" sub={`${fmtCompact(stats.rdvPris)} rendez-vous pris`} done={stats.rdvPris > 0} />
          </div>
        </section>
      </main>
    </AppShell>
  )
}

// ----- F3 Commercial -----
function OverviewCommercial() {
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const display = useDisplayUser()
  const [tab, setTab] = useState('overview')
  // Un commercial_lead voit l'ensemble de l'équipe closing, pas seulement ses
  // propres RDV — pas de filtre commercialId, pas de scope `me.id` dans les
  // helpers de prospects/débriefs.
  const isManager = me?.role === 'commercial_lead'
  const scopeCommercialId = isManager ? undefined : me?.id
  const [commercialPeriod, setCommercialPeriod] = useState<FunnelPeriodState>({ ...DEFAULT_FUNNEL_PERIOD, mode: 'this_month' })
  const commercialRange = buildFunnelPeriodRange(commercialPeriod)
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const { data: rdvs = [] } = useRdvList({ commercialId: scopeCommercialId, fromDate: commercialRange.from, toDate: commercialRange.to, limit: 200 })
  const { data: commercialSummary } = useAnalyticsSummary({ from: commercialRange.from, to: commercialRange.to })
  const { data: allLeads = [] } = useLeads({ limit: 500 })
  const { data: debriefAnalytics } = useDebriefAnalytics({ from: commercialRange.from, to: commercialRange.to, commercialId: scopeCommercialId })
  const qualifiedDebriefSegments = useMemo(() => acceptanceFactorSegments(debriefAnalytics), [debriefAnalytics])
  const nonSaleDebriefSegments = useMemo(() => nonSaleReasonSegments(debriefAnalytics), [debriefAnalytics])

  const stats = useMemo(() => {
    const list = rdvs ?? []
    const leadList = allLeads ?? []
    const analytics = commercialSummary?.commercial
    const leadsToday = leadList.filter((l) => isCreatedInRange(l.createdAt, commercialRange.from, commercialRange.to)).length
    const honored = list.filter((r) => r.status === 'honore')
    const signed = list.filter((r) => r.result === 'signe')
    const lost = list.filter((r) => r.result === 'perdu')
    const reflexion = list.filter((r) => r.result === 'reflexion')
    const fallbackCa = signed.reduce((sum, r) => sum + (parseFloat(r.montantTotal ?? '0') || 0), 0)
    const fallbackSigned = signed.length
    const fallbackLost = lost.length
    const fallbackReflexion = reflexion.length
    const fallbackHonored = honored.length
    const outcomeBase = Math.max(fallbackHonored, fallbackSigned + fallbackLost + fallbackReflexion)
    const fallbackClosing = outcomeBase ? Math.round((fallbackSigned / outcomeBase) * 100) : 0
    const upcoming = list
      .filter((r) => r.status === 'planifie' && r.scheduledAt >= todayIso)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    const totalPlanifie = list.filter((r) => r.status === 'planifie').length
    const totalHonored = Math.max(analytics?.honored ?? 0, fallbackHonored)
    const totalRdv = Math.max(analytics?.total ?? 0, list.length)
    const totalSigned = Math.max(analytics?.signed ?? 0, fallbackSigned)
    const totalCa = Math.max(analytics?.ca ?? 0, fallbackCa)
    const totalLost = Math.max(analytics?.resultSegments.find((segment) => segment.label === 'Perdu')?.value ?? 0, fallbackLost)
    const totalReflexion = Math.max(analytics?.resultSegments.find((segment) => segment.label === 'Réflexion')?.value ?? 0, fallbackReflexion)
    const closingBase = Math.max(totalHonored, totalSigned + totalLost + totalReflexion)
    return {
      ca: totalCa,
      closing: Math.max(analytics?.closing ?? 0, fallbackClosing, closingBase ? Math.round((totalSigned / closingBase) * 100) : 0),
      panier: totalSigned ? totalCa / totalSigned : 0,
      signed: totalSigned,
      upcoming,
      totalPlanifie,
      totalHonored,
      totalRdv,
      lost: totalLost,
      reflexion: totalReflexion,
      leadsToday,
      qualifiedProspects: commercialQualifiedProspects(list, leadList, scopeCommercialId),
      qualifiedDebriefSegments: commercialQualifiedDebriefSegments(list, leadList, scopeCommercialId, commercialRange),
      nonSaleDebriefSegments: commercialNonSaleDebriefSegments(list, leadList, scopeCommercialId, commercialRange),
    }
  }, [rdvs, todayIso, commercialSummary, allLeads, scopeCommercialId, commercialRange.from, commercialRange.to])

  return (
    <AppShell blobsKey="commercial" flat>
      <Topbar
        eyebrow={isManager ? 'RESPONSABLE COMMERCIAL' : 'COMMERCIAL'}
        title={`Bonjour, ${display.firstName}`}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'rdv', label: 'RDV' },
          { id: 'pipeline', label: 'Pipeline' },
          { id: 'ventes', label: 'Ventes' },
        ]}
        activeTab={tab}
        onTabChange={(id) => {
          setTab(id)
          if (id === 'rdv') navigate('/rdv')
          if (id === 'pipeline' || id === 'ventes') navigate('/analytics')
        }}
      />
      <main className="overview-shot-page overview-commercial-page flex-grow overflow-auto">
        <div className="overview-air-header">
          <div>
            <span className="shot-eyebrow">ECOI SaaS · commercial</span>
            <h1>Mon closing commercial</h1>
            <p className="text-sm text-muted mt-2">{commercialRange.label}</p>
          </div>
          <div className="overview-commercial-toolbar">
            <div className="overview-range-switch" aria-label="Période tableau de bord commercial">
              {FUNNEL_PERIOD_OPTIONS.filter((period) => period.id === 'today' || period.id === 'yesterday' || period.id === 'this_week' || period.id === 'this_month' || period.id === 'this_year').map((period) => (
                <button
                  key={period.id}
                  type="button"
                  className={commercialPeriod.mode === period.id ? 'active' : ''}
                  onClick={() => setCommercialPeriod((current) => ({ ...current, mode: period.id }))}
                >
                  {period.label}
                </button>
              ))}
            </div>
            <div className="overview-commercial-date-range">
              <label>
                <span>Du</span>
                <input
                  type="date"
                  value={toDateInputValue(new Date(commercialRange.from))}
                  max={funnelTodayInput}
                  onChange={(event) => setCommercialPeriod((current) => ({
                    ...current,
                    mode: 'custom',
                    customFrom: event.target.value,
                    customTo: current.mode === 'custom' ? current.customTo : toDateInputValue(new Date(commercialRange.to)),
                  }))}
                />
              </label>
              <label>
                <span>Au</span>
                <input
                  type="date"
                  value={toDateInputValue(new Date(commercialRange.to))}
                  max={funnelTodayInput}
                  onChange={(event) => setCommercialPeriod((current) => ({
                    ...current,
                    mode: 'custom',
                    customFrom: current.mode === 'custom' ? current.customFrom : toDateInputValue(new Date(commercialRange.from)),
                    customTo: event.target.value,
                  }))}
                />
              </label>
            </div>
            <div className="overview-profile-chip">
              <div className="overview-profile-photo">
                {me?.image ? <img src={me.image} alt={me.name ?? 'Profil'} /> : <span>{userInitials(me?.name ?? display.firstName)}</span>}
              </div>
              <div>
                <strong>{me?.name ?? display.firstName}</strong>
                <small>{me?.email ?? 'Commercial ECOI'}</small>
              </div>
            </div>
          </div>
        </div>

        <section className="overview-commercial-hero">
          <div className="overview-commercial-hero-main">
            <div className="overview-commercial-avatar">
              {me?.image ? <img src={me.image} alt={me.name ?? 'Profil'} /> : <span>{userInitials(me?.name ?? display.firstName)}</span>}
            </div>
            <div className="overview-commercial-hero-content">
              <h3>{me?.name ?? display.firstName}</h3>
              <span className="shot-eyebrow">Performance commerciale</span>
              <h2>{fmtKEur(stats.ca)}</h2>
              <p>{fmtCompact(stats.totalRdv)} RDV suivis · {fmtCompact(stats.totalHonored)} honorés · {fmtCompact(stats.signed)} ventes signées</p>
              <div className="overview-commercial-actions">
                <button type="button" onClick={() => navigate('/rdv')}>Voir mes RDV</button>
                <button type="button" onClick={() => navigate('/analytics')}>Suivre mes ventes</button>
              </div>
            </div>
          </div>
          <div className="overview-commercial-hero-stats">
            <MagicKpi size="sm" accent="info" icon="inbox" label={leadsKpiLabelFor(commercialPeriod.mode)} value={fmtCompact(stats.leadsToday)} sub="leads arrivés" />
            <MagicKpi size="sm" accent="gold" icon="trophy" label="CA signé" value={fmtKEur(stats.ca)} sub={`${fmtCompact(stats.signed)} ventes`} />
            <MagicKpi size="sm" accent="success" icon="target" label="Closing" value={`${stats.closing}%`} sub={`${fmtCompact(stats.lost)} perdus`} progress={stats.closing} />
            <MagicKpi size="sm" accent="green" icon="tag" label="Panier moyen" value={fmtKEur(stats.panier)} sub="sur ventes signées" />
            <MagicKpi size="sm" accent="info" icon="calendar" label="RDV suivis" value={fmtCompact(stats.totalRdv)} sub={`${fmtCompact(stats.totalHonored)} honorés`} />
          </div>
        </section>

        <section className="overview-air-grid overview-commercial-grid">
          <CommercialQualifiedProspects prospects={stats.qualifiedProspects} />

          <div className="overview-commercial-debrief-grid">
            <DebriefPieCard
              title="Débrief qualifié"
              subtitle="facteurs d'acceptation des ventes"
              segments={qualifiedDebriefSegments}
            />
            <DebriefPieCard
              title="Raisons non-vente"
              subtitle="motifs des débriefs non-vente"
              segments={nonSaleDebriefSegments}
            />
          </div>

          <div className="overview-commercial-rdv-actions">
            <div className="overview-air-card overview-role-side">
              <CardHead title="Pipeline" icon="arrow-right" />
              <div className="space-y-3">
                <PipelineRow label="RDV planifiés" count={stats.totalPlanifie} pct={100} color="#1F7857" />
                <PipelineRow label="Honorés" count={stats.totalHonored} pct={pct(stats.totalHonored, stats.totalPlanifie)} color="#3E9A6F" />
                <PipelineRow label="Ventes" count={stats.signed} pct={pct(stats.signed, Math.max(stats.signed + stats.lost, stats.totalHonored))} color="#3DA86A" />
              </div>
            </div>

            <div className="overview-air-card overview-role-wide">
              <CardHead title="Mes RDV à venir" icon="phone" />
              <div className="overview-role-list overview-role-list-grid">
                {stats.upcoming.length === 0 ? (
                  <div className="text-xs text-faint">Aucun RDV à venir.</div>
                ) : stats.upcoming.slice(0, 6).map((r, i) => (
                  <RdvRow
                    key={r.id}
                    color={['#1F7857', '#3E9A6F', '#145A41', '#3DA86A'][i % 4]}
                    time={`${shortDateTime(r.scheduledAt)}`}
                    sub={r.locationType === 'visio' ? 'Visio' : r.locationType === 'agence' ? 'Agence' : 'Domicile'}
                  />
                ))}
              </div>
            </div>

            <div className="overview-air-card overview-role-side">
              <CardHead title="Actions" icon="check" />
              <TaskLine icon="phone" title="Préparer RDV" sub={`${fmtCompact(stats.upcoming.length)} rendez-vous à venir`} done={stats.upcoming.length > 0} />
              <TaskLine icon="target" title="Honorés" sub={`${fmtCompact(stats.totalHonored)} RDV honorés`} done={stats.totalHonored > 0} />
              <TaskLine icon="trophy" title="Signatures" sub={`${fmtCompact(stats.signed)} ventes signées`} done={stats.signed > 0} />
              <button onClick={() => navigate('/rdv')} className="overview-role-action">Voir mes RDV</button>
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  )
}

// ----- F4 Admin -----
function OverviewAdmin() {
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const [tab, setTab] = useState('overview')
  const [funnelPeriod, setFunnelPeriod] = useState<FunnelPeriodState>(DEFAULT_FUNNEL_PERIOD)
  const funnelRange = buildFunnelPeriodRange(funnelPeriod)

  useEffect(() => {
    let cancelled = false
    const warmupTimer = window.setTimeout(() => {
      if (cancelled) return
      const initialRange = buildFunnelPeriodRange(DEFAULT_FUNNEL_PERIOD)
      const currentKey = `${initialRange.from}|${initialRange.to}`
      const warmupRanges = getOverviewWarmupRanges()
      const previous = previousRange(initialRange)
      void Promise.allSettled([
        ...warmupRanges.flatMap((range) => {
          const filters = { from: range.from, to: range.to }
          const force = `${range.from}|${range.to}` !== currentKey
          return [
            prefetchAnalyticsSummary(filters, { force }),
            prefetchAnalyticsFunnel(filters, { force }),
          ]
        }),
        prefetchAnalyticsSummary({ from: previous.from, to: previous.to }, { force: true }),
        prefetchAnalyticsFunnel({ from: previous.from, to: previous.to }, { force: true }),
      ])
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(warmupTimer)
    }
  }, [])

  const { data: funnel } = useAnalyticsFunnel({
    from: funnelRange.from,
    to: funnelRange.to,
  })
  const { data: summary } = useAnalyticsSummary({
    from: funnelRange.from,
    to: funnelRange.to,
  })
  const { data: usersList = [] } = useUsers()
  const { data: allLeads = [] } = useLeads({ limit: 500 })
  const { data: allRdvs = [] } = useRdvList({ fromDate: funnelRange.from, toDate: funnelRange.to, limit: 200 })
  const { data: debriefAnalytics } = useDebriefAnalytics({ from: funnelRange.from, to: funnelRange.to })
  const qualifiedDebriefSegments = useMemo(() => acceptanceFactorSegments(debriefAnalytics), [debriefAnalytics])
  const nonSaleDebriefSegments = useMemo(() => nonSaleReasonSegments(debriefAnalytics), [debriefAnalytics])

  const adminSummary = summary?.admin ?? null
  const funnelTotals = funnel?.totals ?? EMPTY_FUNNEL_TOTALS
  const leadSegments = adminSummary?.resultSegments ?? []
  const treatedLeadTotal = Math.max(
    funnelTreatedLeads(funnelTotals),
    adminSummary?.classified ?? 0,
    adminSummary?.qualified ?? 0,
    adminSummary?.rdvPris ?? 0,
  )
  const evolutionGranularity = chooseGranularity(funnelPeriod.mode, funnelRange)
  const evolutionPoints = buildLeadEvolutionPoints(adminSummary?.dailyEvolution ?? [], funnel?.daily ?? [], adminSummary?.hourlyCalls ?? [], funnelRange, evolutionGranularity, {
    leads: treatedLeadTotal,
    rdv: adminSummary?.rdvPris ?? funnelTotals.rdv,
    signed: adminSummary?.signed ?? 0,
  })

  const prevRange = previousRange(funnelRange)
  const { data: prevFunnel } = useAnalyticsFunnel({ from: prevRange.from, to: prevRange.to })
  const { data: prevSummary } = useAnalyticsSummary({ from: prevRange.from, to: prevRange.to })
  const prevAdmin = prevSummary?.admin ?? null
  const comparePoints = buildLeadEvolutionPoints(
    prevAdmin?.dailyEvolution ?? [],
    prevFunnel?.daily ?? [],
    prevAdmin?.hourlyCalls ?? [],
    prevRange,
    evolutionGranularity,
    {
      leads: prevAdmin?.classified ?? prevFunnel?.totals?.qualified ?? 0,
      rdv: prevAdmin?.rdvPris ?? prevFunnel?.totals?.rdv ?? 0,
      signed: prevAdmin?.signed ?? 0,
    },
  )

  const stats = useMemo(() => {
    const calls = adminSummary?.calls ?? funnelTotals.calls
    const qualified = adminSummary?.qualified ?? funnelTotals.qualified
    const rdvPris = adminSummary?.rdvPris ?? funnelTotals.rdv
    const signed = adminSummary?.signed ?? 0
    const ca = adminSummary?.ca ?? 0
    const team = (usersList ?? []).filter((u) => u.active)
    const leadsToday = (allLeads ?? []).filter((l) => isCreatedInRange(l.createdAt, funnelRange.from, funnelRange.to)).length
    return {
      caMois: ca,
      ventes: signed,
      closing: ratePct(rdvPris, signed),
      leads: treatedLeadTotal,
      appels: calls,
      classified: treatedLeadTotal,
      qualified,
      qualifRate: adminSummary?.qualificationRate ?? funnelTotals.qualificationRate,
      panier: signed ? ca / signed : 0,
      teamActive: team.length,
      teamTotal: (usersList ?? []).length,
      rdvPris,
      leadsToday,
      qualifiedDebriefSegments: commercialQualifiedDebriefSegments(allRdvs ?? [], allLeads ?? [], undefined, funnelRange),
      nonSaleDebriefSegments: commercialNonSaleDebriefSegments(allRdvs ?? [], allLeads ?? [], undefined, funnelRange),
      funnelProspects: adminFunnelProspects(allRdvs ?? [], allLeads ?? [], usersList ?? []),
    }
  }, [adminSummary, funnelTotals, treatedLeadTotal, usersList, allLeads, allRdvs, funnelRange.from, funnelRange.to])
  const funnelNoAnswer = Math.min(funnelTotals.noAnswer, stats.leads)
  const funnelAnswered = Math.max(
    funnelTotals.answered,
    stats.leads - funnelNoAnswer,
    stats.qualified + funnelTotals.notQualified + Math.max(0, funnelTotals.relances - funnelNoAnswer),
    stats.rdvPris,
  )
  const overviewFunnelTotals: AnalyticsFunnelResponse['totals'] = {
    ...funnelTotals,
    calls: Math.max(funnelTotals.calls, stats.appels),
    answered: funnelAnswered,
    responseRate: pct(funnelAnswered, stats.leads),
    noAnswer: funnelNoAnswer,
    qualified: Math.max(funnelTotals.qualified, stats.qualified),
    qualificationRate: pct(Math.max(funnelTotals.qualified, stats.qualified), Math.max(1, funnelAnswered)),
    rdv: Math.max(funnelTotals.rdv, stats.rdvPris),
    globalConversionRate: pct(Math.max(funnelTotals.rdv, stats.rdvPris), stats.leads),
  }

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'setters', label: 'Setters' },
          { id: 'commerciaux', label: 'Commerciaux' },
          { id: 'ventes', label: 'Ventes' },
        ]}
        activeTab={tab}
        onTabChange={(id) => {
          setTab(id)
          if (id === 'setters') navigate('/settings')
          if (id === 'commerciaux' || id === 'ventes') navigate('/analytics')
        }}
      />
      <main className="overview-shot-page flex-grow overflow-auto">
        <section className="overview-air-header">
          <div>
            <div className="shot-eyebrow">ECOI SaaS · données réelles</div>
            <h1>Vue d’ensemble</h1>
            <p className="text-sm text-muted mt-2">{funnelRange.label}</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <DateRangePicker value={funnelPeriod} onChange={setFunnelPeriod} align="right" />
            <div className="overview-profile-chip">
              <div className="overview-profile-photo">
                {me?.image ? <img src={me.image} alt={me.name} /> : <span>{userInitials(me?.name)}</span>}
              </div>
              <div>
                <strong>{me?.name}</strong>
                <small>{me?.email}</small>
              </div>
            </div>
          </div>
        </section>

        <div className="overview-admin-layout">
          <section className="overview-air-grid overview-admin-main-grid">
          <div className="overview-admin-summary">
            <div className="overview-profile-panel">
              <div className="overview-profile-large">
                {me?.image ? <img src={me.image} alt={me.name} /> : <span>{userInitials(me?.name)}</span>}
              </div>
              <div>
                <span className="shot-eyebrow">Profil connecté</span>
                <h2>{me?.name}</h2>
                <p>{me?.role ?? 'admin'} · {stats.teamActive}/{stats.teamTotal} actifs</p>
              </div>
            </div>
            <div className="overview-admin-kpis">
              <AirKpi icon="inbox" label={leadsKpiLabelFor(funnelPeriod.mode)} value={fmtCompact(stats.leadsToday)} sub="leads arrivés" />
              <AirKpi icon="target" label="Closing" value={`${stats.closing}%`} sub={`${fmtCompact(stats.rdvPris)} RDV suivis`} />
              <AirKpi icon="phone" label="Appels" value={fmtCompact(stats.appels)} sub={`${fmtCompact(stats.classified)} leads traités`} />
              <AirKpi icon="users" label="Leads traités" value={fmtCompact(stats.leads)} sub={`${fmtCompact(stats.qualified)} qualifiés`} />
            </div>
          </div>

          <div className="overview-air-card overview-air-chart overview-lead-evolution-card">
            <LeadEvolutionChart
              points={evolutionPoints}
              comparePoints={comparePoints}
              granularity={evolutionGranularity}
              range={funnelRange}
              rangeLabel={`Du ${formatShortDate(new Date(funnelRange.from))} au ${formatShortDate(new Date(funnelRange.to))}`}
              compareLabel={`Du ${formatShortDate(new Date(prevRange.from))} au ${formatShortDate(new Date(prevRange.to))}`}
              totals={{ leads: stats.leads, rdv: stats.rdvPris, signed: stats.ventes }}
            />
          </div>


          <div className="overview-air-card overview-air-funnel">
            <div className="shot-calendar-head">
              <span>{formatShortDate(new Date(funnelRange.from))}</span>
              <strong>Funnel CRM</strong>
              <button onClick={() => navigate('/analytics')}>Détails</button>
            </div>
            <FunnelFlowMap totals={overviewFunnelTotals} />
          </div>

          <CommercialQualifiedProspects
            prospects={stats.funnelProspects}
            title="Prospects avec RDV"
            subtitle="Liste complète des leads qualifiés · commercial assigné + setter qualifiant"
            limit={20}
            className="overview-admin-prospects"
          />
          </section>

          <aside className="overview-admin-side-rail" aria-label="Répartition des leads">
            <LeadPieAnalysis segments={leadSegments} totalFallback={stats.leads} />
            <DebriefPieCard
              title="Débrief qualifié"
              subtitle="facteurs d'acceptation des ventes"
              segments={qualifiedDebriefSegments}
            />
            <DebriefPieCard
              title="Raisons non-vente"
              subtitle="motifs des débriefs non-vente"
              segments={nonSaleDebriefSegments}
            />
          </aside>
        </div>

      </main>
    </AppShell>
  )
}

// ===== Helpers =====

type ShotIcon = 'trophy' | 'users' | 'target' | 'arrow-right' | 'chart' | 'phone' | 'check' | 'inbox' | 'settings' | 'shield' | 'tag' | 'grid' | 'bell'

function userInitials(name: string | null | undefined): string {
  const clean = (name ?? '').trim()
  if (!clean) return '—'
  return clean.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function AirKpi({ icon, label, value, sub }: { icon: ShotIcon; label: string; value: string; sub: string }) {
  return (
    <div className="overview-air-kpi">
      <span><Icon name={icon} size={18} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{sub}</p>
      </div>
    </div>
  )
}

function CardHead({ title, icon }: { title: string; icon: ShotIcon }) {
  return (
    <div className="shot-card-head">
      <h3>{title}</h3>
      <span><Icon name={icon} size={16} /></span>
    </div>
  )
}

type LeadEvolutionPoint = { key: string; t: number; date: string; label: string; leads: number; rdv: number; signed: number }
type LeadEvolutionSeriesKey = 'leads' | 'rdv' | 'signed'

const LEAD_EVOLUTION_SERIES: { key: LeadEvolutionSeriesKey; label: string; color: string }[] = [
  { key: 'leads', label: 'Leads', color: '#1F7857' },
  { key: 'rdv', label: 'RDV', color: '#3DA86A' },
  { key: 'signed', label: 'Ventes', color: '#3E9A6F' },
]

const GRANULARITY_SUBTITLE: Record<EvolutionGranularity, string> = {
  hour: 'Leads traités par heure',
  day: 'Leads traités par jour',
  week: 'Leads traités par semaine',
  month: 'Leads traités par mois',
}

function smoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return ''
  if (coords.length === 1) return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] ?? coords[i]
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p3 = coords[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function LeadEvolutionChart({ points, comparePoints = [], granularity, range, rangeLabel, compareLabel, totals }: { points: LeadEvolutionPoint[]; comparePoints?: LeadEvolutionPoint[]; granularity: EvolutionGranularity; range: FunnelPeriodRange; rangeLabel: string; compareLabel?: string; totals: { leads: number; rdv: number; signed: number } }) {
  const [activeKey, setActiveKey] = useState<LeadEvolutionSeriesKey>('leads')
  const [hover, setHover] = useState<{ index: number; cursorX: number } | null>(null)
  const rawPoints = points.length > 0 ? points : [{ key: 'empty', t: 0, date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }]
  const sampleStep = rawPoints.length > 56 ? Math.ceil(rawPoints.length / 56) : 1
  const keepIdx = sampleStep > 1 ? rawPoints.map((_, index) => index).filter((index) => index % sampleStep === 0 || index === rawPoints.length - 1) : rawPoints.map((_, index) => index)
  const safePoints = keepIdx.map((index) => rawPoints[index])
  const comparePts = comparePoints.length > 0
    ? keepIdx.map((index) => comparePoints[Math.min(index, comparePoints.length - 1)]).filter(Boolean)
    : []
  const activeSeries = LEAD_EVOLUTION_SERIES.find((series) => series.key === activeKey) ?? LEAD_EVOLUTION_SERIES[0]
  const subtitle = GRANULARITY_SUBTITLE[granularity]

  const width = 640
  const height = 240
  const padX = 40
  const padTop = 18
  const padBottom = 34
  const chartWidth = width - padX * 2
  const chartHeight = height - padTop - padBottom
  const clamp = (value: number, min: number, maxValue: number) => Math.min(maxValue, Math.max(min, value))
  const max = Math.max(1, ...safePoints.map((point) => point[activeKey]), ...comparePts.map((point) => point[activeKey]))
  const domain = computeEvolutionDomain(range, granularity)
  const ticks = buildEvolutionTicks(domain, granularity)
  const useTime = domain.end > domain.start && safePoints.every((point) => Number.isFinite(point.t) && point.t > 0)
  const xForTime = (t: number) => padX + ((clamp(t, domain.start, domain.end) - domain.start) / (domain.end - domain.start)) * chartWidth
  const xForIndex = (index: number) => padX + (safePoints.length === 1 ? chartWidth / 2 : (index / (safePoints.length - 1)) * chartWidth)
  const xFor = (index: number) => (useTime ? xForTime(safePoints[index].t) : xForIndex(index))
  // comparePts.length === safePoints.length by construction (same keepIdx mapping)
  const xForCompare = (index: number) => padX + (comparePts.length <= 1 ? chartWidth / 2 : (index / (comparePts.length - 1)) * chartWidth)
  const yFor = (value: number) => padTop + chartHeight - (value / max) * chartHeight

  const currentCoords = safePoints.map((point, index) => ({ x: xFor(index), y: yFor(point[activeKey]) }))
  const compareCoords = comparePts.map((point, index) => ({ x: xForCompare(index), y: yFor(point[activeKey]) }))
  const currentPath = smoothPath(currentCoords)
  const comparePath = compareCoords.length >= 2 ? smoothPath(compareCoords) : ''
  const areaPath = currentPath ? `${currentPath} L ${xFor(safePoints.length - 1).toFixed(1)} ${(height - padBottom).toFixed(1)} L ${xFor(0).toFixed(1)} ${(height - padBottom).toFixed(1)} Z` : ''
  const animKey = `${range.from}|${range.to}|${granularity}|${activeKey}`
  const lastIndex = safePoints.length - 1
  const liveX = xFor(lastIndex)
  const liveY = yFor(safePoints[lastIndex][activeKey])
  const showLive = useTime && currentPath !== ''

  const gridRatios = [0, 0.25, 0.5, 0.75, 1]
  const fallbackLabelStep = Math.max(1, Math.ceil((safePoints.length - 1) / 5))
  const fallbackLabelIndexes = safePoints.length <= 1 ? [0] : safePoints.map((_, index) => index).filter((index) => index % fallbackLabelStep === 0 || index === safePoints.length - 1)

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const cursorX = clamp(((event.clientX - rect.left) / rect.width) * width, padX, width - padX)
    let index = 0
    let best = Infinity
    for (let i = 0; i < safePoints.length; i += 1) {
      const dist = Math.abs(xFor(i) - cursorX)
      if (dist < best) { best = dist; index = i }
    }
    setHover({ index, cursorX: xFor(index) })
  }

  const hoverPoint = hover ? safePoints[hover.index] : null
  const hoverCompare = hover ? comparePts[hover.index] : undefined
  const curVal = hoverPoint ? hoverPoint[activeKey] : 0
  const prevVal = hoverCompare ? hoverCompare[activeKey] : 0
  const deltaPct = hover && hoverCompare ? (prevVal ? Math.round(((curVal - prevVal) / prevVal) * 100) : null) : null

  return (
    <div className="lead-evolution">
      <div className="lead-evolution-head">
        <div>
          <h3>Évolution</h3>
          <p>{subtitle} — {rangeLabel}</p>
        </div>
      </div>
      <div className="lead-evolution-tabs" aria-label="Métrique active">
        {LEAD_EVOLUTION_SERIES.map((series) => (
          <button key={series.key} type="button" className={activeKey === series.key ? 'active' : ''} onClick={() => setActiveKey(series.key)}>
            <small><i style={{ background: series.color }} />{series.label}</small>
            <strong>{fmtCompact(totals[series.key])}</strong>
          </button>
        ))}
      </div>
      <div className="lead-evolution-svg-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Évolution de la métrique sélectionnée">
          <defs>
            <linearGradient id="leadEvolutionFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-or)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--color-or)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridRatios.map((ratio) => {
            const y = padTop + ratio * chartHeight
            const label = Math.round(max * (1 - ratio))
            const showLabel = ratio === 0 || ratio === 0.5 || ratio === 1
            return (
              <g key={ratio}>
                <line x1={padX} x2={width - padX} y1={y} y2={y} className="lead-evolution-grid" />
                {showLabel ? <text x={padX - 8} y={y + 3} className="lead-evolution-yaxis" textAnchor="end">{fmtCompact(label)}</text> : null}
              </g>
            )
          })}
          {comparePath ? <path d={comparePath} className="lead-evolution-compare" /> : null}
          <g key={animKey} className="lead-evolution-anim">
            {areaPath ? <path d={areaPath} fill="url(#leadEvolutionFill)" stroke="none" /> : null}
            {currentPath ? <path d={currentPath} className="lead-evolution-line lead-evolution-line--draw" /> : null}
          </g>
          {showLive ? (
            <g key={`live-${animKey}`} className="lead-evolution-live" pointerEvents="none">
              <line className="lead-evolution-live-spark" x1={liveX} x2={liveX} y1={liveY} y2={liveY - 26} />
              <circle className="lead-evolution-live-halo" cx={liveX} cy={liveY} r="9" />
              <circle className="lead-evolution-live-dot" cx={liveX} cy={liveY} r="4.5" />
            </g>
          ) : null}
          {useTime
            ? ticks.map((tick, index) => (
                <text
                  key={`x-${tick.t}`}
                  x={xForTime(tick.t)}
                  y={height - 10}
                  className="lead-evolution-axis"
                  textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
                >{tick.label}</text>
              ))
            : fallbackLabelIndexes.map((index) => (
                <text
                  key={`x-${index}`}
                  x={xForIndex(index)}
                  y={height - 10}
                  className="lead-evolution-axis"
                  textAnchor={index === 0 ? 'start' : index === safePoints.length - 1 ? 'end' : 'middle'}
                >{safePoints[index].label}</text>
              ))}
          {hover && hoverPoint ? (
            <g pointerEvents="none">
              <line x1={hover.cursorX} x2={hover.cursorX} y1={padTop} y2={height - padBottom} className="lead-evolution-guide" />
              {hoverCompare ? <circle cx={xForCompare(hover.index)} cy={yFor(prevVal)} r="3.5" className="lead-evolution-compare-dot" /> : null}
              <circle cx={xFor(hover.index)} cy={yFor(curVal)} r="5" className="lead-evolution-dot" />
            </g>
          ) : null}
        </svg>
        {hover && hoverPoint ? (
          <div
            className="lead-evolution-tooltip"
            style={{
              left: hover.cursorX > width * 0.6 ? 'auto' : `${clamp((hover.cursorX / width) * 100, 2, 60)}%`,
              right: hover.cursorX > width * 0.6 ? `${clamp(((width - hover.cursorX) / width) * 100, 2, 60)}%` : 'auto',
              top: '8%',
            }}
          >
            <small>{activeSeries.label}</small>
            <strong>{hoverPoint.label}</strong>
            <b className="lead-evolution-tooltip-value">{fmtCompact(curVal)}</b>
            <div className="lead-evolution-tooltip-delta">
              {deltaPct === null ? (
                <span className="neutral">—</span>
              ) : deltaPct > 0 ? (
                <span className="up">↗ {fmtCompact(deltaPct)} %</span>
              ) : deltaPct < 0 ? (
                <span className="down">↘ {fmtCompact(Math.abs(deltaPct))} %</span>
              ) : (
                <span className="neutral">→ 0 %</span>
              )}
              <span className="muted"> de la comparaison</span>
            </div>
            {hoverCompare ? (
              <em>{hoverCompare.label} · {fmtCompact(prevVal)}</em>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="lead-evolution-legend">
        <span><i className="swatch-solid" />{rangeLabel}</span>
        {compareLabel ? <span><i className="swatch-dashed" />{compareLabel}</span> : null}
      </div>
    </div>
  )
}

function chooseGranularity(mode: FunnelPeriodMode, range: FunnelPeriodRange): EvolutionGranularity {
  if (mode === 'today' || mode === 'yesterday') return 'hour'
  if (mode === 'this_week' || mode === 'last_week') return 'day'
  if (mode === 'this_month' || mode === 'last_month') return 'week'
  if (mode === 'this_year' || mode === 'last_year') return 'month'
  // custom: derive from span
  if (range.days <= 1) return 'hour'
  if (range.days <= 7) return 'day'
  if (range.days <= 31) return 'week'
  return 'month'
}

function buildLeadEvolutionPoints(
  summaryDaily: { date: string; label: string; rdv: number; signed: number }[],
  funnelDaily: AnalyticsFunnelResponse['daily'],
  hourlyCalls: { date: string; hour: number; label: string; calls: number }[],
  range: FunnelPeriodRange,
  granularity: EvolutionGranularity,
  totals: { leads: number; rdv: number; signed: number },
): LeadEvolutionPoint[] {
  if (granularity === 'hour') {
    const rangeStart = startOfDay(new Date(range.from)).getTime()
    const rangeEnd = endOfDay(new Date(range.to)).getTime()
    const activeHours = hourlyCalls
      .filter((point) => point.hour >= 8 && point.hour <= 21)
      .filter((point) => {
        const t = new Date(point.date).getTime()
        return t >= rangeStart && t <= rangeEnd
      })
      .sort((a, b) => `${a.date}-${String(a.hour).padStart(2, '0')}`.localeCompare(`${b.date}-${String(b.hour).padStart(2, '0')}`))
    if (activeHours.length > 0) {
      return distributeTotalsAcrossHours(activeHours, totals)
    }
  }

  if (granularity === 'week') {
    return buildWeeklyEvolutionPoints(summaryDaily, funnelDaily, totals)
  }
  if (granularity === 'month') {
    return buildMonthlyEvolutionPoints(summaryDaily, funnelDaily, totals)
  }

  // daily (default fallback for hour with no hourly data, and explicit 'day')
  const summaryByDate = new Map(summaryDaily.map((point) => [point.date, point]))
  const dates = new Set<string>([...funnelDaily.map((point) => point.date), ...summaryDaily.map((point) => point.date)])
  if (dates.size > 0) {
    const points = [...dates].sort().map((date) => {
      const funnelPoint = funnelDaily.find((point) => point.date === date)
      const summaryPoint = summaryByDate.get(date)
      return {
        key: date,
        t: new Date(`${date}T12:00:00`).getTime(),
        date,
        label: funnelPoint?.label || summaryPoint?.label || dayLabel(date),
        leads: Math.max(funnelPoint?.answered ?? 0, funnelPoint?.qualified ?? 0, funnelPoint?.rdv ?? 0),
        rdv: summaryPoint?.rdv ?? funnelPoint?.rdv ?? 0,
        signed: summaryPoint?.signed ?? 0,
      }
    })
    return hydrateMissingEvolutionTotals(points, totals)
  }
  return hydrateMissingEvolutionTotals(Array.from({ length: Math.min(7, Math.max(1, range.days)) }, (_, index) => ({
    key: `empty-${index}`,
    t: 0,
    date: '',
    label: index === 0 ? 'Live' : '—',
    leads: 0,
    rdv: 0,
    signed: 0,
  })), totals)
}

function buildWeeklyEvolutionPoints(
  summaryDaily: { date: string; label: string; rdv: number; signed: number }[],
  funnelDaily: AnalyticsFunnelResponse['daily'],
  totals: { leads: number; rdv: number; signed: number },
): LeadEvolutionPoint[] {
  const buckets = new Map<string, LeadEvolutionPoint>()
  const addToBucket = (date: string, leads: number, rdv: number, signed: number) => {
    const weekStart = startOfWeek(new Date(date))
    const key = weekStart.toISOString().slice(0, 10)
    const existing = buckets.get(key)
    if (existing) {
      existing.leads = Math.max(existing.leads, leads) // leads use max (already aggregated upstream)
      existing.rdv += rdv
      existing.signed += signed
    } else {
      buckets.set(key, {
        key,
        t: new Date(weekStart).setHours(12, 0, 0, 0),
        date: key,
        label: `sem. ${formatDayMonth(weekStart)}`,
        leads,
        rdv,
        signed,
      })
    }
  }
  const summaryByDate = new Map(summaryDaily.map((point) => [point.date, point]))
  const allDates = new Set<string>([...funnelDaily.map((point) => point.date), ...summaryDaily.map((point) => point.date)])
  ;[...allDates].sort().forEach((date) => {
    const funnelPoint = funnelDaily.find((point) => point.date === date)
    const summaryPoint = summaryByDate.get(date)
    const leads = Math.max(funnelPoint?.answered ?? 0, funnelPoint?.qualified ?? 0, funnelPoint?.rdv ?? 0)
    const rdv = summaryPoint?.rdv ?? funnelPoint?.rdv ?? 0
    const signed = summaryPoint?.signed ?? 0
    addToBucket(date, leads, rdv, signed)
  })
  // For weekly leads aggregation, sum instead of max if we accumulated per day already.
  // Recompute leads as sum across days within each week to avoid undercounting.
  const dailyLeadsByWeek = new Map<string, number>()
  ;[...allDates].sort().forEach((date) => {
    const funnelPoint = funnelDaily.find((point) => point.date === date)
    const leads = Math.max(funnelPoint?.answered ?? 0, funnelPoint?.qualified ?? 0, funnelPoint?.rdv ?? 0)
    const weekKey = startOfWeek(new Date(date)).toISOString().slice(0, 10)
    dailyLeadsByWeek.set(weekKey, (dailyLeadsByWeek.get(weekKey) ?? 0) + leads)
  })
  buckets.forEach((point, key) => {
    point.leads = dailyLeadsByWeek.get(key) ?? point.leads
  })
  const sorted = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) {
    return hydrateMissingEvolutionTotals([{ key: 'empty', t: 0, date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }], totals)
  }
  return hydrateMissingEvolutionTotals(sorted, totals)
}

function buildMonthlyEvolutionPoints(
  summaryDaily: { date: string; label: string; rdv: number; signed: number }[],
  funnelDaily: AnalyticsFunnelResponse['daily'],
  totals: { leads: number; rdv: number; signed: number },
): LeadEvolutionPoint[] {
  const buckets = new Map<string, LeadEvolutionPoint>()
  const summaryByDate = new Map(summaryDaily.map((point) => [point.date, point]))
  const allDates = new Set<string>([...funnelDaily.map((point) => point.date), ...summaryDaily.map((point) => point.date)])
  ;[...allDates].sort().forEach((date) => {
    const funnelPoint = funnelDaily.find((point) => point.date === date)
    const summaryPoint = summaryByDate.get(date)
    const leads = Math.max(funnelPoint?.answered ?? 0, funnelPoint?.qualified ?? 0, funnelPoint?.rdv ?? 0)
    const rdv = summaryPoint?.rdv ?? funnelPoint?.rdv ?? 0
    const signed = summaryPoint?.signed ?? 0
    const monthKey = date.slice(0, 7) // YYYY-MM
    const existing = buckets.get(monthKey)
    if (existing) {
      existing.leads += leads
      existing.rdv += rdv
      existing.signed += signed
    } else {
      buckets.set(monthKey, {
        key: monthKey,
        t: new Date(`${monthKey}-15T12:00:00`).getTime(),
        date: `${monthKey}-01`,
        label: formatMonthLabel(new Date(`${monthKey}-01`)),
        leads,
        rdv,
        signed,
      })
    }
  })
  const sorted = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) {
    return hydrateMissingEvolutionTotals([{ key: 'empty', t: 0, date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }], totals)
  }
  return hydrateMissingEvolutionTotals(sorted, totals)
}

function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

function distributeTotalsAcrossHours(points: { date: string; hour: number; label: string; calls: number }[], totals: { leads: number; rdv: number; signed: number }): LeadEvolutionPoint[] {
  const weights = points.map((point) => Math.max(0, point.calls))
  const leadValues = distributeIntegerTotal(totals.leads, weights)
  const rdvValues = distributeIntegerTotal(totals.rdv, weights)
  const signedValues = distributeIntegerTotal(totals.signed, weights)
  return points.map((point, index) => ({
    key: `${point.date}-${point.hour}`,
    t: new Date(`${point.date}T${String(point.hour).padStart(2, '0')}:00:00`).getTime(),
    date: point.date,
    label: `${dayLabel(point.date)} ${point.hour}h`,
    leads: leadValues[index] ?? 0,
    rdv: rdvValues[index] ?? 0,
    signed: signedValues[index] ?? 0,
  }))
}

function distributeIntegerTotal(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightTotal <= 0) {
    const values = weights.map(() => 0)
    values[values.length - 1] = total
    return values
  }
  const raw = weights.map((weight) => (weight / weightTotal) * total)
  const values = raw.map(Math.floor)
  let remaining = total - values.reduce((sum, value) => sum + value, 0)
  raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ index }) => {
      if (remaining <= 0) return
      values[index] += 1
      remaining -= 1
    })
  return values
}

function hydrateMissingEvolutionTotals(points: LeadEvolutionPoint[], totals: { leads: number; rdv: number; signed: number }): LeadEvolutionPoint[] {
  if (points.length === 0) return points
  const lastIndex = points.length - 1
  const sums = points.reduce(
    (acc, point) => ({ leads: acc.leads + point.leads, rdv: acc.rdv + point.rdv, signed: acc.signed + point.signed }),
    { leads: 0, rdv: 0, signed: 0 },
  )
  return points.map((point, index) => index === lastIndex ? {
    ...point,
    leads: point.leads + Math.max(0, totals.leads - sums.leads),
    rdv: point.rdv + Math.max(0, totals.rdv - sums.rdv),
    signed: point.signed + Math.max(0, totals.signed - sums.signed),
  } : point)
}

const PIE_COLORS = ['#1F7857', '#3DA86A', '#3E9A6F', '#6B7C8C', '#145A41', '#7C6A46']

type LeadSegment = { label: string; value: number; description?: string }
type QualifiedProspect = { id: string; name: string; phone: string | null; city: string | null; status: string; scheduledAt: string | null; commercialName?: string | null; setterName?: string | null }
type CommercialDebriefSource = { id: string; rdv?: RdvResponse; lead?: LeadResponse }

function CommercialQualifiedProspects({ prospects, title = 'Prospects qualifiés', subtitle = 'Liste prioritaire du commercial · données réelles', limit = 8, className }: { prospects: QualifiedProspect[]; title?: string; subtitle?: string; limit?: number; className?: string }) {
  return (
    <div className={`overview-air-card overview-commercial-qualified-list${className ? ` ${className}` : ''}`}>
      <div className="shot-card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span><Icon name="users" size={16} /></span>
      </div>
      <div className="commercial-qualified-list-body">
        {prospects.length === 0 ? (
          <div className="text-xs text-faint">Aucun prospect qualifié sur cette période.</div>
        ) : prospects.slice(0, limit).map((prospect) => (
          <div key={prospect.id} className="commercial-qualified-row">
            <div className="overview-role-avatar">{userInitials(prospect.name)}</div>
            <div>
              <strong>{prospect.name}</strong>
              <small>{prospect.city ?? 'Ville non renseignée'} · {prospect.phone ?? 'sans téléphone'}</small>
              {(prospect.commercialName || prospect.setterName) && (
                <small className="commercial-qualified-attribution">
                  {prospect.commercialName ? <>Commercial · <b>{prospect.commercialName}</b></> : <>Commercial · <i>non assigné</i></>}
                  {' · '}
                  {prospect.setterName ? <>Setter · <b>{prospect.setterName}</b></> : <>Setter · <i>non assigné</i></>}
                </small>
              )}
            </div>
            <div className="commercial-qualified-meta">
              <span>{prospect.status}</span>
              <small>{prospect.scheduledAt ? shortDateTime(prospect.scheduledAt) : 'à suivre'}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type InteractivePieSegment = { label: string; description?: string; value: number }

function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const x1 = cx + rOuter * Math.cos(startAngle)
  const y1 = cy + rOuter * Math.sin(startAngle)
  const x2 = cx + rOuter * Math.cos(endAngle)
  const y2 = cy + rOuter * Math.sin(endAngle)
  const x3 = cx + rInner * Math.cos(endAngle)
  const y3 = cy + rInner * Math.sin(endAngle)
  const x4 = cx + rInner * Math.cos(startAngle)
  const y4 = cy + rInner * Math.sin(startAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} L ${x3.toFixed(3)} ${y3.toFixed(3)} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(3)} ${y4.toFixed(3)} Z`
}

function InteractivePie({
  segments,
  size,
  innerRadius,
  centerTop,
  centerBottom,
  activeIndex,
  onActiveChange,
  valueLabel = 'élément',
  valueLabelPlural,
}: {
  segments: InteractivePieSegment[]
  size: number
  innerRadius: number
  centerTop: ReactNode
  centerBottom: ReactNode
  activeIndex: number | null
  onActiveChange: (index: number | null) => void
  valueLabel?: string
  valueLabelPlural?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const total = segments.reduce((sum, seg) => sum + seg.value, 0)
  const cx = size / 2
  const cy = size / 2
  const outerR = size / 2 - 1
  const innerR = Math.max(2, innerRadius)
  const startOffset = -Math.PI / 2

  const slices = useMemo(() => {
    if (total <= 0) return [] as { index: number; path: string; start: number; end: number }[]
    let acc = 0
    return segments.map((seg, index) => {
      const start = startOffset + (acc / total) * Math.PI * 2
      acc += seg.value
      const end = startOffset + (acc / total) * Math.PI * 2
      if (seg.value <= 0) return null
      // 100% slice → draw two halves to avoid the degenerate arc
      if (Math.abs(end - start - Math.PI * 2) < 1e-6) {
        const mid = start + Math.PI
        return {
          index,
          path: `${donutSlicePath(cx, cy, outerR, innerR, start, mid)} ${donutSlicePath(cx, cy, outerR, innerR, mid, end)}`,
          start,
          end,
        }
      }
      return { index, path: donutSlicePath(cx, cy, outerR, innerR, start, end), start, end }
    }).filter(Boolean) as { index: number; path: string; start: number; end: number }[]
  }, [segments, total, cx, cy, outerR, innerR, startOffset])

  const active = activeIndex !== null ? segments[activeIndex] : null
  const activePct = active && total ? Math.round((active.value / total) * 100) : 0
  const innerSize = innerR * 2

  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  return (
    <div
      ref={wrapRef}
      className="interactive-pie"
      style={{ width: size, height: size }}
      onMouseMove={handleMove}
      onMouseLeave={() => { onActiveChange(null); setCursor(null) }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition">
        {total <= 0 ? (
          <circle cx={cx} cy={cy} r={(outerR + innerR) / 2} fill="none" stroke="var(--color-line-soft)" strokeWidth={outerR - innerR} />
        ) : slices.map(({ index, path }) => {
          const isActive = activeIndex === index
          return (
            <path
              key={`slice-${index}`}
              d={path}
              fill={PIE_COLORS[index % PIE_COLORS.length]}
              stroke="#FFFFFF"
              strokeWidth={1.5}
              style={{
                transformOrigin: `${cx}px ${cy}px`,
                transform: isActive ? 'scale(1.04)' : 'scale(1)',
                transition: 'transform 0.16s ease',
                opacity: activeIndex === null || isActive ? 1 : 0.55,
                cursor: 'pointer',
              }}
              onMouseEnter={() => onActiveChange(index)}
            />
          )
        })}
      </svg>
      <div className="interactive-pie-center" style={{ width: innerSize, height: innerSize }}>
        {active ? (
          <>
            <strong>{activePct}%</strong>
            <span>{fmtCompact(active.value)} {(active.value > 1 ? (valueLabelPlural ?? valueLabel) : valueLabel)}</span>
          </>
        ) : (
          <>
            {centerTop}
            {centerBottom}
          </>
        )}
      </div>
      {active && cursor && (
        <div
          className="interactive-pie-tooltip"
          style={{ left: cursor.x, top: cursor.y, borderColor: PIE_COLORS[(activeIndex ?? 0) % PIE_COLORS.length] }}
        >
          <i style={{ background: PIE_COLORS[(activeIndex ?? 0) % PIE_COLORS.length] }} />
          <div>
            <strong>{active.label}</strong>
            {active.description && <small>{active.description}</small>}
            <em>{fmtCompact(active.value)} · {activePct}%</em>
          </div>
        </div>
      )}
    </div>
  )
}

function DebriefPieCard({ title, subtitle, segments }: { title: string; subtitle: string; segments: LeadSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const visibleSegments: InteractivePieSegment[] = segments.length > 0 ? segments : [{ label: 'Aucune donnée', value: 0, description: 'Débrief à remplir' }]
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  return (
    <div className="overview-air-card commercial-debrief-card">
      <div className="shot-card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span><Icon name="target" size={16} /></span>
      </div>
      <div className="commercial-debrief-body">
        <InteractivePie
          segments={visibleSegments}
          size={140}
          innerRadius={44}
          centerTop={<strong>{total ? `${pct(Math.max(...visibleSegments.map((segment) => segment.value)), total)}%` : '0%'}</strong>}
          centerBottom={<span>{fmtCompact(total)} choix</span>}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          valueLabel="choix"
        />
        <div className="overview-pie-legend commercial-debrief-legend">
          {visibleSegments.map((segment, index) => (
            <div
              key={`${title}-${segment.label}-${index}`}
              className={activeIndex === index ? 'is-active' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
              <span>{segment.label}<small>{segment.description}</small></span>
              <strong>{total ? `${pct(segment.value, total)}%` : '0%'}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LeadPieAnalysis({ segments, totalFallback = 0, leads }: { segments?: LeadSegment[]; totalFallback?: number; leads?: LeadResponse[] }) {
  const resolvedSegments = segments ?? leadStatusSegments(leads ?? [])
  const total = resolvedSegments.reduce((sum, segment) => sum + segment.value, 0) || totalFallback
  const visibleSegments: InteractivePieSegment[] = resolvedSegments.length > 0
    ? resolvedSegments
    : [{ label: 'Données en cours', value: totalFallback }]
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  return (
    <div className="overview-air-card overview-air-pie">
      <CardHead title="Répartition des leads" icon="target" />
      <div className="overview-pie-body">
        <InteractivePie
          segments={visibleSegments}
          size={178}
          innerRadius={52}
          centerTop={<strong>{fmtCompact(total)}</strong>}
          centerBottom={<span>leads</span>}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          valueLabel="lead"
          valueLabelPlural="leads"
        />
        <div className="overview-pie-legend">
          {visibleSegments.length === 0 ? (
            <span className="text-xs text-faint">Aucune donnée lead.</span>
          ) : visibleSegments.slice(0, 5).map((segment, index) => (
            <div
              key={`${segment.label}-${index}`}
              className={activeIndex === index ? 'is-active' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
              <span>{segment.label}</span>
              <strong>{fmtCompact(segment.value)}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TaskLine({ icon, title, sub, done }: { icon: ShotIcon; title: string; sub: string; done: boolean }) {
  return (
    <div className="shot-task-line">
      <span className="task-icon"><Icon name={icon} size={16} /></span>
      <div>
        <strong>{title}</strong>
        <small>{sub}</small>
      </div>
      <span className={`task-check ${done ? 'done' : ''}`}><Icon name="check" size={13} /></span>
    </div>
  )
}

function buildFunnelPeriodRange(period: FunnelPeriodState): FunnelPeriodRange {
  const now = new Date()
  const today = startOfDay(now)
  let from = today
  let to = endOfDay(today)

  if (period.mode === 'yesterday') {
    from = addDays(today, -1)
    to = endOfDay(from)
  } else if (period.mode === 'this_week') {
    from = startOfWeek(today)
    to = endOfDay(today)
  } else if (period.mode === 'last_week') {
    const thisWeek = startOfWeek(today)
    from = addDays(thisWeek, -7)
    to = endOfDay(addDays(thisWeek, -1))
  } else if (period.mode === 'this_month') {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
    to = endOfDay(today)
  } else if (period.mode === 'last_month') {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    to = endOfDay(new Date(today.getFullYear(), today.getMonth(), 0))
  } else if (period.mode === 'this_year') {
    from = new Date(today.getFullYear(), 0, 1)
    to = endOfDay(today)
  } else if (period.mode === 'last_year') {
    from = new Date(today.getFullYear() - 1, 0, 1)
    to = endOfDay(new Date(today.getFullYear() - 1, 11, 31))
  } else if (period.mode === 'last_n_days') {
    const n = Math.max(1, period.lastN ?? 30)
    const includeToday = period.includeToday ?? true
    to = includeToday ? endOfDay(today) : endOfDay(addDays(today, -1))
    from = startOfDay(addDays(startOfDay(to), -(n - 1)))
  } else if (period.mode === 'custom') {
    from = parseDateInput(period.customFrom)
    to = endOfDay(parseDateInput(period.customTo))
    if (from > to) [from, to] = [startOfDay(to), endOfDay(from)]
  }

  const forcedDays = period.mode === 'last_n_days' ? Math.max(1, period.lastN ?? 30) : null
  const days = forcedDays ?? Math.max(1, Math.round((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000) + 1)
  const option = FUNNEL_PERIOD_OPTIONS.find((p) => p.id === period.mode)?.label ?? 'Période'
  return { from: startOfDay(from).toISOString(), to: endOfDay(to).toISOString(), label: `${option} · ${formatShortDate(from)} → ${formatShortDate(to)}`, days }
}

function getOverviewWarmupRanges(): FunnelPeriodRange[] {
  const modes: FunnelPeriodMode[] = ['today', 'yesterday', 'this_week', 'this_month', 'this_year']
  const unique = new Map<string, FunnelPeriodRange>()
  modes.forEach((mode) => {
    const range = buildFunnelPeriodRange({ ...DEFAULT_FUNNEL_PERIOD, mode })
    unique.set(`${range.from}|${range.to}`, range)
  })
  return Array.from(unique.values())
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDateInput(value: string): Date {
  const today = startOfDay(new Date())
  if (!value) return today
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, (month || 1) - 1, day || 1)
  return parsed > today ? today : startOfDay(parsed)
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  const day = d.getDay() || 7
  return addDays(d, 1 - day)
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function FunnelFlowMap({ totals }: { totals: AnalyticsFunnelResponse['totals'] }) {
  const treatedLeads = funnelTreatedLeads(totals)
  const answeredCount = Math.max(0, treatedLeads - totals.noAnswer)
  const responseRate = pct(answeredCount, treatedLeads)
  const treatedConversionRate = pct(totals.rdv, treatedLeads)
  return (
    <div className="flow-map col-span-12 mt-4 rounded-2xl border border-line-soft bg-white/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="eyebrow">Flux leads CRM</div>
          <div className="text-sm font-extrabold">Lecture minimaliste des appels jusqu’au RDV</div>
        </div>
        <div className="flow-pill flow-pill-success rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-700">
          {totals.rdv} RDV · {treatedConversionRate}% conv.
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr_auto_1.35fr_auto_1fr] gap-2 items-stretch">
        <MiniFlowStep title="Appels" value={totals.calls} sub={`${callsPerLead(totals.calls, treatedLeads)} / lead traité`} color="#1F7857" />
        <MiniArrow />
        <MiniFlowStep title="Traités" value={treatedLeads} sub="leads" color="#6B7C8C" />
        <MiniArrow />
        <div className="flow-response rounded-xl border border-line-soft bg-white/70 p-3">
          <div className="text-[10px] font-black uppercase text-faint">A répondu ?</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flow-response-yes rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-800">
              <div className="text-[10px] font-bold">Oui</div>
              <div className="text-lg font-black">{answeredCount}</div>
              <div className="text-[10px]">{responseRate}% leads traités</div>
            </div>
            <div className="flow-response-no rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
              <div className="text-[10px] font-bold">Non</div>
              <div className="text-lg font-black">{totals.noAnswer}</div>
              <div className="text-[10px]">{totals.relances} relances</div>
            </div>
          </div>
        </div>
        <MiniArrow />
        <MiniFlowStep title="RDV" value={totals.rdv} sub={`${treatedConversionRate}% leads traités`} color="#3DA86A" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
        <span className="flow-pill rounded-full bg-white/70 px-2 py-1 border border-line-soft">Formule : RDV / leads traités</span>
      </div>
    </div>
  )
}

function MiniFlowStep({ title, value, sub, color }: { title: string; value: number; sub: string; color: string }) {
  return (
    <div className="flow-step rounded-xl bg-white/70 border border-line-soft p-3 min-h-[82px]">
      <div className="text-[10px] font-black uppercase text-faint">{title}</div>
      <div className="text-2xl font-extrabold leading-none mt-1" style={{ color }}>{fmtCompact(value)}</div>
      <div className="text-[11px] text-muted mt-1">{sub}</div>
    </div>
  )
}

function MiniArrow() {
  return <div className="hidden xl:flex items-center justify-center text-xl font-black text-or px-1">→</div>
}

// ===== Helpers =====

function ratePct(denom: number, num: number): number {
  if (denom === 0) return 0
  return Math.round((num / denom) * 100)
}

function pct(num: number, denom: number): number {
  if (denom === 0) return 0
  return Math.min(100, Math.round((num / denom) * 100))
}

function funnelContactedLeads(totals: AnalyticsFunnelResponse['totals']): number {
  return Math.max(0, totals.answered + totals.noAnswer)
}

function funnelTreatedLeads(totals: AnalyticsFunnelResponse['totals']): number {
  return Math.max(
    funnelContactedLeads(totals),
    totals.qualified + totals.notQualified,
    totals.rdv,
  )
}

function callsPerLead(calls: number, leads: number): string {
  if (!leads) return '0'
  return (calls / leads).toFixed(calls >= leads * 10 ? 0 : 1)
}

function isClassifiedLead(lead: LeadResponse): boolean {
  return lead.status !== 'nouveau'
}

function isCreatedToday(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return false
  const now = new Date()
  return created.getFullYear() === now.getFullYear()
    && created.getMonth() === now.getMonth()
    && created.getDate() === now.getDate()
}

function isCreatedInRange(createdAt: string | null | undefined, fromIso: string, toIso: string): boolean {
  if (!createdAt) return false
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return false
  return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime()
}

function leadsKpiLabelFor(mode: FunnelPeriodMode): string {
  switch (mode) {
    case 'today': return "Nouveaux aujourd'hui"
    case 'yesterday': return 'Nouveaux hier'
    case 'this_week': return 'Nouveaux cette semaine'
    case 'last_week': return 'Nouveaux semaine dernière'
    case 'this_month': return 'Nouveaux ce mois-ci'
    case 'last_month': return 'Nouveaux mois dernier'
    case 'this_year': return 'Nouveaux cette année'
    case 'last_year': return 'Nouveaux année dernière'
    case 'custom': return 'Nouveaux sur la période'
    default: return "Nouveaux aujourd'hui"
  }
}

function belongsToSetter(lead: LeadResponse, setterId: string | undefined): boolean {
  if (!setterId) return true
  return lead.setterId === setterId || (lead.assignedSetterIds ?? []).includes(setterId)
}

type ActivityPoint = { label: string; value: number }

function isoDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  return iso.slice(0, 10)
}

function isoHour(iso: string | null | undefined): number | null {
  if (!iso) return null
  const d = new Date(iso)
  const hour = d.getHours()
  return Number.isNaN(hour) ? null : hour
}


function weekLogicalCallSeries(calls: CallLogResponse[], classified: LeadResponse[]): ActivityPoint[] {
  return lastNDays(7).map((day) => {
    const logged = calls.filter((c) => isoDayKey(c.calledAt) === day).length
    const classifs = classified.filter((l) => isoDayKey(l.updatedAt) === day).length
    return { label: dayLabel(day), value: Math.max(logged, classifs) }
  })
}

function todayLogicalCallSeries(calls: CallLogResponse[], classified: LeadResponse[]): ActivityPoint[] {
  const today = new Date().toISOString().slice(0, 10)
  const hours = Array.from({ length: 12 }, (_, i) => 8 + i)
  return hours.map((hour) => {
    const logged = calls.filter((c) => isoDayKey(c.calledAt) === today && isoHour(c.calledAt) === hour).length
    const classifs = classified.filter((l) => isoDayKey(l.updatedAt) === today && isoHour(l.updatedAt) === hour).length
    return { label: `${hour}h`, value: Math.max(logged, classifs) }
  })
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
}

function callbackBucket(iso: string | null): 'late' | 'today' | 'tomorrow' | 'later' {
  if (!iso) return 'later'
  const key = new Date(iso).toISOString().slice(0, 10)
  const today = new Date()
  const todayKey = today.toISOString().slice(0, 10)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowKey = tomorrow.toISOString().slice(0, 10)
  if (key < todayKey) return 'late'
  if (key === todayKey) return 'today'
  if (key === tomorrowKey) return 'tomorrow'
  return 'later'
}

function formatCallbackTime(iso: string | null): string {
  if (!iso) return 'à planifier'
  const d = new Date(iso)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function fmtKEur(val: number): string {
  if (val === 0) return '0€'
  if (val >= 1000) return `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k€`
  return `${Math.round(val)}€`
}

function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return String(n)
}

function shortDateTime(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mn = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${mn}`
}

// ===== Futuristic data helpers =====

function leadStatusSegments(leads: LeadResponse[]): { status: LeadStatus; label: string; value: number }[] {
  const counts = leads.reduce<Record<string, number>>((acc, lead) => {
    acc[lead.status] = (acc[lead.status] ?? 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .map(([status, value]) => ({ status: status as LeadStatus, label: STATUS_LABEL[status as LeadStatus] ?? status, value }))
    .filter((segment) => segment.value > 0)
    .sort((a, b) => b.value - a.value)
}

function adminFunnelProspects(rdvs: RdvResponse[], leads: LeadResponse[], users: UserResponse[]): QualifiedProspect[] {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]))
  const userById = new Map(users.map((user) => [user.id, user]))
  const nameOf = (id: string | null | undefined) => (id ? userById.get(id)?.name ?? null : null)
  const todayIso = new Date().toISOString()

  return rdvs
    .filter((rdv) => rdv.status === 'planifie' || rdv.status === 'honore')
    .map((rdv) => {
      const lead = leadById.get(rdv.leadId)
      const commercialName = nameOf(rdv.commercialId) ?? nameOf(lead?.latestRdvCommercialId) ?? nameOf(lead?.assignedToId)
      const setterName = nameOf(lead?.setterId) ?? (lead?.assignedSetterIds?.length ? nameOf(lead.assignedSetterIds[0]) : null)
      return {
        id: rdv.id,
        name: lead ? (fullName(lead) || lead.email || lead.phone || 'Prospect qualifié') : 'Prospect qualifié',
        phone: lead?.phone ?? null,
        city: lead?.city ?? null,
        status: commercialProspectStatus({ rdv, lead }),
        scheduledAt: rdv.scheduledAt,
        commercialName,
        setterName,
      }
    })
    .sort((a, b) => {
      const aFuture = (a.scheduledAt ?? '') >= todayIso
      const bFuture = (b.scheduledAt ?? '') >= todayIso
      if (aFuture && !bFuture) return -1
      if (!aFuture && bFuture) return 1
      // future RDVs: soonest first ; passés : plus récents d'abord
      return aFuture
        ? (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')
        : (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? '')
    })
}

function commercialQualifiedProspects(rdvs: RdvResponse[], leads: LeadResponse[], commercialId: string | undefined): QualifiedProspect[] {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]))
  const prospects = new Map<string, QualifiedProspect>()

  leads
    .filter((lead) => !commercialId || lead.assignedToId === commercialId || lead.latestRdvCommercialId === commercialId)
    .filter((lead) => ['qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu', 'pas_qualifie'].includes(lead.status))
    .forEach((lead) => prospects.set(lead.id, {
      id: lead.id,
      name: fullName(lead) || lead.email || lead.phone || 'Prospect qualifié',
      phone: lead.phone,
      city: lead.city,
      status: commercialProspectStatus({ lead }),
      scheduledAt: lead.latestRdvAt,
    }))

  rdvs
    .filter((rdv) => rdv.status === 'planifie' || rdv.status === 'honore' || rdv.status === 'annule' || rdv.status === 'no_show' || rdv.result === 'signe' || rdv.result === 'reflexion' || rdv.result === 'perdu' || rdv.result === 'no_show')
    .forEach((rdv) => {
      const lead = leadById.get(rdv.leadId)
      const status = commercialProspectStatus({ rdv, lead })
      prospects.set(rdv.leadId, {
        id: rdv.leadId,
        name: lead ? (fullName(lead) || lead.email || lead.phone || 'Prospect qualifié') : 'Prospect qualifié',
        phone: lead?.phone ?? null,
        city: lead?.city ?? null,
        status,
        scheduledAt: rdv.scheduledAt,
      })
    })

  return Array.from(prospects.values()).sort((a, b) => (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? ''))
}

// Cartes Overview alimentées par les débriefs réels (table debriefs via
// /analytics/debriefs). Les catégories sont exactement celles du formulaire de
// débrief : facteurs d'acceptation (vente) + motifs de non-vente.
function acceptanceFactorSegments(data: DebriefAnalyticsResponse | null | undefined): LeadSegment[] {
  const counts = data?.acceptanceFactorCounts ?? {}
  return (Object.keys(DEBRIEF_ACCEPTANCE_FACTOR_LABEL) as DebriefAcceptanceFactor[]).map((key) => ({
    label: DEBRIEF_ACCEPTANCE_FACTOR_LABEL[key],
    description: DEBRIEF_ACCEPTANCE_FACTOR_LABEL[key],
    value: counts[key] ?? 0,
  }))
}

function nonSaleReasonSegments(data: DebriefAnalyticsResponse | null | undefined): LeadSegment[] {
  const counts = data?.nonSaleReasonCounts ?? {}
  return (Object.keys(DEBRIEF_NON_SALE_REASON_LABEL) as DebriefNonSaleReason[]).map((key) => ({
    label: DEBRIEF_NON_SALE_REASON_LABEL[key],
    description: DEBRIEF_NON_SALE_REASON_LABEL[key],
    value: counts[key] ?? 0,
  }))
}

const QUALIFIED_OBJECTION_LABELS: Array<{ label: string; description: string; match: (source: CommercialDebriefSource) => boolean }> = [
  { label: 'Argent', description: "Je n'ai pas d'argent", match: ({ rdv }) => textIncludes(rdv?.objections, ['argent']) },
  { label: 'Logistique', description: 'Il faut trouver la solution', match: ({ rdv }) => textIncludes(rdv?.objections, ['logistique']) },
  { label: 'Partenaire', description: 'Je dois parler à mon partenaire', match: ({ rdv }) => textIncludes(rdv?.objections, ['partenaire']) },
  { label: 'Peur', description: "Je ne sais pas si vous pouvez m'aider", match: ({ rdv }) => textIncludes(rdv?.objections, ['peur']) },
  { label: 'Écran de fumée', description: "J'ai poney demain…", match: ({ rdv }) => textIncludes(rdv?.objections, ['écran de fumée', 'ecran de fumee']) },
  { label: "Pas d'objection", description: 'Aucune objection restante', match: ({ rdv }) => textIncludes(rdv?.objections, ["pas d'objection", 'pas objection']) },
]

const NON_SALE_DEBRIEF_LABELS: Array<{ label: string; description: string; match: (source: CommercialDebriefSource) => boolean }> = [
  { label: 'Suivi prévu', description: 'Je veux faire un suivi', match: ({ rdv }) => rdv?.result === 'reflexion' || textIncludes(rdv?.nonSaleReason, ['suivi prévu', 'suivi prevu']) || textIncludes(rdv?.notes, ['suivi prévu', 'faire un suivi', 'suivi prevu']) },
  { label: 'Non qualifié', description: 'Le contact était faible', match: ({ rdv, lead }) => lead?.status === 'pas_qualifie' || textIncludes(rdv?.nonSaleReason, ['non qualifié', 'non qualifie', 'contact faible']) || textIncludes(lead?.lostReason, ['non qualifié', 'non qualifie', 'contact faible']) },
  { label: 'No-show', description: "Ne s'est pas présenté", match: ({ rdv, lead }) => rdv?.status === 'no_show' || rdv?.result === 'no_show' || textIncludes(rdv?.nonSaleReason, ['no-show', 'no show', 'pas présenté', 'pas presente']) || textIncludes(lead?.ghlStageName, ['no-show', 'no show']) },
  { label: 'Contact annulé', description: 'Le contact a annulé', match: ({ rdv, lead }) => (rdv?.status === 'annule' && !textIncludes(rdv?.nonSaleReason, ['administrative', 'notre côté', 'notre cote'])) || textIncludes(rdv?.nonSaleReason, ['contact annulé', 'contact annule', 'client annulé', 'client annule']) || textIncludes(lead?.lostReason, ['contact annulé', 'contact annule', 'client annulé', 'client annule']) },
  { label: 'Annulation administrative', description: 'Annulé de notre côté', match: ({ rdv, lead }) => textIncludes(rdv?.nonSaleReason, ['administrative', 'notre côté', 'notre cote']) || textIncludes(lead?.lostReason, ['administrative', 'notre côté', 'notre cote']) },
  { label: 'Pas intéressé', description: 'Pas envie de continuer', match: ({ rdv, lead }) => rdv?.result === 'perdu' || lead?.status === 'perdu' || textIncludes(rdv?.nonSaleReason, ['pas intéressé', 'pas interesse', 'pas envie', 'refus']) || textIncludes(lead?.lostReason, ['pas intéressé', 'pas interesse', 'pas envie', 'refus']) },
]

function commercialQualifiedDebriefSegments(rdvs: RdvResponse[], leads: LeadResponse[], commercialId: string | undefined, range: FunnelPeriodRange): LeadSegment[] {
  const sources = commercialDebriefSources(rdvs, leads, commercialId)
    .filter((source) => commercialDebriefSourceInRange(source, range))
    .filter(isQualifiedDebriefSource)
  const matchedIds = new Set<string>()
  return QUALIFIED_OBJECTION_LABELS.map(({ label, description, match }) => {
    const matching = sources.filter((source) => !matchedIds.has(source.id) && match(source))
    matching.forEach((source) => matchedIds.add(source.id))
    return { label, description, value: matching.length }
  })
}

function commercialNonSaleDebriefSegments(rdvs: RdvResponse[], leads: LeadResponse[], commercialId: string | undefined, range: FunnelPeriodRange): LeadSegment[] {
  const sources = commercialDebriefSources(rdvs, leads, commercialId)
    .filter((source) => commercialDebriefSourceInRange(source, range))
    .filter(isNonSaleDebriefSource)
  const matchedIds = new Set<string>()
  return NON_SALE_DEBRIEF_LABELS.map(({ label, description, match }) => {
    const matching = sources.filter((source) => !matchedIds.has(source.id) && match(source))
    matching.forEach((source) => matchedIds.add(source.id))
    return { label, description, value: matching.length }
  })
}

function commercialDebriefSources(rdvs: RdvResponse[], leads: LeadResponse[], commercialId: string | undefined): CommercialDebriefSource[] {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]))
  const sourceById = new Map<string, CommercialDebriefSource>()

  const relevantLeadStatuses: LeadStatus[] = ['qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu', 'pas_qualifie']
  leads
    .filter((lead) => !commercialId || lead.assignedToId === commercialId || lead.latestRdvCommercialId === commercialId)
    .filter((lead) => relevantLeadStatuses.includes(lead.status))
    .forEach((lead) => sourceById.set(`lead:${lead.id}`, { id: `lead:${lead.id}`, lead }))

  rdvs
    .filter((rdv) => rdv.status === 'planifie' || rdv.status === 'honore' || rdv.status === 'annule' || rdv.status === 'no_show' || rdv.status === 'reporte' || rdv.result === 'signe' || rdv.result === 'reflexion' || rdv.result === 'perdu' || rdv.result === 'no_show' || rdv.result === 'reporte')
    .forEach((rdv) => {
      const lead = leadById.get(rdv.leadId)
      sourceById.delete(`lead:${rdv.leadId}`)
      sourceById.set(`rdv:${rdv.id}`, { id: `rdv:${rdv.id}`, rdv, lead })
    })

  return Array.from(sourceById.values())
}

function commercialDebriefSourceInRange(source: CommercialDebriefSource, range: FunnelPeriodRange): boolean {
  const rdv = source.rdv
  const lead = source.lead
  const date = rdv?.debriefFilledAt
    ?? rdv?.updatedAt
    ?? rdv?.scheduledAt
    ?? lead?.lastStageChangeAt
    ?? lead?.latestRdvAt
    ?? lead?.updatedAt
    ?? lead?.createdAt
    ?? null
  return isCreatedInRange(date, range.from, range.to)
}

function isNonSaleDebriefSource({ rdv, lead }: CommercialDebriefSource): boolean {
  if (lead?.status === 'perdu' || lead?.status === 'pas_qualifie') return true
  if (rdv?.result === 'perdu' || rdv?.result === 'no_show' || rdv?.status === 'annule' || rdv?.status === 'no_show') return true
  return Boolean(rdv?.nonSaleReason && !textIncludes(rdv.nonSaleReason, ['suivi prévu', 'suivi prevu']))
}

function isQualifiedDebriefSource(source: CommercialDebriefSource): boolean {
  const { rdv, lead } = source
  if (isNonSaleDebriefSource(source)) return false
  if (lead?.status === 'qualifie' || lead?.status === 'rdv_pris' || lead?.status === 'rdv_honore' || lead?.status === 'signe') return true
  if (rdv?.status === 'planifie' || rdv?.status === 'honore' || rdv?.result === 'signe' || rdv?.result === 'reflexion') return true
  return Boolean(rdv?.nonSaleReason && textIncludes(rdv.nonSaleReason, ['suivi prévu', 'suivi prevu']))
}

function commercialProspectStatus({ rdv, lead }: { rdv?: RdvResponse; lead?: LeadResponse }): 'Signé' | 'Non qualifié' | 'En attente' {
  if (rdv?.result === 'signe' || lead?.status === 'signe') return 'Signé'
  if (rdv?.result === 'perdu' || rdv?.result === 'no_show' || rdv?.status === 'annule' || rdv?.status === 'no_show' || (rdv?.nonSaleReason && !textIncludes(rdv.nonSaleReason, ['suivi prévu', 'suivi prevu'])) || lead?.status === 'perdu' || lead?.status === 'pas_qualifie') return 'Non qualifié'
  return 'En attente'
}

function textIncludes(value: string | null | undefined, needles: string[]): boolean {
  if (!value) return false
  const normalized = value.toLocaleLowerCase('fr-FR')
  return needles.some((needle) => normalized.includes(needle.toLocaleLowerCase('fr-FR')))
}

function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}


// ===== Atoms =====

function FuturisticLineChart({ points, color, caption }: { points: ActivityPoint[]; color: string; caption: string }) {
  const values = points.map((p) => p.value)
  const total = values.reduce((a, b) => a + b, 0)
  const peak = Math.max(0, ...values)
  const peakIndex = values.findIndex((v) => v === peak)
  const width = 520
  const height = 150
  const padX = 18
  const padTop = 10
  const padBottom = 26
  const chartWidth = width - padX * 2
  const chartHeight = height - padTop - padBottom
  const safeMax = Math.max(1, peak)
  const barGap = points.length > 8 ? 3 : 5
  const barWidth = (chartWidth - (points.length - 1) * barGap) / Math.max(1, points.length)
  const showEvery = points.length > 8 ? 3 : 1

  return (
    <div className="setter-chart">
      <div className="setter-chart-head">
        <div>
          <div className="setter-chart-total">{total}</div>
          <div className="setter-chart-caption">{caption}</div>
        </div>
        <div className="setter-chart-peak">
          <span>{peak}</span>
          <small>pic</small>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="setter-chart-svg" preserveAspectRatio="none">
        <line x1={padX} x2={width - padX} y1={height - padBottom} y2={height - padBottom} stroke="#E5E1DA" strokeWidth="1" />
        {points.map((p, i) => {
          const x = padX + i * (barWidth + barGap)
          const barHeight = peak ? (p.value / safeMax) * chartHeight : 0
          const y = height - padBottom - Math.max(2, barHeight)
          const isPeak = i === peakIndex && peak > 0
          const showLabel = i % showEvery === 0 || i === points.length - 1
          return (
            <g key={`${p.label}-${i}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, barHeight)}
                rx="2"
                fill={isPeak ? color : peak ? color : '#E5E1DA'}
                opacity={isPeak ? 1 : peak ? 0.55 : 0.5}
              />
              {showLabel ? (
                <text
                  x={x + barWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="600"
                  fill={isPeak ? color : '#9CA3AF'}
                  fontFamily="inherit"
                >
                  {p.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function PillTabs({ items, active, onChange }: { items: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex bg-or-tint p-0.5 rounded-full text-[11px] font-semibold">
      {items.map((it) => (
        <button key={it.id} className={`pill-tab ${active === it.id ? 'active' : ''}`} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  )
}

function PipelineRow({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 eyebrow text-[10px]">{label}</div>
      <div className="h-7 rounded-md flex items-center px-3 text-white font-bold text-xs" style={{ width: `${Math.max(8, pct)}%`, background: color }}>{count}</div>
    </div>
  )
}

function RdvRow({ color, time, sub }: { color: string; time: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 p-2 bg-white/40 rounded-lg border border-line-soft">
      <div className="w-1 h-8 rounded-full" style={{ background: color }}></div>
      <div className="flex-grow">
        <div className="text-xs font-semibold">{time}</div>
        <div className="text-[10px] text-faint">{sub}</div>
      </div>
    </div>
  )
}
