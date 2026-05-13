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
      dailyCalls: dailyLogicalCallSeries(loggedCalls, classified),
    }
  }, [leads, calls, me?.id])

  return (
    <AppShell blobsKey="setter">
      <Topbar
        eyebrow="SETTER"
        title={`Bonjour, ${display.firstName}`}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'performance', label: 'Performance' },
          { id: 'activity', label: 'Activité' },
          { id: 'leads', label: 'Leads' },
        ]}
        activeTab={tab}
        onTabChange={(id) => {
          setTab(id)
          if (id === 'leads') navigate('/leads')
          if (id === 'performance' || id === 'activity') navigate('/analytics')
        }}
      />
      <main className="p-6 grid grid-cols-12 grid-rows-[auto_1fr_1fr] gap-4 flex-grow overflow-auto">
        {/* KPI row — appels/connexions réels + classifications converties en appels logiques */}
        <KpiCard title="APPELS PASSÉS" value={String(stats.appels)} className="col-span-3" />
        <KpiCard title="CONNEXIONS" value={String(stats.connexions)} delta={`${stats.connectionRate}%`} deltaType="success" className="col-span-3" />
        <KpiCard title="LEADS QUALIFIÉS" value={String(stats.qualifies)} className="col-span-3" />
        <KpiCard title="RDV PRIS" value={String(stats.rdvPris)} className="col-span-3" />

        {/* Activité de la journée — graph aggregat call_logs en Phase B */}
        <div className="glass-card col-span-8 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Activité de la journée</h3>
            <PillTabs items={[{ id: 'd', label: "Aujourd'hui" }, { id: 'w', label: 'Semaine' }]} active="d" onChange={() => {}} />
          </div>
          <div className="h-[180px] w-full">
            <FuturisticLineChart values={stats.dailyCalls} color="#D4AF37" />
          </div>
        </div>

        <BigNumberCard
          eyebrow="TAUX QUALIFICATION"
          value={`${stats.qualifRate}%`}
          desc={`${stats.qualifies} leads qualifiés sur ${stats.total} dans ton portefeuille.`}
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
        <KpiCard title="CA SIGNÉ" value={fmtKEur(stats.ca)} valueSize={28} className="col-span-3" />
        <KpiCard title="CLOSING RATE" value={`${stats.closing}%`} valueSize={28} className="col-span-3" />
        <KpiCard title="PANIER MOY." value={fmtKEur(stats.panier)} valueSize={28} className="col-span-3" />
        <KpiCard title="RDV HONORÉS" value={`${stats.totalHonored}/${stats.totalHonored + stats.totalPlanifie}`} valueSize={28} className="col-span-3" />

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
          <div>
            <span className="eyebrow block mb-2">CLOSING RATE</span>
            <div className="text-[56px] font-bold leading-none">{stats.closing}%</div>
            <p className="text-xs text-muted mt-2 leading-relaxed">{stats.totalHonored} RDV honorés, {stats.signed} signatures.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
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
    <AppShell blobsKey="admin">
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
          <SmallKpi title="CA TOTAL" value={fmtKEur(stats.caMois)} />
          <SmallKpi title="VENTES" value={String(stats.ventes)} />
          <SmallKpi title="CLOSING" value={`${stats.closing}%`} />
          <SmallKpi title="LEADS" value={fmtCompact(stats.leads)} />
          <SmallKpi title="PANIER MOY." value={fmtKEur(stats.panier)} />
          <SmallKpi title="APPELS" value={fmtCompact(stats.appels)} />
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
    <div className="col-span-12 mt-4 rounded-2xl border border-line-soft bg-white/65 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="eyebrow">Flux leads CRM</div>
          <div className="text-sm font-extrabold">Lecture minimaliste du parcours jusqu’au RDV</div>
        </div>
        <div className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-extrabold text-emerald-700">
          {totals.rdv} RDV · {totals.globalConversionRate}% conv.
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto_1fr_auto_1.35fr_auto_1fr] gap-2 items-stretch">
        <MiniFlowStep title="Nouveaux" value={totals.newLeads} sub="leads" color="#6B7C8C" />
        <MiniArrow />
        <MiniFlowStep title="Appels" value={totals.calls} sub={`${callsPerLead(totals.calls, totals.newLeads)} / lead`} color="#D4AF37" />
        <MiniArrow />
        <div className="rounded-xl border border-line-soft bg-white/70 p-3">
          <div className="text-[10px] font-black uppercase text-faint">A répondu ?</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-emerald-800">
              <div className="text-[10px] font-bold">Oui</div>
              <div className="text-lg font-black">{totals.answered}</div>
              <div className="text-[10px]">{totals.responseRate}% appels</div>
            </div>
            <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
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
        <span className="rounded-full bg-white/70 px-2 py-1 border border-line-soft">Pas qualifiés : <b>{totals.notQualified}</b> · {totals.notQualifiedRate}% réponses</span>
        <span className="rounded-full bg-white/70 px-2 py-1 border border-line-soft">Formule : RDV / nouveaux leads</span>
      </div>
    </div>
  )
}

