import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useDisplayUser } from '../lib/role'
import { useCallLogs, useLeads, useRdvList, useUsers, useStartCall, useAnalyticsFunnel } from '../lib/hooks'
import { fullName, initials, type AnalyticsFunnelResponse, type CallLogResponse, type LeadResponse, type RdvResponse } from '../lib/types'

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
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h3 className="font-bold">Activité setter</h3>
              <p className="text-xs text-faint">Appels réels + classifications du portefeuille</p>
            </div>
            <PillTabs
              items={[{ id: 'today', label: "Aujourd'hui" }, { id: 'week', label: 'Semaine' }]}
              active={activityRange}
              onChange={(id) => setActivityRange(id as 'today' | 'week')}
            />
          </div>
          <div className="h-[180px] w-full">
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

        <div className="promo-card col-span-4 flex flex-col justify-between">
          <div className="promo-halo" style={{ background: '#B7410E' }} />
          <div className="relative z-10">
            <span className="eyebrow block mb-2">BOOSTER MON SCORE</span>
            <h3 className="text-lg font-bold leading-tight">Améliore ton taux de connexion</h3>
            <p className="text-xs text-muted mt-2 leading-relaxed">Découvre les meilleurs créneaux d'appel et les scripts qui convertissent le mieux selon tes données.</p>
          </div>
          <button onClick={() => navigate('/analytics')} className="btn-primary text-xs px-4 py-2.5 rounded-xl self-start mt-3 relative z-10">Voir les insights</button>
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
  const { data: rdvs = [] } = useRdvList({ commercialId: me?.id, limit: 200 })

  const stats = useMemo(() => {
    const list = rdvs ?? []
    const honored = list.filter((r) => r.status === 'honore')
    const signed = honored.filter((r) => r.result === 'signe')
    const ca = signed.reduce((sum, r) => sum + (parseFloat(r.montantTotal ?? '0') || 0), 0)
    const closing = honored.length ? Math.round((signed.length / honored.length) * 100) : 0
    const panier = signed.length ? ca / signed.length : 0
    const upcoming = list
      .filter((r) => r.status === 'planifie' && r.scheduledAt >= todayIso)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    const totalPlanifie = list.filter((r) => r.status === 'planifie').length
    const totalHonored = honored.length
    return { ca, closing, panier, signed: signed.length, upcoming, totalPlanifie, totalHonored }
  }, [rdvs, todayIso])

  return (
    <AppShell blobsKey="commercial">
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
      <main className="p-6 grid grid-cols-12 grid-rows-[auto_1fr_1fr] gap-4 flex-grow overflow-auto">
        <KpiCard title="CA SIGNÉ" value={fmtKEur(stats.ca)} valueSize={28} haloColor="#D4AF37" lineColor="#D4AF37" sparkPoints="0,20 10,18 20,14 30,16 40,8 50,10 64,4" className="col-span-3" />
        <KpiCard title="CLOSING RATE" value={`${stats.closing}%`} valueSize={28} haloColor="#3DA86A" lineColor="#3DA86A" sparkPoints="0,18 10,16 20,12 30,14 40,8 50,6 64,10" className="col-span-3" />
        <KpiCard title="PANIER MOY." value={fmtKEur(stats.panier)} valueSize={28} haloColor="#B87333" lineColor="#B87333" sparkPoints="0,16 10,12 20,14 30,8 40,12 50,6 64,10" className="col-span-3" />
        <KpiCard title="RDV HONORÉS" value={`${stats.totalHonored}/${stats.totalHonored + stats.totalPlanifie}`} valueSize={28} haloColor="#B7410E" lineColor="#B7410E" sparkPoints="0,8 10,10 20,12 30,8 40,14 50,10 64,12" className="col-span-3" />

        <div className="glass-card col-span-7 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Évolution CA (12 mois)</h3>
            <div className="text-xl font-extrabold">{fmtKEur(stats.ca)}</div>
          </div>
          <div className="h-[180px]">
            <FuturisticAreaChart values={rdvRevenueSeries(rdvs ?? [])} color="#3DA86A" />
          </div>
        </div>

        <div className="big-number-card col-span-5 flex flex-col justify-between">
          <div className="big-halo" style={{ background: '#3DA86A' }} />
          <div className="relative z-10">
            <span className="eyebrow block mb-2">CLOSING RATE</span>
            <div className="text-[56px] font-extrabold leading-none">{stats.closing}%</div>
            <p className="text-xs text-muted mt-2 leading-relaxed">{stats.totalHonored} RDV honorés, {stats.signed} signatures.</p>
          </div>
          <div className="relative z-10 grid grid-cols-3 gap-2 mt-3 text-xs">
            <div><div className="font-bold text-sm">{stats.totalPlanifie + stats.totalHonored}</div><div className="eyebrow">RDV</div></div>
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
            <PipelineRow label="Ventes" count={stats.signed} pct={pct(stats.signed, stats.totalHonored)} color="#3DA86A" />
          </div>
        </div>

        <div className="promo-card col-span-3 flex flex-col justify-between">
          <div className="promo-halo" style={{ background: '#D4AF37' }} />
          <div className="relative z-10">
            <span className="eyebrow block mb-2">PRÉPARATION RDV</span>
            <h3 className="text-base font-bold leading-tight">{stats.upcoming.length} RDV à venir</h3>
          </div>
          <button onClick={() => navigate('/rdv')} className="btn-primary text-xs px-4 py-2.5 rounded-xl self-start mt-3 relative z-10">Préparer</button>
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
  const [tab, setTab] = useState('overview')
  const [funnelDays, setFunnelDays] = useState(30)
  const [funnelSetterId, setFunnelSetterId] = useState('')
  const [funnelSector, setFunnelSector] = useState('')
  const { data: funnel, loading: funnelLoading } = useAnalyticsFunnel({
    days: funnelDays,
    setterId: funnelSetterId || undefined,
    sector: funnelSector || undefined,
  })
  const { data: leads = [] } = useLeads({ limit: 1500 })
  const { data: rdvs = [] } = useRdvList({ limit: 200 })
  const { data: calls = [] } = useCallLogs({ limit: 5000 })
  const { data: usersList = [] } = useUsers()

  const stats = useMemo(() => {
    const lList = leads ?? []
    const rList = rdvs ?? []
    const honored = rList.filter((r) => r.status === 'honore')
    const signed = honored.filter((r) => r.result === 'signe')
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
      <main className="p-8 pt-6 flex-grow overflow-auto space-y-8">
        <section className="grid grid-cols-12 gap-5">
          <SmallKpi title="CA TOTAL" value={fmtKEur(stats.caMois)} haloColor="#D4AF37" lineColor="#D4AF37" linePoints="0,16 15,12 30,14 45,8 60,10 75,4 100,6" />
          <SmallKpi title="VENTES" value={String(stats.ventes)} haloColor="#B87333" lineColor="#B87333" linePoints="0,14 15,16 30,10 45,12 60,6 75,8 100,4" />
          <SmallKpi title="CLOSING" value={`${stats.closing}%`} haloColor="#3DA86A" lineColor="#3DA86A" linePoints="0,12 15,14 30,10 45,12 60,8 75,10 100,6" />
          <SmallKpi title="LEADS" value={fmtCompact(stats.leads)} haloColor="#6B7C8C" lineColor="#6B7C8C" linePoints="0,16 15,14 30,10 45,8 60,12 75,6 100,4" />
          <SmallKpi title="PANIER MOY." value={fmtKEur(stats.panier)} haloColor="#B7410E" lineColor="#B7410E" linePoints="0,8 15,10 30,12 45,10 60,14 75,12 100,16" />
          <SmallKpi title="APPELS" value={fmtCompact(stats.appels)} haloColor="#D4AF37" lineColor="#D4AF37" linePoints="0,12 15,8 30,10 45,6 60,8 75,4 100,6" />
        </section>

        <AdminLeadFunnel
          funnel={funnel}
          loading={funnelLoading}
          users={usersList ?? []}
          days={funnelDays}
          setterId={funnelSetterId}
          sector={funnelSector}
          onDaysChange={setFunnelDays}
          onSetterChange={setFunnelSetterId}
          onSectorChange={setFunnelSector}
        />

        <section className="grid grid-cols-12 gap-6">
          <div className="glass-card col-span-8 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Évolution CA — par mode de paiement</h3>
            <PillTabs items={[{ id: 'w', label: 'Sem' }, { id: 'm', label: 'Mois' }, { id: 't', label: 'Trim' }]} active="m" onChange={() => {}} />
          </div>
          <div className="h-[200px]">
            <FuturisticBars values={monthlyLeadSeries(leads ?? [])} colors={["#D4AF37", "#B87333"]} />
          </div>
          <div className="flex items-center gap-4 mt-4 text-[11px]">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-or"></div><span>Comptant</span></div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-cuivre"></div><span>Financement</span></div>
          </div>
        </div>

        <BigNumberCard
          eyebrow="VENTES SIGNÉES"
          value={String(stats.ventes)}
          desc={`Total des RDV signés sur la période — ${fmtKEur(stats.caMois)} de CA cumulé.`}
          haloColor="#B7410E"
          spark={[30, 48, 60, 55, 75, 90, 100]}
          sparkColor="#B7410E"
          className="col-span-4"
        />
        </section>

        {funnel?.totals && <FunnelFlowMap totals={funnel.totals} />}
      </main>
    </AppShell>
  )
}

// ===== Helpers =====

function AdminLeadFunnel({
  funnel, loading, users, days, setterId, sector, onDaysChange, onSetterChange, onSectorChange,
}: {
  funnel: AnalyticsFunnelResponse | null
  loading: boolean
  users: { id: string; name: string; role: string }[]
  days: number
  setterId: string
  sector: string
  onDaysChange: (days: number) => void
  onSetterChange: (id: string) => void
  onSectorChange: (sector: string) => void
}) {
  const totals = funnel?.totals
  const setters = users.filter((u) => u.role === 'setter')
  return (
    <section className="glass-card w-full p-7 overflow-visible">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <span className="eyebrow">FUNNEL LEADS CRM</span>
          <h3 className="text-xl font-extrabold mt-1">Parcours des leads jusqu’au rendez-vous</h3>
          <p className="text-xs text-faint mt-1">Mesure les pertes, la qualité lead, les réponses setter et la conversion globale.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <select className="rounded-xl border border-line bg-white/70 px-3 py-2 font-semibold" value={days} onChange={(e) => onDaysChange(Number(e.target.value))}>
            <option value={1}>Aujourd’hui</option>
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
            <option value={365}>Cette année</option>
          </select>
          <select className="rounded-xl border border-line bg-white/70 px-3 py-2 font-semibold" value={setterId} onChange={(e) => onSetterChange(e.target.value)}>
            <option value="">Tous les setters</option>
            {setters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="rounded-xl border border-line bg-white/70 px-3 py-2 font-semibold" value={sector} onChange={(e) => onSectorChange(e.target.value)}>
            <option value="">Tous secteurs</option>
            {(funnel?.sectors ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {loading && !funnel ? (
        <div className="py-10 text-center text-faint text-sm">Chargement du funnel CRM…</div>
      ) : !funnel || !totals ? (
        <div className="py-10 text-center text-faint text-sm">Aucune donnée funnel disponible.</div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 grid grid-cols-12 gap-5">
            <FunnelTopCard label="1. Nouveaux leads" value={totals.newLeads} sub="Leads créés sur la période" color="#6B7C8C" />
            <FunnelTopCard label="2. Appels setters" value={totals.calls} sub={`${callsPerLead(totals.calls, totals.newLeads)} appels / lead`} color="#D4AF37" />
            <FunnelTopCard label="3. Conversion finale" value={totals.rdv} sub={`${totals.globalConversionRate}% des nouveaux leads`} color="#3DA86A" />
          </div>

          <div className="col-span-12 xl:col-span-7">
            <FunnelLogicTree totals={totals} />
          </div>
          <div className="col-span-12 xl:col-span-5 space-y-6">
            <FunnelBranchChart totals={totals} />
            <FunnelDailyChart data={funnel.daily} />
          </div>
          <div className="col-span-12 lg:col-span-6 glass-card !p-5 bg-white/35">
            <h4 className="font-bold mb-3">Comparaison setters</h4>
            <FunnelComparisonTable rows={funnel.setterComparison.slice(0, 5)} empty="Aucune activité setter sur la période." />
          </div>
          <div className="col-span-12 lg:col-span-6 glass-card !p-5 bg-white/35">
            <h4 className="font-bold mb-3">Comparaison commerciaux</h4>
            <FunnelComparisonTable rows={funnel.commercialComparison.slice(0, 5)} empty="Aucun RDV commercial sur la période." />
          </div>
        </div>
      )}
    </section>
  )
}

function FunnelFlowMap({ totals }: { totals: AnalyticsFunnelResponse['totals'] }) {
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
              <div className="text-[10px]">{totals.responseRate}% appels</div>
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

function FunnelTopCard({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div className="col-span-12 md:col-span-4 rounded-2xl border border-line-soft bg-white/55 p-5 min-h-[132px]">
      <div className="text-[10px] font-bold uppercase text-faint">{label}</div>
      <div className="mt-1 text-3xl font-extrabold" style={{ color }}>{fmtCompact(value)}</div>
      <div className="text-xs text-muted mt-1">{sub}</div>
    </div>
  )
}

function FunnelLogicTree({ totals }: { totals: AnalyticsFunnelResponse['totals'] }) {
  return (
    <div className="funnel-tree rounded-3xl border border-line-soft bg-white/45 p-5">
      <div className="text-center">
        <div className="eyebrow">Question centrale</div>
        <h4 className="text-lg font-extrabold">Après les appels setters, le lead a répondu ?</h4>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="funnel-branch funnel-branch-success rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="text-xs font-bold uppercase text-emerald-700">Oui, a répondu</div>
          <div className="mt-1 text-4xl font-extrabold text-emerald-700">{fmtCompact(totals.answered)}</div>
          <div className="text-sm font-bold text-emerald-800">{totals.responseRate}% des appels</div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="funnel-subcard rounded-xl bg-white/70 p-3">
              <div className="text-[10px] font-bold uppercase text-faint">Qualifiés</div>
              <div className="text-2xl font-extrabold text-or-dark">{fmtCompact(totals.qualified)}</div>
              <div className="text-[11px] text-muted">{totals.qualificationRate}% des réponses</div>
              <div className="mt-2 text-[11px] font-bold text-emerald-700">→ {fmtCompact(totals.rdv)} RDV pris</div>
            </div>
            <div className="funnel-subcard rounded-xl bg-white/70 p-3">
              <div className="text-[10px] font-bold uppercase text-faint">Pas qualifiés</div>
              <div className="text-2xl font-extrabold text-rouille">{fmtCompact(totals.notQualified)}</div>
              <div className="text-[11px] text-muted">{totals.notQualifiedRate}% des réponses</div>
              <div className="mt-2 text-[11px] font-bold text-rouille">Perte commerciale</div>
            </div>
          </div>
        </div>

        <div className="funnel-branch funnel-branch-warning rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="text-xs font-bold uppercase text-amber-700">Non, pas de réponse</div>
          <div className="mt-1 text-4xl font-extrabold text-amber-700">{fmtCompact(totals.noAnswer)}</div>
          <div className="text-sm font-bold text-amber-800">leads appelés sans réponse</div>
          <div className="funnel-subcard mt-4 rounded-xl bg-white/70 p-3">
            <div className="text-[10px] font-bold uppercase text-faint">Relances effectuées</div>
            <div className="text-2xl font-extrabold text-amber-700">{fmtCompact(totals.relances)}</div>
            <div className="text-[11px] text-muted">appels non joints, injoignables, messagerie ou rappel planifié</div>
          </div>
        </div>
      </div>

      <div className="funnel-final mt-4 rounded-2xl border border-emerald-200 bg-white/65 p-4 flex items-center justify-between">
        <div>
          <div className="eyebrow">Résultat final</div>
          <div className="font-extrabold">Nouveaux leads qui ont obtenu un rendez-vous</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-extrabold text-emerald-700">{fmtCompact(totals.rdv)}</div>
          <div className="text-xs font-bold text-emerald-700">{totals.globalConversionRate}% de conversion globale</div>
        </div>
      </div>
    </div>
  )
}

function FunnelBranchChart({ totals }: { totals: AnalyticsFunnelResponse['totals'] }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-white/45 p-4">
      <h4 className="font-bold mb-3">Répartition après appel</h4>
      <div className="space-y-3 text-xs font-semibold">
        <Goal label="A répondu" value={`${totals.answered} · ${totals.responseRate}%`} pct={totals.responseRate} color="#3DA86A" />
        <Goal label="Qualifiés" value={`${totals.qualified} · ${totals.qualificationRate}%`} pct={totals.qualificationRate} color="#D4AF37" />
        <Goal label="Pas qualifiés" value={`${totals.notQualified} · ${totals.notQualifiedRate}%`} pct={totals.notQualifiedRate} color="#B7410E" />
        <Goal label="Sans réponse / relances" value={`${totals.noAnswer} · ${totals.relances} relances`} pct={pct(totals.noAnswer, totals.calls)} color="#B87333" />
      </div>
    </div>
  )
}

function FunnelDailyChart({ data }: { data: AnalyticsFunnelResponse['daily'] }) {
  const values = data.map((d) => d.rdv)
  const max = Math.max(1, ...values)
  return (
    <div className="daily-chart-panel rounded-2xl border border-line-soft bg-white/45 p-4 h-[190px]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-bold">Vue chronologique</h4>
        <span className="eyebrow">RDV / jour</span>
      </div>
      <div className="h-[120px] flex items-end gap-1.5">
        {data.slice(-14).map((d) => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full rounded-t-lg bg-or/75" style={{ height: `${Math.max(6, (d.rdv / max) * 100)}px` }} title={`${d.label}: ${d.rdv} RDV`} />
            <span className="text-[9px] text-faint">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FunnelComparisonTable({ rows, empty }: { rows: AnalyticsFunnelResponse['setterComparison']; empty: string }) {
  if (rows.length === 0) return <div className="text-xs text-faint py-3">{empty}</div>
  return (
    <table className="w-full text-xs">
      <thead className="eyebrow text-left border-b border-line"><tr><th className="pb-2">Nom</th><th className="pb-2">Appels/RDV</th><th className="pb-2 text-right">Conv.</th></tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-line-soft last:border-0">
            <td className="py-2 font-semibold">{row.name}</td>
            <td>{row.calls ? `${row.calls} appels · ${row.rdv} RDV` : `${row.rdv} RDV`}</td>
            <td className="text-right font-extrabold text-or">{row.conversionRate}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
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

function callsPerLead(calls: number, leads: number): string {
  if (!leads) return '0'
  return (calls / leads).toFixed(calls >= leads * 10 ? 0 : 1)
}

function isClassifiedLead(lead: LeadResponse): boolean {
  return lead.status !== 'nouveau'
}

function belongsToSetter(lead: LeadResponse, setterId: string | undefined): boolean {
  if (!setterId) return true
  return lead.setterId === setterId || lead.assignedSetterIds.includes(setterId)
}

type ActivityPoint = { label: string; value: number }

function weekLogicalCallSeries(calls: CallLogResponse[], classified: LeadResponse[]): ActivityPoint[] {
  return lastNDays(7).map((day) => {
    const logged = calls.filter((c) => c.calledAt.slice(0, 10) === day).length
    const classifs = classified.filter((l) => l.updatedAt.slice(0, 10) === day).length
    return { label: dayLabel(day), value: Math.max(logged, classifs) }
  })
}

function todayLogicalCallSeries(calls: CallLogResponse[], classified: LeadResponse[]): ActivityPoint[] {
  const today = new Date().toISOString().slice(0, 10)
  const hours = Array.from({ length: 12 }, (_, i) => 8 + i)
  return hours.map((hour) => {
    const logged = calls.filter((c) => c.calledAt.slice(0, 10) === today && new Date(c.calledAt).getHours() === hour).length
    const classifs = classified.filter((l) => l.updatedAt.slice(0, 10) === today && new Date(l.updatedAt).getHours() === hour).length
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

function monthlyLeadSeries(leads: LeadResponse[]): number[] {
  const months = lastNMonths(8)
  return months.map((m) => leads.filter((l) => l.createdAt.slice(0, 7) === m).length)
}

function rdvRevenueSeries(rdvs: RdvResponse[]): number[] {
  const months = lastNMonths(8)
  return months.map((m) => rdvs
    .filter((r) => r.status === 'honore' && r.result === 'signe' && (r.signatureAt ?? r.scheduledAt).slice(0, 7) === m)
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

function chartPoints(values: number[], width = 300, height = 112): string {
  const max = Math.max(1, ...values)
  const step = values.length <= 1 ? width : width / (values.length - 1)
  return values.map((v, i) => `${Math.round(i * step)},${Math.round(height - (v / max) * (height - 18) - 9)}`).join(' ')
}

function FuturisticLineChart({ points, color, caption }: { points: ActivityPoint[]; color: string; caption: string }) {
  const values = points.map((p) => p.value)
  const linePoints = chartPoints(values)
  const total = values.reduce((a, b) => a + b, 0)
  const peak = Math.max(0, ...values)
  return (
    <div className="relative h-full rounded-2xl bg-white/35 border border-line-soft overflow-hidden p-4 flat-target">
      <div className="absolute top-4 right-4 text-right z-20">
        <div className="text-2xl font-extrabold">{total}</div>
        <div className="eyebrow">{caption} · pic {peak}</div>
      </div>
      <div className="relative z-10 h-full pt-8">
        <svg viewBox="0 0 300 112" className="w-full h-[112px]" preserveAspectRatio="none">
          {[28, 56, 84].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#E5E1DA" strokeDasharray="4 6" />)}
          <polyline points={linePoints} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {values.map((v, i) => {
            const [x, y] = linePoints.split(' ')[i].split(',').map(Number)
            return <circle key={`${i}-${v}`} cx={x} cy={y} r="3.5" fill="#fff" stroke={color} strokeWidth="2" />
          })}
        </svg>
        <div className="mt-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((p, i) => (
            <div key={`${p.label}-${i}`} className="min-w-0 text-center">
              <div className="text-[10px] font-bold text-muted">{p.value}</div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-faint truncate">{p.label}</div>
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

function FuturisticBars({ values, colors }: { values: number[]; colors: string[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="h-full rounded-2xl bg-white/35 border border-line-soft p-4 flex items-end gap-3 overflow-hidden relative">
      {values.map((v, i) => (
        <div key={i} className="relative z-10 flex-1 flex flex-col items-center gap-2">
          <div className="w-full rounded-t-xl shadow-sm" style={{ height: `${Math.max(8, (v / max) * 150)}px`, background: colors[i % colors.length], opacity: 0.72 + (i / values.length) * 0.25 }} />
          <span className="text-[10px] text-faint font-semibold">{v}</span>
        </div>
      ))}
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
      <div className="kpi-halo tr" style={{ background: haloColor, opacity: 0.45 }} />
      <div className="kpi-content">
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow">{title}</span>
          {delta && <span className={`delta-badge delta-${deltaType}`}>{delta}</span>}
        </div>
        <div className="flex items-end justify-between">
          <span className="font-bold leading-none" style={{ fontSize: valueSize }}>{value}</span>
          <svg width="64" height="28" viewBox="0 0 64 28">
            <polyline points={sparkPoints} fill="none" stroke={lineColor} strokeWidth="2" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function SmallKpi({
  title, value, delta, deltaType, haloColor, lineColor, linePoints,
}: {
  title: string
  value: string
  delta?: string
  deltaType?: DeltaType
  haloColor: string
  lineColor: string
  linePoints: string
}) {
  return (
    <div className="col-span-12 sm:col-span-6 xl:col-span-2 kpi-card min-h-[132px]">
      <div className="kpi-halo tr" style={{ background: haloColor, opacity: 0.4 }} />
      <div className="kpi-content">
        <span className="eyebrow block mb-1">{title}</span>
        <div className="flex items-end justify-between">
          <span className="text-[24px] font-bold leading-none">{value}</span>
          {delta && <span className={`delta-badge delta-${deltaType}`}>{delta}</span>}
        </div>
        <svg className="mt-2" width="100%" height="20" viewBox="0 0 100 20" preserveAspectRatio="none">
          <polyline points={linePoints} fill="none" stroke={lineColor} strokeWidth="2" />
        </svg>
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
    <div className={`big-number-card ${className} flex flex-col justify-between`}>
      <div className="big-halo" style={{ background: haloColor }} />
      <div className="relative z-10">
        <span className="eyebrow block mb-2">{eyebrow}</span>
        <div className="text-[56px] font-extrabold leading-none">{value}</div>
        <p className="text-xs text-muted mt-2 leading-relaxed">{desc}</p>
      </div>
      <div className="relative z-10 flex items-end gap-1 h-10 mt-2">
        {spark.map((h, i) => (
          <div key={i} className="rounded-t-sm w-3" style={{ height: `${h}%`, background: sparkColor, opacity: i === spark.length - 1 ? 0.95 : 1 }} />
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


