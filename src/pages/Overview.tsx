import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useDisplayUser } from '../lib/role'
import { useCallLogs, useLeads, useRdvList, useUsers, useStartCall, useAnalyticsFunnel, useAnalyticsSummary, prefetchAnalyticsFunnel, prefetchAnalyticsSummary } from '../lib/hooks'
import { STATUS_LABEL, fullName, initials, type AnalyticsFunnelResponse, type CallLogResponse, type LeadResponse, type LeadStatus, type RdvResponse } from '../lib/types'

type FunnelPeriodMode = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom'
type FunnelPeriodState = { mode: FunnelPeriodMode; customFrom: string; customTo: string }
type FunnelPeriodRange = { from: string; to: string; label: string; days: number }
type EvolutionGranularity = 'hour' | 'day' | 'week' | 'month'

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
  if (role === 'commercial') return <OverviewCommercial />
  return <OverviewSetter />
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
    const connexions = Math.max(
      loggedCalls.filter((c) => c.result === 'joint' || c.result === 'rdv_pris').length,
      classified.filter((l) => l.status === 'qualifie' || l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length,
    )
    const qualifies = classified.filter((l) => l.status === 'qualifie' || l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length
    const rdvPris = classified.filter((l) => l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length
    return {
      appels,
      connexions,
      qualifies,
      rdvPris,
      total: ownLeads.length,
      ownLeads,
      qualifRate: ratePct(appels, qualifies),
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

        <section className="overview-air-grid">
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
          <AirKpi icon="phone" label="Appels passés" value={fmtCompact(stats.appels)} sub={`${stats.connectionRate}% connexion`} />
          <AirKpi icon="users" label="Connexions" value={fmtCompact(stats.connexions)} sub="contacts joints" />
          <AirKpi icon="target" label="Qualifiés" value={fmtCompact(stats.qualifies)} sub={`${stats.qualifRate}% qualification`} />
          <AirKpi icon="trophy" label="RDV pris" value={fmtCompact(stats.rdvPris)} sub="issus de tes leads" />

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
                color="#D4AF37"
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
  const [commercialPeriod, setCommercialPeriod] = useState<FunnelPeriodState>({ ...DEFAULT_FUNNEL_PERIOD, mode: 'this_month' })
  const commercialRange = buildFunnelPeriodRange(commercialPeriod)
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const { data: rdvs = [] } = useRdvList({ commercialId: me?.id, fromDate: commercialRange.from, toDate: commercialRange.to, limit: 200 })
  const { data: commercialSummary } = useAnalyticsSummary({ from: commercialRange.from, to: commercialRange.to })

  const stats = useMemo(() => {
    const list = rdvs ?? []
    const analytics = commercialSummary?.commercial
    const honored = list.filter((r) => r.status === 'honore')
    const signed = list.filter((r) => r.result === 'signe')
    const lost = list.filter((r) => r.result === 'perdu')
    const reflexion = list.filter((r) => r.result === 'reflexion')
    const fallbackCa = signed.reduce((sum, r) => sum + (parseFloat(r.montantTotal ?? '0') || 0), 0)
    const outcomeBase = Math.max(honored.length, signed.length + lost.length + reflexion.length)
    const fallbackClosing = outcomeBase ? Math.round((signed.length / outcomeBase) * 100) : 0
    const fallbackPanier = signed.length ? fallbackCa / signed.length : 0
    const upcoming = list
      .filter((r) => r.status === 'planifie' && r.scheduledAt >= todayIso)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    const totalPlanifie = list.filter((r) => r.status === 'planifie').length
    const totalHonored = analytics?.honored ?? honored.length
    const totalRdv = analytics?.total ?? list.length
    return {
      ca: analytics?.ca ?? fallbackCa,
      closing: analytics?.closing ?? fallbackClosing,
      panier: analytics?.panier ?? fallbackPanier,
      signed: analytics?.signed ?? signed.length,
      upcoming,
      totalPlanifie,
      totalHonored,
      totalRdv,
      lost: analytics?.resultSegments.find((segment) => segment.label === 'Perdu')?.value ?? lost.length,
      reflexion: analytics?.resultSegments.find((segment) => segment.label === 'Réflexion')?.value ?? reflexion.length,
    }
  }, [rdvs, todayIso, commercialSummary])

  return (
    <AppShell blobsKey="commercial" flat>
      <Topbar
        eyebrow="COMMERCIAL"
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
              {FUNNEL_PERIOD_OPTIONS.filter((period) => period.id === 'today' || period.id === 'this_week' || period.id === 'this_month' || period.id === 'this_year').map((period) => (
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
            <div>
              <span className="shot-eyebrow">Performance commerciale</span>
              <h2>{fmtKEur(stats.ca)}</h2>
              <p>{fmtCompact(stats.totalRdv)} RDV suivis · {fmtCompact(stats.totalHonored)} honorés · {fmtCompact(stats.signed)} ventes signées</p>
              <div className="overview-commercial-actions">
                <button type="button" onClick={() => navigate('/rdv')}>Voir mes RDV</button>
                <button type="button" onClick={() => navigate('/analytics')}>Suivre mes ventes</button>
              </div>
            </div>
          </div>
          <div className="overview-commercial-hero-metrics">
            <div><small>Closing</small><strong>{stats.closing}%</strong></div>
            <div><small>Panier moyen</small><strong>{fmtKEur(stats.panier)}</strong></div>
            <div><small>À venir</small><strong>{fmtCompact(stats.upcoming.length)}</strong></div>
          </div>
        </section>

        <section className="overview-air-grid overview-commercial-grid">
          <AirKpi icon="trophy" label="CA signé" value={fmtKEur(stats.ca)} sub={`${fmtCompact(stats.signed)} ventes`} />
          <AirKpi icon="target" label="Closing" value={`${stats.closing}%`} sub={`${fmtCompact(stats.lost)} perdus`} />
          <AirKpi icon="chart" label="Panier moyen" value={fmtKEur(stats.panier)} sub="sur ventes signées" />
          <AirKpi icon="users" label="RDV suivis" value={fmtCompact(stats.totalRdv)} sub={`${fmtCompact(stats.totalHonored)} honorés`} />

          <div className="overview-air-card overview-role-wide overview-revenue-evolution-card">
            <RevenueEvolutionChart points={rdvRevenueSeries(rdvs ?? [])} total={stats.ca} />
          </div>

          <div className="overview-air-card overview-role-side">
            <CardHead title="Closing" icon="target" />
            <div className="overview-role-closing">{stats.closing}%</div>
            <p className="overview-role-muted">{fmtCompact(stats.signed)} ventes, {fmtCompact(stats.lost)} perdus, {fmtCompact(stats.reflexion)} en réflexion.</p>
            <div className="overview-real-segments mt-4" style={{ ['--seg-a' as string]: Math.max(stats.signed, 1), ['--seg-b' as string]: Math.max(stats.reflexion, 1), ['--seg-c' as string]: Math.max(stats.lost, 1) }}>
              <span /><span /><span />
            </div>
          </div>

          <div className="overview-commercial-rdv-actions">
            <div className="overview-air-card overview-role-side">
              <CardHead title="Pipeline" icon="arrow-right" />
              <div className="space-y-3">
                <PipelineRow label="RDV planifiés" count={stats.totalPlanifie} pct={100} color="#D4AF37" />
                <PipelineRow label="Honorés" count={stats.totalHonored} pct={pct(stats.totalHonored, stats.totalPlanifie)} color="#B87333" />
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
                    color={['#D4AF37', '#B87333', '#B7410E', '#3DA86A'][i % 4]}
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
      void Promise.allSettled(
        warmupRanges.flatMap((range) => {
          const filters = { from: range.from, to: range.to }
          const force = `${range.from}|${range.to}` !== currentKey
          return [
            prefetchAnalyticsSummary(filters, { force }),
            prefetchAnalyticsFunnel(filters, { force }),
          ]
        }),
      )
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

  const stats = useMemo(() => {
    const calls = adminSummary?.calls ?? funnelTotals.calls
    const qualified = adminSummary?.qualified ?? funnelTotals.qualified
    const rdvPris = adminSummary?.rdvPris ?? funnelTotals.rdv
    const signed = adminSummary?.signed ?? 0
    const ca = adminSummary?.ca ?? 0
    const team = (usersList ?? []).filter((u) => u.active)
    return {
      caMois: ca,
      ventes: signed,
      closing: ratePct(Math.max(1, rdvPris), signed),
      leads: treatedLeadTotal,
      appels: calls,
      classified: treatedLeadTotal,
      qualified,
      qualifRate: adminSummary?.qualificationRate ?? funnelTotals.qualificationRate,
      panier: signed ? ca / signed : 0,
      teamActive: team.length,
      teamTotal: (usersList ?? []).length,
      rdvPris,
    }
  }, [adminSummary, funnelTotals, treatedLeadTotal, usersList])
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
        eyebrow="ADMIN — TABLEAU DE BORD"
        title="Performance équipe"
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
            <div className="overview-range-switch" aria-label="Période tableau de bord admin">
              {FUNNEL_PERIOD_OPTIONS.filter((period) => period.id !== 'custom' && period.id !== 'last_week' && period.id !== 'last_month' && period.id !== 'last_year').map((period) => (
                <button
                  key={period.id}
                  type="button"
                  className={funnelPeriod.mode === period.id ? 'active' : ''}
                  onClick={() => setFunnelPeriod((current) => ({ ...current, mode: period.id }))}
                >
                  {period.label}
                </button>
              ))}
            </div>
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

          <AirKpi icon="trophy" label="CA total" value={fmtKEur(stats.caMois)} sub={`${stats.ventes} ventes signées`} />
          <AirKpi icon="target" label="Closing" value={`${stats.closing}%`} sub={`${fmtCompact(stats.rdvPris)} RDV suivis`} />
          <AirKpi icon="phone" label="Appels" value={fmtCompact(stats.appels)} sub={`${fmtCompact(stats.classified)} leads traités`} />
          <AirKpi icon="users" label="Leads traités" value={fmtCompact(stats.leads)} sub={`${fmtCompact(stats.qualified)} qualifiés`} />

          <div className="overview-air-card overview-air-chart overview-lead-evolution-card">
            <LeadEvolutionChart
              points={evolutionPoints}
              granularity={evolutionGranularity}
              rangeLabel={funnelRange.days === 1 ? "Aujourd'hui" : `${funnelRange.days} jours`}
              totals={{ leads: stats.leads, rdv: stats.rdvPris, signed: stats.ventes }}
            />
          </div>


          <div className="overview-air-card overview-air-pipeline">
            <div className="shot-onboarding-top">
              <div>
                <span className="shot-eyebrow">Pipeline réel</span>
                <h3>Avancement CRM</h3>
              </div>
              <strong>{pct(stats.rdvPris, stats.leads)}%</strong>
            </div>
            <div className="overview-real-segments" style={{ ['--seg-a' as string]: `${Math.max(1, stats.leads)}`, ['--seg-b' as string]: `${Math.max(1, funnelTotals.qualified || stats.qualified)}`, ['--seg-c' as string]: `${Math.max(1, funnelTotals.rdv || stats.rdvPris)}` }}>
              <span />
              <span />
              <span />
            </div>
            <TaskLine icon="phone" title="Leads traités" sub={`${fmtCompact(stats.leads)} traités · ${fmtCompact(Math.max(funnelTotals.calls, stats.appels))} appels`} done={stats.leads > 0} />
            <TaskLine icon="target" title="Leads qualifiés" sub={`${fmtCompact(funnelTotals.qualified || stats.qualified)} leads`} done={(funnelTotals.qualified || stats.qualified) > 0} />
            <TaskLine icon="trophy" title="RDV obtenus" sub={`${fmtCompact(funnelTotals.rdv || stats.rdvPris)} RDV`} done={(funnelTotals.rdv || stats.rdvPris) > 0} />
          </div>

          <div className="overview-air-card overview-air-funnel">
            <div className="shot-calendar-head">
              <span>{formatShortDate(new Date(funnelRange.from))}</span>
              <strong>Funnel CRM</strong>
              <button onClick={() => navigate('/analytics')}>Détails</button>
            </div>
            <FunnelFlowMap totals={overviewFunnelTotals} />
          </div>
          </section>

          <aside className="overview-admin-side-rail" aria-label="Répartition des leads">
            <LeadPieAnalysis segments={leadSegments} totalFallback={stats.leads} />
          </aside>
        </div>

      </main>
    </AppShell>
  )
}

// ===== Helpers =====

type ShotIcon = 'trophy' | 'users' | 'target' | 'arrow-right' | 'chart' | 'phone' | 'check'

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

type LeadEvolutionPoint = { key: string; date: string; label: string; leads: number; rdv: number; signed: number }
type LeadEvolutionSeriesKey = 'leads' | 'rdv' | 'signed'

const LEAD_EVOLUTION_SERIES: { key: LeadEvolutionSeriesKey; label: string; color: string }[] = [
  { key: 'leads', label: 'Leads', color: '#D4AF37' },
  { key: 'rdv', label: 'RDV', color: '#3DA86A' },
  { key: 'signed', label: 'Ventes', color: '#B87333' },
]

const GRANULARITY_SUBTITLE: Record<EvolutionGranularity, string> = {
  hour: 'Leads traités par heure',
  day: 'Leads traités par jour',
  week: 'Leads traités par semaine',
  month: 'Leads traités par mois',
}

const LAST_BUCKET_LABEL: Record<EvolutionGranularity, string> = {
  hour: 'Dernière heure',
  day: 'Dernier jour',
  week: 'Dernière semaine',
  month: 'Dernier mois',
}

function LeadEvolutionChart({ points, granularity, rangeLabel, totals }: { points: LeadEvolutionPoint[]; granularity: EvolutionGranularity; rangeLabel: string; totals: { leads: number; rdv: number; signed: number } }) {
  const rawPoints = points.length > 0 ? points : [{ key: 'empty', date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }]
  const safePoints = rawPoints.length > 56 ? rawPoints.filter((_, index) => index % Math.ceil(rawPoints.length / 56) === 0 || index === rawPoints.length - 1) : rawPoints
  const subtitle = GRANULARITY_SUBTITLE[granularity]
  const [activeKey, setActiveKey] = useState<LeadEvolutionSeriesKey>('leads')
  const [hover, setHover] = useState<{ x: number; y: number; cursorX: number; cursorY: number; cursorValue: number; index: number } | null>(null)
  const width = 620
  const height = 260
  const padX = 44
  const padTop = 24
  const padBottom = 42
  const chartWidth = width - padX * 2
  const chartHeight = height - padTop - padBottom
  const activeSeries = LEAD_EVOLUTION_SERIES.find((series) => series.key === activeKey) ?? LEAD_EVOLUTION_SERIES[0]
  const max = Math.max(1, ...safePoints.map((point) => point[activeKey]))
  const ghostMax = Math.max(1, ...safePoints.flatMap((point) => LEAD_EVOLUTION_SERIES.map((series) => point[series.key])))
  const last = safePoints[safePoints.length - 1]
  const first = safePoints[0]
  const activeValue = last[activeKey]
  const delta = activeValue - first[activeKey]
  const total = totals[activeKey]
  const peak = safePoints.reduce((best, point) => point[activeKey] > best[activeKey] ? point : best, safePoints[0])
  const clamp = (value: number, min: number, maxValue: number) => Math.min(maxValue, Math.max(min, value))
  const xFor = (index: number) => padX + (safePoints.length === 1 ? chartWidth / 2 : (index / (safePoints.length - 1)) * chartWidth)
  const yFor = (value: number, baseMax = max) => padTop + chartHeight - (value / baseMax) * chartHeight
  const pathFor = (key: LeadEvolutionSeriesKey, baseMax = max) => safePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(point[key], baseMax).toFixed(1)}`).join(' ')
  const activePath = pathFor(activeKey)
  const activeHover = hover ? safePoints[hover.index] : null

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const cursorX = clamp(((event.clientX - rect.left) / rect.width) * width, padX, width - padX)
    const cursorY = clamp(((event.clientY - rect.top) / rect.height) * height, padTop, height - padBottom)
    const ratio = chartWidth === 0 ? 0 : (cursorX - padX) / chartWidth
    const index = safePoints.length <= 1 ? 0 : clamp(Math.round(ratio * (safePoints.length - 1)), 0, safePoints.length - 1)
    const point = safePoints[index]
    const x = xFor(index)
    const y = yFor(point[activeKey])
    const cursorRatio = (padTop + chartHeight - cursorY) / chartHeight
    const cursorValue = Math.round(clamp(cursorRatio, 0, 1) * max)
    setHover({ x, y, cursorX, cursorY, cursorValue, index })
  }

  return (
    <div className="lead-evolution">
      <div className="lead-evolution-head">
        <div>
          <h3>Courbes d’évolution des leads</h3>
          <p>{subtitle} — {rangeLabel}</p>
        </div>
        <span>évolution</span>
      </div>
      <div className="lead-evolution-tabs" aria-label="Courbe active">
        {LEAD_EVOLUTION_SERIES.map((series) => (
          <button key={series.key} type="button" className={activeKey === series.key ? 'active' : ''} onClick={() => setActiveKey(series.key)} style={{ ['--series-color' as string]: series.color }}>
            <small><i style={{ background: series.color }} />{series.label}</small>
            <strong>{fmtCompact(totals[series.key])}</strong>
          </button>
        ))}
      </div>
      <div className="lead-evolution-svg-wrap">
        <div className="lead-evolution-last-card">
          <small>{LAST_BUCKET_LABEL[granularity]}</small>
          <strong style={{ color: activeSeries.color }}>{fmtCompact(activeValue)}</strong>
          <span className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{fmtCompact(delta)} vs début</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Évolution leads RDV ventes">
          <defs>
            <linearGradient id="leadEvolutionFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={activeSeries.color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={activeSeries.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((ratio) => {
            const y = padTop + ratio * chartHeight
            const label = Math.round(max * (1 - ratio))
            return (
              <g key={ratio}>
                <line x1={padX} x2={width - padX} y1={y} y2={y} className="lead-evolution-grid" />
                <text x="10" y={y + 4} className="lead-evolution-yaxis">{fmtCompact(label)}</text>
              </g>
            )
          })}
          {LEAD_EVOLUTION_SERIES.filter((series) => series.key !== activeKey).map((series) => <path key={series.key} d={pathFor(series.key, ghostMax)} className="lead-evolution-ghost" style={{ stroke: series.color }} />)}
          <path d={`${activePath} L ${xFor(safePoints.length - 1)} ${height - padBottom} L ${xFor(0)} ${height - padBottom} Z`} fill="url(#leadEvolutionFill)" />
          <path d={activePath} className="lead-evolution-line" style={{ stroke: activeSeries.color }} />
          {hover ? (
            <g pointerEvents="none">
              <line x1={hover.cursorX} x2={hover.cursorX} y1={padTop} y2={height - padBottom} className="lead-evolution-guide" style={{ stroke: activeSeries.color }} />
              <line x1={padX} x2={width - padX} y1={hover.cursorY} y2={hover.cursorY} className="lead-evolution-guide subtle" style={{ stroke: activeSeries.color }} />
              <circle cx={hover.cursorX} cy={hover.cursorY} r="4" className="lead-evolution-cursor-dot" style={{ fill: activeSeries.color }} />
              <text x={Math.min(width - 70, hover.cursorX + 8)} y={Math.max(16, hover.cursorY - 8)} className="lead-evolution-cursor-label" style={{ fill: activeSeries.color }}>{fmtCompact(hover.cursorValue)}</text>
            </g>
          ) : null}
          {safePoints.map((point, index) => {
            const x = xFor(index)
            const y = yFor(point[activeKey])
            const isPeak = point.key === peak.key && peak[activeKey] > 0
            const isHovered = hover?.index === index
            const hour = Number(point.key.split('-').at(-1))
            const showHourLabel = granularity === 'hour' && Number.isFinite(hour) && (hour === 8 || hour === 12 || hour === 16 || hour === 20)
            const showLabel = showHourLabel || safePoints.length <= 8 || index === 0 || index === safePoints.length - 1 || index === Math.floor((safePoints.length - 1) / 2) || isPeak
            return (
              <g key={point.key}>
                <circle cx={x} cy={y} r="14" fill="transparent" />
                <circle cx={x} cy={y} r={isHovered ? 7 : isPeak ? 6 : 4} className="lead-evolution-dot" style={{ stroke: activeSeries.color }} />
                {isPeak ? <text x={x} y={Math.max(13, y - 12)} className="lead-evolution-peak" style={{ fill: activeSeries.color }}>pic {fmtCompact(point[activeKey])}</text> : null}
                {showLabel ? <text x={x} y={height - 13} className="lead-evolution-axis" textAnchor={index === 0 ? 'start' : index === safePoints.length - 1 ? 'end' : 'middle'}>{point.label}</text> : null}
              </g>
            )
          })}
        </svg>
        {activeHover && hover ? (
          <div
            className="lead-evolution-tooltip"
            style={{
              left: hover.cursorX > width * 0.58 ? 'auto' : `${Math.min(58, Math.max(2, (hover.cursorX / width) * 100))}%`,
              right: hover.cursorX > width * 0.58 ? `${Math.min(58, Math.max(2, ((width - hover.cursorX) / width) * 100))}%` : 'auto',
              top: `${Math.min(64, Math.max(5, (hover.cursorY / height) * 100))}%`,
              transform: hover.cursorY > height * 0.62 ? 'translateY(-100%)' : 'translateY(10px)',
            }}
          >
            <small>{activeHover.label}</small>
            <strong style={{ color: activeSeries.color }}>{fmtCompact(activeHover[activeKey])} {activeSeries.label}</strong>
            <div className="lead-evolution-tooltip-level"><span>niveau souris</span><b style={{ color: activeSeries.color }}>{fmtCompact(hover.cursorValue)}</b></div>
            <em>{fmtCompact(activeHover.leads)} leads · {fmtCompact(activeHover.rdv)} RDV · {fmtCompact(activeHover.signed)} ventes</em>
          </div>
        ) : null}
      </div>
      <div className="lead-evolution-footer">
        <div><small>Total période</small><strong>{fmtCompact(total)}</strong></div>
        <div><small>Pic</small><strong>{fmtCompact(peak?.[activeKey] ?? 0)}</strong></div>
        <div><small>Tendance</small><strong className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? 'Hausse' : 'Baisse'}</strong></div>
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
    return hydrateMissingEvolutionTotals([{ key: 'empty', date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }], totals)
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
    return hydrateMissingEvolutionTotals([{ key: 'empty', date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }], totals)
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

const PIE_COLORS = ['#D4AF37', '#3DA86A', '#B87333', '#6B7C8C', '#B7410E', '#7C6A46']

type LeadSegment = { label: string; value: number }

function LeadPieAnalysis({ segments, totalFallback = 0, leads }: { segments?: LeadSegment[]; totalFallback?: number; leads?: LeadResponse[] }) {
  const resolvedSegments = segments ?? leadStatusSegments(leads ?? [])
  const total = resolvedSegments.reduce((sum, segment) => sum + segment.value, 0) || totalFallback
  const visibleSegments = resolvedSegments.length > 0 ? resolvedSegments : [{ label: 'Données en cours', value: totalFallback }]
  const gradient = total
    ? visibleSegments.reduce<{ parts: string[]; cursor: number }>((acc, segment, index) => {
        const start = acc.cursor
        const end = start + (segment.value / total) * 360
        acc.parts.push(`${PIE_COLORS[index % PIE_COLORS.length]} ${start}deg ${end}deg`)
        acc.cursor = end
        return acc
      }, { parts: [], cursor: 0 }).parts.join(', ')
    : 'var(--color-line-soft) 0deg 360deg'

  return (
    <div className="overview-air-card overview-air-pie">
      <CardHead title="Répartition des leads" icon="target" />
      <div className="overview-pie-body">
        <div className="overview-pie" style={{ background: `conic-gradient(${gradient})` }}>
          <div>
            <strong>{fmtCompact(total)}</strong>
            <span>leads</span>
          </div>
        </div>
        <div className="overview-pie-legend">
          {visibleSegments.length === 0 ? (
            <span className="text-xs text-faint">Aucune donnée lead.</span>
          ) : visibleSegments.slice(0, 5).map((segment, index) => (
            <div key={`${segment.label}-${index}`}>
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
  } else if (period.mode === 'custom') {
    from = parseDateInput(period.customFrom)
    to = endOfDay(parseDateInput(period.customTo))
    if (from > to) [from, to] = [startOfDay(to), endOfDay(from)]
  }

  const days = Math.max(1, Math.round((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000) + 1)
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
  const contactedLeads = funnelContactedLeads(totals)
  const treatedLeads = funnelTreatedLeads(totals)
  const responseRate = pct(totals.answered, contactedLeads)
  const treatedConversionRate = pct(totals.rdv, treatedLeads)
  return (
    <div className="flow-map col-span-12 mt-4 rounded-2xl border border-line-soft bg-white/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="eyebrow">Flux leads CRM</div>
          <div className="text-sm font-extrabold">Lecture minimaliste des leads traités jusqu’au RDV</div>
        </div>
        <div className="flow-pill flow-pill-success rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-700">
          {totals.rdv} RDV · {treatedConversionRate}% conv.
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr_auto_1.35fr_auto_1fr] gap-2 items-stretch">
        <MiniFlowStep title="Traités" value={treatedLeads} sub="leads" color="#6B7C8C" />
        <MiniArrow />
        <MiniFlowStep title="Appels" value={totals.calls} sub={`${callsPerLead(totals.calls, treatedLeads)} / lead traité`} color="#D4AF37" />
        <MiniArrow />
        <div className="flow-response rounded-xl border border-line-soft bg-white/70 p-3">
          <div className="text-[10px] font-black uppercase text-faint">A répondu ?</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flow-response-yes rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-800">
              <div className="text-[10px] font-bold">Oui</div>
              <div className="text-lg font-black">{totals.answered}</div>
              <div className="text-[10px]">{responseRate}% leads appelés</div>
            </div>
            <div className="flow-response-no rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
              <div className="text-[10px] font-bold">Non</div>
              <div className="text-lg font-black">{totals.noAnswer}</div>
              <div className="text-[10px]">{totals.relances} relances</div>
            </div>
          </div>
        </div>
        <MiniArrow />
        <div className="grid grid-cols-2 gap-2">
          <MiniFlowStep title="Qualifiés" value={totals.qualified} sub={`${totals.qualificationRate}% réponses`} color="#D4AF37" />
          <MiniFlowStep title="RDV" value={totals.rdv} sub={`${treatedConversionRate}% leads traités`} color="#3DA86A" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
        <span className="flow-pill rounded-full bg-white/70 px-2 py-1 border border-line-soft">Pas qualifiés : <b>{totals.notQualified}</b> · {totals.notQualifiedRate}% réponses</span>
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

function isoMonthKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  return iso.slice(0, 7)
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

function rdvRevenueSeries(rdvs: RdvResponse[]): ActivityPoint[] {
  const months = lastNMonths(8)
  return months.map((m) => ({
    label: monthLabel(m),
    value: rdvs
      .filter((r) => r.result === 'signe' && isoMonthKey(r.signatureAt ?? r.scheduledAt) === m)
      .reduce((sum, r) => sum + (parseFloat(r.montantTotal ?? '0') || 0), 0),
  }))
}

function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (n - 1 - i))
    return d.toISOString().slice(0, 10)
  })
}

function lastNMonths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (n - 1 - i), 1)
    return d.toISOString().slice(0, 7)
  })
}

function monthLabel(month: string): string {
  const d = new Date(`${month}-01T12:00:00`)
  return d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

// ===== Atoms =====

function chartPoints(values: number[], width = 300, height = 150): string {
  const max = Math.max(1, ...values)
  const step = values.length <= 1 ? width : width / (values.length - 1)
  return values.map((v, i) => `${Math.round(i * step)},${Math.round(height - (v / max) * (height - 18) - 9)}`).join(' ')
}

function RevenueEvolutionChart({ points, total }: { points: ActivityPoint[]; total: number }) {
  const color = '#3DA86A'
  const safePoints = points.length ? points : [{ label: 'Live', value: 0 }]
  const [hover, setHover] = useState<{ x: number; y: number; value: number; index: number } | null>(null)
  const width = 620
  const height = 218
  const padX = 44
  const padTop = 22
  const padBottom = 38
  const chartWidth = width - padX * 2
  const chartHeight = height - padTop - padBottom
  const max = Math.max(1, ...safePoints.map((point) => point.value))
  const peak = safePoints.reduce((best, point) => point.value > best.value ? point : best, safePoints[0])
  const first = safePoints[0]
  const last = safePoints[safePoints.length - 1]
  const delta = last.value - first.value
  const xFor = (index: number) => padX + (safePoints.length === 1 ? chartWidth / 2 : (index / (safePoints.length - 1)) * chartWidth)
  const yFor = (value: number) => padTop + chartHeight - (value / max) * chartHeight
  const path = safePoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(point.value).toFixed(1)}`).join(' ')
  const activePoint = hover ? safePoints[hover.index] : null

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.min(width - padX, Math.max(padX, ((event.clientX - rect.left) / rect.width) * width))
    const ratio = chartWidth ? (x - padX) / chartWidth : 0
    const index = safePoints.length <= 1 ? 0 : Math.min(safePoints.length - 1, Math.max(0, Math.round(ratio * (safePoints.length - 1))))
    const point = safePoints[index]
    setHover({ x: xFor(index), y: yFor(point.value), value: point.value, index })
  }

  return (
    <div className="lead-evolution revenue-evolution">
      <div className="lead-evolution-head">
        <div>
          <h3>Évolution CA</h3>
          <p>CA signé par mois · données réelles</p>
        </div>
        <span>commercial</span>
      </div>
      <div className="lead-evolution-tabs revenue-evolution-tabs" aria-label="Indicateur CA">
        <button type="button" className="active" style={{ ['--series-color' as string]: color }}>
          <small><i style={{ background: color }} />CA signé</small>
          <strong>{fmtKEur(total)}</strong>
        </button>
        <button type="button" style={{ ['--series-color' as string]: '#D4AF37' }}>
          <small><i style={{ background: '#D4AF37' }} />Pic mensuel</small>
          <strong>{fmtKEur(peak.value)}</strong>
        </button>
        <button type="button" style={{ ['--series-color' as string]: '#B87333' }}>
          <small><i style={{ background: '#B87333' }} />Tendance</small>
          <strong className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{fmtKEur(delta)}</strong>
        </button>
      </div>
      <div className="lead-evolution-svg-wrap revenue-evolution-svg-wrap">
        <div className="lead-evolution-last-card">
          <small>Dernier mois</small>
          <strong style={{ color }}>{fmtKEur(last.value)}</strong>
          <span className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{fmtKEur(delta)} vs début</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Évolution CA commercial">
          <defs>
            <linearGradient id="revenueEvolutionFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((ratio) => {
            const y = padTop + ratio * chartHeight
            const label = max * (1 - ratio)
            return (
              <g key={ratio}>
                <line x1={padX} x2={width - padX} y1={y} y2={y} className="lead-evolution-grid" />
                <text x="10" y={y + 4} className="lead-evolution-yaxis">{fmtKEur(label)}</text>
              </g>
            )
          })}
          <path d={`${path} L ${xFor(safePoints.length - 1)} ${height - padBottom} L ${xFor(0)} ${height - padBottom} Z`} fill="url(#revenueEvolutionFill)" />
          <path d={path} className="lead-evolution-line" style={{ stroke: color }} />
          {hover ? (
            <g pointerEvents="none">
              <line x1={hover.x} x2={hover.x} y1={padTop} y2={height - padBottom} className="lead-evolution-guide" style={{ stroke: color }} />
              <circle cx={hover.x} cy={hover.y} r="7" className="lead-evolution-dot" style={{ stroke: color }} />
              <text x={Math.min(width - 92, hover.x + 10)} y={Math.max(16, hover.y - 10)} className="lead-evolution-cursor-label" style={{ fill: color }}>{fmtKEur(hover.value)}</text>
            </g>
          ) : null}
          {safePoints.map((point, index) => {
            const x = xFor(index)
            const y = yFor(point.value)
            const isPeak = point.label === peak.label && peak.value > 0
            return (
              <g key={`${point.label}-${index}`}>
                <circle cx={x} cy={y} r={isPeak ? 6 : 4} className="lead-evolution-dot" style={{ stroke: color }} />
                {isPeak ? <text x={x} y={Math.max(13, y - 12)} className="lead-evolution-peak" style={{ fill: color }}>pic {fmtKEur(point.value)}</text> : null}
                <text x={x} y={height - 12} className="lead-evolution-axis" textAnchor={index === 0 ? 'start' : index === safePoints.length - 1 ? 'end' : 'middle'}>{point.label}</text>
              </g>
            )
          })}
        </svg>
        {activePoint && hover ? (
          <div className="lead-evolution-tooltip" style={{ left: hover.x > width * 0.58 ? 'auto' : `${Math.min(58, Math.max(2, (hover.x / width) * 100))}%`, right: hover.x > width * 0.58 ? `${Math.min(58, Math.max(2, ((width - hover.x) / width) * 100))}%` : 'auto', top: `${Math.min(62, Math.max(6, (hover.y / height) * 100))}%` }}>
            <small>{activePoint.label}</small>
            <strong style={{ color }}>{fmtKEur(activePoint.value)} CA</strong>
            <em>Total période : {fmtKEur(total)} · Pic : {fmtKEur(peak.value)}</em>
          </div>
        ) : null}
      </div>
      <div className="lead-evolution-footer">
        <div><small>Total période</small><strong>{fmtKEur(total)}</strong></div>
        <div><small>Pic</small><strong>{fmtKEur(peak.value)}</strong></div>
        <div><small>Tendance</small><strong className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? 'Hausse' : 'Baisse'}</strong></div>
      </div>
    </div>
  )
}