function MiniFlowStep({ title, value, sub, color }: { title: string; value: number; sub: string; color: string }) {
  return (
    <div className="rounded-xl bg-white/70 border border-line-soft p-3 min-h-[82px]">
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
    <div className="rounded-3xl border border-line-soft bg-white/45 p-5">
      <div className="text-center">
        <div className="eyebrow">Question centrale</div>
        <h4 className="text-lg font-extrabold">Après les appels setters, le lead a répondu ?</h4>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="text-xs font-bold uppercase text-emerald-700">Oui, a répondu</div>
          <div className="mt-1 text-4xl font-extrabold text-emerald-700">{fmtCompact(totals.answered)}</div>
          <div className="text-sm font-bold text-emerald-800">{totals.responseRate}% des appels</div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/70 p-3">
              <div className="text-[10px] font-bold uppercase text-faint">Qualifiés</div>
              <div className="text-2xl font-extrabold text-or-dark">{fmtCompact(totals.qualified)}</div>
              <div className="text-[11px] text-muted">{totals.qualificationRate}% des réponses</div>
              <div className="mt-2 text-[11px] font-bold text-emerald-700">→ {fmtCompact(totals.rdv)} RDV pris</div>
            </div>
            <div className="rounded-xl bg-white/70 p-3">
              <div className="text-[10px] font-bold uppercase text-faint">Pas qualifiés</div>
              <div className="text-2xl font-extrabold text-rouille">{fmtCompact(totals.notQualified)}</div>
              <div className="text-[11px] text-muted">{totals.notQualifiedRate}% des réponses</div>
              <div className="mt-2 text-[11px] font-bold text-rouille">Perte commerciale</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="text-xs font-bold uppercase text-amber-700">Non, pas de réponse</div>
          <div className="mt-1 text-4xl font-extrabold text-amber-700">{fmtCompact(totals.noAnswer)}</div>
          <div className="text-sm font-bold text-amber-800">leads appelés sans réponse</div>
          <div className="mt-4 rounded-xl bg-white/70 p-3">
            <div className="text-[10px] font-bold uppercase text-faint">Relances effectuées</div>
            <div className="text-2xl font-extrabold text-amber-700">{fmtCompact(totals.relances)}</div>
            <div className="text-[11px] text-muted">appels non joints, injoignables, messagerie ou rappel planifié</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-emerald-200 bg-white/65 p-4 flex items-center justify-between">
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
    <div className="rounded-2xl border border-line-soft bg-white/45 p-4 h-[190px]">
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

function dailyLogicalCallSeries(calls: CallLogResponse[], classified: LeadResponse[]): number[] {
  return lastNDays(7).map((day) => {
    const logged = calls.filter((c) => c.calledAt.slice(0, 10) === day).length
    const classifs = classified.filter((l) => l.updatedAt.slice(0, 10) === day).length
    return Math.max(logged, classifs)
  })
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

function chartPoints(values: number[], width = 300, height = 150): string {
  const max = Math.max(1, ...values)
  const step = values.length <= 1 ? width : width / (values.length - 1)
  return values.map((v, i) => `${Math.round(i * step)},${Math.round(height - (v / max) * (height - 18) - 9)}`).join(' ')
}

function FuturisticLineChart({ values, color }: { values: number[]; color: string }) {
  const points = chartPoints(values)
  const last = values.at(-1) ?? 0
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <div className="relative h-full rounded-2xl bg-white/30 border border-line-soft overflow-hidden p-4">
      <svg viewBox="0 0 300 150" className="relative w-full h-full" preserveAspectRatio="none">
        {[30, 60, 90, 120].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#E5E1DA" strokeDasharray="2 6" />)}
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute top-4 right-4 text-right">
        <div className="text-2xl font-bold">{last}</div>
        <div className="eyebrow">Aujourd'hui · {total} / 7j</div>
      </div>
    </div>
  )
}

function FuturisticAreaChart({ values, color }: { values: number[]; color: string }) {
  const points = chartPoints(values)
  return (
    <div className="relative h-full rounded-2xl bg-white/30 border border-line-soft overflow-hidden p-4">
      <svg viewBox="0 0 300 150" className="relative w-full h-full" preserveAspectRatio="none">
        {[30, 60, 90, 120].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#E5E1DA" strokeDasharray="2 6" />)}
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute top-4 right-4 text-right"><span className="eyebrow">Projection CA</span></div>
    </div>
  )
}

function FuturisticBars({ values, colors }: { values: number[]; colors: string[] }) {
  const max = Math.max(1, ...values)
  return (
    <div className="h-full rounded-2xl bg-white/30 border border-line-soft p-4 flex items-end gap-3 overflow-hidden">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-2">
          <div className="w-full rounded-t-md" style={{ height: `${Math.max(8, (v / max) * 150)}px`, background: colors[i % colors.length], opacity: 0.55 }} />
          <span className="text-[10px] text-faint font-semibold">{v}</span>
        </div>
      ))}
    </div>
  )
}

function KpiCard({
  title, value, valueSize = 32, delta, deltaType, className = '',
}: {
  title: string
  value: string
  valueSize?: number
  delta?: string
  deltaType?: DeltaType
  className?: string
}) {
  return (
    <div className={`kpi-card ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">{title}</span>
        {delta && <span className={`delta-badge delta-${deltaType}`}>{delta}</span>}
      </div>
      <span className="font-bold leading-none" style={{ fontSize: valueSize }}>{value}</span>
    </div>
  )
}

function SmallKpi({
  title, value, delta, deltaType,
}: {
  title: string
  value: string
  delta?: string
  deltaType?: DeltaType
}) {
  return (
    <div className="col-span-12 sm:col-span-6 xl:col-span-2 kpi-card min-h-[108px]">
      <span className="eyebrow block mb-2">{title}</span>
      <div className="flex items-end justify-between">
        <span className="text-[26px] font-bold leading-none">{value}</span>
        {delta && <span className={`delta-badge delta-${deltaType}`}>{delta}</span>}
      </div>
    </div>
  )
}

function BigNumberCard({
  eyebrow, value, desc, className = '',
}: {
  eyebrow: string
  value: string
  desc: string
  className?: string
}) {
  return (
    <div className={`big-number-card ${className} flex flex-col justify-between`}>
      <div>
        <span className="eyebrow block mb-2">{eyebrow}</span>
        <div className="text-[56px] font-bold leading-none">{value}</div>
        <p className="text-xs text-muted mt-2 leading-relaxed">{desc}</p>
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

