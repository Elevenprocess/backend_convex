import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useDisplayUser } from '../lib/role'
import { useCallLogs, useLeads, useRdvList, useUsers, useStartCall, useAnalyticsFunnel, useAnalyticsSummary } from '../lib/hooks'
import { STATUS_LABEL, fullName, initials, type AnalyticsFunnelResponse, type CallLogResponse, type LeadResponse, type LeadStatus, type RdvResponse } from '../lib/types'

const ALL_TIME_FROM_ISO = '2020-01-01T00:00:00.000Z'

type FunnelPeriodMode = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom'
type FunnelPeriodState = { mode: FunnelPeriodMode; customFrom: string; customTo: string }
type FunnelPeriodRange = { from: string; to: string; label: string; days: number }

const funnelTodayInput = toDateInputValue(new Date())
const DEFAULT_FUNNEL_PERIOD: FunnelPeriodState = { mode: 'this_month', customFrom: funnelTodayInput, customTo: funnelTodayInput }
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
  const { data: leads = [] } = useLeads({ limit: 1500 })
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
      <main className="p-6 grid grid-cols-12 grid-rows-[auto_1fr_1fr] gap-4 flex-grow overflow-auto">
        {/* KPI row — appels/connexions réels + classifications converties en appels logiques */}
        <KpiCard title="APPELS PASSÉS" value={String(stats.appels)} haloColor="#D4AF37" lineColor="#D4AF37" sparkPoints="0,20 10,16 20,18 30,10 40,12 50,6 64,8" className="col-span-3" />
        <KpiCard title="CONNEXIONS" value={String(stats.connexions)} delta={`${stats.connectionRate}%`} deltaType="success" haloColor="#B87333" lineColor="#B87333" sparkPoints="0,16 10,18 20,12 30,14 40,10 50,8 64,6" className="col-span-3" />
        <KpiCard title="LEADS QUALIFIÉS" value={String(stats.qualifies)} haloColor="#3DA86A" lineColor="#3DA86A" sparkPoints="0,22 10,20 20,18 30,14 40,10 50,12 64,4" className="col-span-3" />
        <KpiCard title="RDV PRIS" value={String(stats.rdvPris)} haloColor="#6B7C8C" lineColor="#6B7C8C" sparkPoints="0,12 10,14 20,12 30,16 40,12 50,14 64,12" className="col-span-3" />

        <div className="glass-card col-span-8 p-5">
          <div className="flex items-start justify-between mb-3 gap-3">
            <div>
              <span className="eyebrow block mb-1">ACTIVITÉ</span>
              <h3 className="text-lg font-extrabold leading-none">Appels setter</h3>
            </div>
            <PillTabs
              items={[{ id: 'today', label: "Aujourd'hui" }, { id: 'week', label: 'Semaine' }]}
              active={activityRange}
              onChange={(id) => setActivityRange(id as 'today' | 'week')}
            />
          </div>
          <div className="h-[184px] w-full">
            <FuturisticLineChart
              points={activityRange === 'today' ? stats.activityToday : stats.activityWeek}
              color="#D4AF37"
              caption={activityRange === 'today' ? "Aujourd'hui" : '7 derniers jours'}
            />
          </div>
        </div>

        <BigNumberCard
          eyebrow="TAUX QUALIFICATION"
          value={`${stats.qualifRate}%`}
          desc={`${stats.qualifies} leads qualifiés sur ${stats.total} dans ton portefeuille.`}
          haloColor="#D4AF37"
          spark={[30, 55, 42, 68, 50, 80, 95]}
          sparkColor="#D4AF37"
          className="col-span-4"
        />

        <div className="glass-card col-span-4 p-5">
          <h3 className="font-bold mb-4">Mes objectifs</h3>
          <div className="space-y-4">
            {/* TODO Phase B: brancher sur weekly_goals */}
            <Goal label="RDV hebdo" value={`${stats.rdvPris} / 40`} pct={Math.min(100, (stats.rdvPris / 40) * 100)} color="#D4AF37" />
            <Goal label="Qualifiés" value={`${stats.qualifies} / 30`} pct={Math.min(100, (stats.qualifies / 30) * 100)} color="#B87333" />
            <Goal label="Total leads" value={`${stats.total} / 200`} pct={Math.min(100, (stats.total / 200) * 100)} color="#B7410E" />
          </div>
        </div>

        <div className="promo-card col-span-4 flex flex-col justify-between border-l-4 border-rouille">
          <div>
            <span className="eyebrow block mb-2">BOOSTER MON SCORE</span>
            <h3 className="text-lg font-bold leading-tight">Améliore ton taux de connexion</h3>
            <p className="text-xs text-muted mt-2 leading-relaxed">Découvre les meilleurs créneaux d'appel et les scripts qui convertissent le mieux selon tes données.</p>
          </div>
          <button onClick={() => navigate('/analytics')} className="btn-primary text-xs px-4 py-2.5 rounded-xl self-start mt-3">Voir les insights</button>
        </div>

        <div className="glass-card col-span-4 p-5 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h3 className="font-bold">À rappeler</h3>
            <span className="text-xs text-faint font-semibold">{callbacks.length}</span>
          </div>
          <PillTabs
            items={[{ id: 'late', label: 'Oubliés' }, { id: 'today', label: "Aujourd'hui" }, { id: 'tomorrow', label: 'Demain' }]}
            active={callbackTab}
            onChange={(id) => setCallbackTab(id as 'late' | 'today' | 'tomorrow')}
          />
          <div className="space-y-2.5 mt-3 overflow-y-auto pr-1 max-h-[210px]">
            {callbacks.length === 0 ? (
              <div className="text-xs text-faint">Aucun appel à faire sur ce créneau.</div>
            ) : callbacks.map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-cuivre-tint flex items-center justify-center text-[10px] font-bold">{initials(l)}</div>
                <div className="flex-grow min-w-0">
                  <div className="text-xs font-semibold truncate">{fullName(l)}</div>
                  <div className="text-[10px] text-faint">
                    {formatCallbackTime(l.nextCallbackAt)} · {l.phone ?? 'sans téléphone'}
                  </div>
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
                  className="text-[10px] font-bold text-or border border-or px-2.5 py-1 rounded-lg disabled:opacity-40"
                >Appeler</button>
              </div>
            ))}
          </div>
        </div>
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
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const allTimeTo = useMemo(() => new Date().toISOString(), [])
  const { data: rdvs = [] } = useRdvList({ commercialId: me?.id, limit: 200 })
  const { data: commercialSummary } = useAnalyticsSummary({ from: ALL_TIME_FROM_ISO, to: allTimeTo })

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
      <main className="p-8 pt-6 grid grid-cols-12 grid-rows-[auto_1fr_1fr] gap-5 flex-grow overflow-auto">
        <KpiCard title="CA SIGNÉ" value={fmtKEur(stats.ca)} valueSize={28} haloColor="#D4AF37" lineColor="#D4AF37" sparkPoints="0,20 10,18 20,14 30,16 40,8 50,10 64,4" className="col-span-3" />
        <KpiCard title="CLOSING RATE" value={`${stats.closing}%`} valueSize={28} haloColor="#3DA86A" lineColor="#3DA86A" sparkPoints="0,18 10,16 20,12 30,14 40,8 50,6 64,10" className="col-span-3" />
        <KpiCard title="PANIER MOY." value={fmtKEur(stats.panier)} valueSize={28} haloColor="#B87333" lineColor="#B87333" sparkPoints="0,16 10,12 20,14 30,8 40,12 50,6 64,10" className="col-span-3" />
        <KpiCard title="ACTIVITÉ RDV" value={String(stats.totalRdv)} valueSize={28} haloColor="#B7410E" lineColor="#B7410E" sparkPoints="0,8 10,10 20,12 30,8 40,14 50,10 64,12" className="col-span-3" />

        <div className="glass-card col-span-7 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Évolution CA (12 mois)</h3>
            <div className="text-xl font-extrabold">{fmtKEur(stats.ca)}</div>
          </div>
          <div className="h-[180px]">
            <FuturisticAreaChart values={rdvRevenueSeries(rdvs ?? [])} color="#3DA86A" />
          </div>
        </div>

        <div className="big-number-card col-span-5 flex flex-col justify-between border-l-4 border-success">
          <div>
            <span className="eyebrow block mb-2">CLOSING RATE</span>
            <div className="text-[56px] font-extrabold leading-none">{stats.closing}%</div>
            <p className="text-xs text-muted mt-2 leading-relaxed">{stats.signed} ventes, {stats.lost} perdus, {stats.totalRdv} RDV suivis.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
            <div><div className="font-bold text-sm">{stats.totalRdv}</div><div className="eyebrow">RDV</div></div>
            <div><div className="font-bold text-sm">{stats.totalHonored}</div><div className="eyebrow">HONORÉS</div></div>
            <div><div className="font-bold text-sm text-success">{stats.signed}</div><div className="eyebrow">VENTES</div></div>
          </div>
        </div>

        <div className="glass-card col-span-5 p-5">
          <h3 className="font-bold mb-3">Pipeline</h3>
          <div className="space-y-2.5">
            {/* TODO Phase B: pipeline complet leads → rdv → signatures, requiert agrégation cross-resources */}
            <PipelineRow label="RDV planifiés" count={stats.totalPlanifie} pct={100} color="#D4AF37" />
            <PipelineRow label="Honorés" count={stats.totalHonored} pct={pct(stats.totalHonored, stats.totalPlanifie)} color="#B87333" />
            <PipelineRow label="Ventes" count={stats.signed} pct={pct(stats.signed, Math.max(stats.signed + stats.lost, stats.totalHonored))} color="#3DA86A" />
          </div>
        </div>

        <div className="promo-card col-span-3 flex flex-col justify-between border-l-4 border-or">
          <div>
            <span className="eyebrow block mb-2">PRÉPARATION RDV</span>
            <h3 className="text-base font-bold leading-tight">{stats.upcoming.length} RDV à venir</h3>
          </div>
          <button onClick={() => navigate('/rdv')} className="btn-primary text-xs px-4 py-2.5 rounded-xl self-start mt-3">Préparer</button>
        </div>

        <div className="glass-card col-span-4 p-5">
          <h3 className="font-bold mb-3">Mes RDV à venir</h3>
          <div className="space-y-2.5">
            {stats.upcoming.length === 0 ? (
              <div className="text-xs text-faint">Aucun RDV à venir.</div>
            ) : stats.upcoming.slice(0, 4).map((r, i) => (
              <RdvRow
                key={r.id}
                color={['#D4AF37', '#B87333', '#B7410E', '#3DA86A'][i % 4]}
                time={`${shortDateTime(r.scheduledAt)}`}
                sub={r.locationType === 'visio' ? 'Visio' : r.locationType === 'agence' ? 'Agence' : 'Domicile'}
              />
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

// ----- F4 Admin -----
function OverviewAdmin() {
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const [tab, setTab] = useState('overview')
  const [funnelPeriod] = useState<FunnelPeriodState>(DEFAULT_FUNNEL_PERIOD)
  const funnelRange = buildFunnelPeriodRange(funnelPeriod)
  const { data: funnel } = useAnalyticsFunnel({
    from: funnelRange.from,
    to: funnelRange.to,
  })
  const { data: leads = [] } = useLeads({ limit: 1500 })
  const { data: rdvs = [] } = useRdvList({ limit: 200 })
  const { data: calls = [] } = useCallLogs({ limit: 5000 })
  const { data: usersList = [] } = useUsers()

  const stats = useMemo(() => {
    const lList = leads ?? []
    const rList = rdvs ?? []
    const honored = rList.filter((r) => r.status === 'honore')
    const signed = rList.filter((r) => r.result === 'signe')
    const classified = lList.filter(isClassifiedLead)
    const logicalCalls = Math.max((calls ?? []).length, classified.length)
    const qualified = classified.filter((l) => l.status === 'qualifie' || l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length
    const ca = signed.reduce((sum, r) => sum + (parseFloat(r.montantTotal ?? '0') || 0), 0)
    const closing = honored.length ? Math.round((signed.length / honored.length) * 100) : 0
    const team = (usersList ?? []).filter((u) => u.active)
    return {
      caMois: ca,
      ventes: signed.length,
      closing,
      leads: lList.length,
      appels: logicalCalls,
      classified: classified.length,
      qualified,
      qualifRate: ratePct(logicalCalls, qualified),
      panier: signed.length ? ca / signed.length : 0,
      teamActive: team.length,
      teamTotal: (usersList ?? []).length,
    }
  }, [leads, rdvs, calls, usersList])

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
            <div className="shot-eyebrow">ECOI SaaS</div>
            <h1>Vue d’ensemble</h1>
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
        </section>

        <section className="overview-air-grid">
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
          <AirKpi icon="target" label="Closing" value={`${stats.closing}%`} sub={`${rdvs?.length ?? 0} RDV suivis`} />
          <AirKpi icon="phone" label="Appels" value={fmtCompact(stats.appels)} sub={`${fmtCompact(stats.classified)} leads traités`} />
          <AirKpi icon="users" label="Leads" value={fmtCompact(stats.leads)} sub={`${fmtCompact(stats.qualified)} qualifiés`} />

          <div className="overview-air-card overview-air-chart">
            <CardHead title="Évolution des leads" icon="chart" />
            <MiniBarChart points={dailyLeadSeries(leads ?? [])} />
          </div>

          <LeadPieAnalysis leads={leads ?? []} />

          <div className="overview-air-card overview-air-pipeline">
            <div className="shot-onboarding-top">
              <div>
                <span className="shot-eyebrow">Pipeline réel</span>
                <h3>Avancement CRM</h3>
              </div>
              <strong>{funnel?.totals?.globalConversionRate ?? stats.closing}%</strong>
            </div>
            <div className="overview-real-segments" style={{ ['--seg-a' as string]: `${Math.max(1, funnel?.totals?.newLeads ?? stats.leads)}`, ['--seg-b' as string]: `${Math.max(1, funnel?.totals?.qualified ?? stats.qualified)}`, ['--seg-c' as string]: `${Math.max(1, funnel?.totals?.rdv ?? 0)}` }}>
              <span />
              <span />
              <span />
            </div>
            <TaskLine icon="phone" title="Appels setters" sub={`${fmtCompact(funnel?.totals?.calls ?? stats.appels)} appels`} done={(funnel?.totals?.calls ?? stats.appels) > 0} />
            <TaskLine icon="target" title="Leads qualifiés" sub={`${fmtCompact(funnel?.totals?.qualified ?? stats.qualified)} leads`} done={(funnel?.totals?.qualified ?? stats.qualified) > 0} />
            <TaskLine icon="trophy" title="RDV obtenus" sub={`${fmtCompact(funnel?.totals?.rdv ?? 0)} RDV`} done={(funnel?.totals?.rdv ?? 0) > 0} />
          </div>

          <div className="overview-air-card overview-air-funnel">
            <div className="shot-calendar-head">
              <span>{formatShortDate(new Date())}</span>
              <strong>Funnel CRM</strong>
              <button onClick={() => navigate('/analytics')}>Détails</button>
            </div>
            {funnel?.totals ? <FunnelFlowMap totals={funnel.totals} /> : <div className="py-8 text-center text-faint text-sm">Chargement du funnel CRM…</div>}
          </div>
        </section>

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

type DailyLeadPoint = { date: string; value: number }

function MiniBarChart({ points }: { points: DailyLeadPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  return (
    <div className="shot-bars">
      {points.map((point, index) => {
        const label = formatFullDayLabel(point.date)
        return (
          <div key={point.date} className="shot-bar-col">
            <span className={index === points.length - 1 ? 'active' : ''} style={{ height: `${Math.max(14, (point.value / max) * 118)}px` }} />
            <small>
              <b>{label.dayMonth}</b>
              <em>{label.year}</em>
            </small>
          </div>
        )
      })}
    </div>
  )
}

const PIE_COLORS = ['#D4AF37', '#3DA86A', '#B87333', '#6B7C8C', '#B7410E', '#7C6A46']

function LeadPieAnalysis({ leads }: { leads: LeadResponse[] }) {
  const segments = leadStatusSegments(leads)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const gradient = total
    ? segments.reduce<{ parts: string[]; cursor: number }>((acc, segment, index) => {
        const start = acc.cursor
        const end = start + (segment.value / total) * 360
        acc.parts.push(`${PIE_COLORS[index % PIE_COLORS.length]} ${start}deg ${end}deg`)
        acc.cursor = end
        return acc
      }, { parts: [], cursor: 0 }).parts.join(', ')
    : 'var(--color-line-soft) 0deg 360deg'

  return (
    <div className="overview-air-card overview-air-pie">
      <CardHead title="Analyse camembert" icon="target" />
      <div className="overview-pie-body">
        <div className="overview-pie" style={{ background: `conic-gradient(${gradient})` }}>
          <div>
            <strong>{fmtCompact(total)}</strong>
            <span>leads</span>
          </div>
        </div>
        <div className="overview-pie-legend">
          {segments.length === 0 ? (
            <span className="text-xs text-faint">Aucune donnée lead.</span>
          ) : segments.slice(0, 5).map((segment, index) => (
            <div key={segment.status}>
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
  const responseRate = pct(totals.answered, contactedLeads)
  return (
    <div className="flow-map col-span-12 mt-4 rounded-2xl border border-line-soft bg-white/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="eyebrow">Flux leads CRM</div>
          <div className="text-sm font-extrabold">Lecture minimaliste du parcours jusqu’au RDV</div>
        </div>
        <div className="flow-pill flow-pill-success rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-700">
          {totals.rdv} RDV · {totals.globalConversionRate}% conv.
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr_auto_1.35fr_auto_1fr] gap-2 items-stretch">
        <MiniFlowStep title="Nouveaux" value={totals.newLeads} sub="leads" color="#6B7C8C" />
        <MiniArrow />
        <MiniFlowStep title="Appels" value={totals.calls} sub={`${callsPerLead(totals.calls, totals.newLeads)} / lead`} color="#D4AF37" />
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
          <MiniFlowStep title="RDV" value={totals.rdv} sub={`${totals.globalConversionRate}% leads`} color="#3DA86A" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
        <span className="flow-pill rounded-full bg-white/70 px-2 py-1 border border-line-soft">Pas qualifiés : <b>{totals.notQualified}</b> · {totals.notQualifiedRate}% réponses</span>
        <span className="flow-pill rounded-full bg-white/70 px-2 py-1 border border-line-soft">Formule : RDV / nouveaux leads</span>
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

function dailyLeadSeries(leads: LeadResponse[]): DailyLeadPoint[] {
  const days = lastNDays(6)
  return days.map((date) => ({
    date,
    value: leads.filter((lead) => lead.createdAt?.slice(0, 10) === date).length,
  }))
}

function formatFullDayLabel(isoDay: string): { dayMonth: string; year: string } {
  const date = new Date(`${isoDay}T12:00:00`)
  return {
    dayMonth: date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).replace('.', ''),
    year: date.toLocaleDateString('fr-FR', { year: 'numeric' }),
  }
}

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

function rdvRevenueSeries(rdvs: RdvResponse[]): number[] {
  const months = lastNMonths(8)
  return months.map((m) => rdvs
    .filter((r) => r.result === 'signe' && isoMonthKey(r.signatureAt ?? r.scheduledAt) === m)
    .reduce((sum, r) => sum + (parseFloat(r.montantTotal ?? '0') || 0), 0))
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

// ===== Atoms =====

type DeltaType = 'success' | 'warn' | 'danger' | 'info'

function chartPoints(values: number[], width = 300, height = 150): string {
  const max = Math.max(1, ...values)
  const step = values.length <= 1 ? width : width / (values.length - 1)
  return values.map((v, i) => `${Math.round(i * step)},${Math.round(height - (v / max) * (height - 18) - 9)}`).join(' ')
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

function FuturisticAreaChart({ values, color }: { values: number[]; color: string }) {
  const points = chartPoints(values)
  return (
    <div className="relative h-full rounded-2xl bg-white/35 border border-line-soft overflow-hidden p-4">
      <svg viewBox="0 0 300 150" className="relative z-10 w-full h-full" preserveAspectRatio="none">
        <polygon points={`0,150 ${points} 300,150`} fill={color} opacity="0.18" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute top-4 right-4 z-20 text-right"><span className="eyebrow">Projection CA</span></div>
    </div>
  )
}

function KpiCard({
  title, value, valueSize = 32, delta, deltaType, haloColor, lineColor, sparkPoints, className = '',
}: {
  title: string
  value: string
  valueSize?: number
  delta?: string
  deltaType?: DeltaType
  haloColor: string
  lineColor: string
  sparkPoints: string
  className?: string
}) {
  return (
    <div className={`kpi-card ${className}`}>
      <div className="kpi-content">
        <div className="flex items-center justify-between mb-4">
          <span className="eyebrow">{title}</span>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: haloColor }} />
        </div>
        <div className="flex items-end justify-between gap-4">
          <div>
            <span className="font-black leading-none tracking-tight" style={{ fontSize: valueSize }}>{value}</span>
            {delta && <span className={`delta-badge delta-${deltaType} ml-2`}>{delta}</span>}
          </div>
          <svg width="74" height="32" viewBox="0 0 64 28" className="rounded-lg bg-cream/60 px-1">
            <polyline points={sparkPoints} fill="none" stroke={lineColor} strokeWidth="2" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function BigNumberCard({
  eyebrow, value, desc, haloColor, spark, sparkColor, className = '',
}: {
  eyebrow: string
  value: string
  desc: string
  haloColor: string
  spark: number[]
  sparkColor: string
  className?: string
}) {
  return (
    <div className={`big-number-card ${className} flex flex-col justify-between`} style={{ borderLeftColor: haloColor }}>
      <div>
        <span className="eyebrow block mb-2">{eyebrow}</span>
        <div className="text-[56px] font-black leading-none tracking-tight">{value}</div>
        <p className="text-xs text-muted mt-2 leading-relaxed">{desc}</p>
      </div>
      <div className="flex items-end gap-1 h-10 mt-2 rounded-xl bg-cream/60 p-2">
        {spark.map((h, i) => (
          <div key={i} className="rounded-t-sm w-3" style={{ height: `${h}%`, background: sparkColor, opacity: i === spark.length - 1 ? 0.95 : 0.55 }} />
        ))}
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

function Goal({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold mb-1.5">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }}></div>
      </div>
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