function FuturisticLineChart({ points, color, caption }: { points: ActivityPoint[]; color: string; caption: string }) {
  const values = points.map((p) => p.value)
  const linePoints = chartPoints(values, 300, 92)
  const total = values.reduce((a, b) => a + b, 0)
  const peak = Math.max(0, ...values)
  return (
    <div className="h-full flat-target">
      <div className="flex items-end justify-between border-b border-line-soft pb-3">
        <div>
          <div className="text-3xl font-extrabold leading-none">{total}</div>
          <div className="text-[11px] font-semibold text-faint mt-1">{caption}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-extrabold text-muted">{peak}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-faint">pic</div>
        </div>
      </div>
      <div className="pt-4">
        <svg viewBox="0 0 300 92" className="w-full h-[92px]" preserveAspectRatio="none">
          <line x1="0" x2="300" y1="82" y2="82" stroke="#E5E1DA" strokeWidth="1" />
          <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((p, i) => (
            <div key={`${p.label}-${i}`} className="min-w-0">
              <div className="h-1 rounded-full bg-line-soft overflow-hidden">
                <div className="h-full rounded-full bg-or" style={{ width: `${peak ? Math.max(8, (p.value / peak) * 100) : 0}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-1 text-[9px] text-faint">
                <span className="truncate uppercase tracking-[0.08em]">{p.label}</span>
                <span className="font-bold text-muted">{p.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
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
