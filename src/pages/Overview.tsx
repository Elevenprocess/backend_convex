import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useDisplayUser } from '../lib/role'
import { useCallLogs, useLeads, useRdvList, useUsers, useStartCall } from '../lib/hooks'
import { fullName, initials, type CallLogResponse, type LeadResponse, type RdvResponse } from '../lib/types'

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
        <KpiCard title="APPELS PASSÉS" value={String(stats.appels)} haloColor="#D4AF37" lineColor="#D4AF37" sparkPoints="0,20 10,16 20,18 30,10 40,12 50,6 64,8" className="col-span-3" />
        <KpiCard title="CONNEXIONS" value={String(stats.connexions)} delta={`${stats.connectionRate}%`} deltaType="success" haloColor="#B87333" lineColor="#B87333" sparkPoints="0,16 10,18 20,12 30,14 40,10 50,8 64,6" className="col-span-3" />
        <KpiCard title="LEADS QUALIFIÉS" value={String(stats.qualifies)} haloColor="#3DA86A" lineColor="#3DA86A" sparkPoints="0,22 10,20 20,18 30,14 40,10 50,12 64,4" className="col-span-3" />
        <KpiCard title="RDV PRIS" value={String(stats.rdvPris)} haloColor="#6B7C8C" lineColor="#6B7C8C" sparkPoints="0,12 10,14 20,12 30,16 40,12 50,14 64,12" className="col-span-3" />

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

  const teamPerf = useMemo(() => buildTeamPerf(rdvs ?? [], usersList ?? []), [rdvs, usersList])

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
      <main className="p-6 grid grid-cols-12 grid-rows-[auto_1fr_1fr] gap-4 flex-grow overflow-auto">
        <SmallKpi title="CA TOTAL" value={fmtKEur(stats.caMois)} haloColor="#D4AF37" lineColor="#D4AF37" linePoints="0,16 15,12 30,14 45,8 60,10 75,4 100,6" />
        <SmallKpi title="VENTES" value={String(stats.ventes)} haloColor="#B87333" lineColor="#B87333" linePoints="0,14 15,16 30,10 45,12 60,6 75,8 100,4" />
        <SmallKpi title="CLOSING" value={`${stats.closing}%`} haloColor="#3DA86A" lineColor="#3DA86A" linePoints="0,12 15,14 30,10 45,12 60,8 75,10 100,6" />
        <SmallKpi title="LEADS" value={fmtCompact(stats.leads)} haloColor="#6B7C8C" lineColor="#6B7C8C" linePoints="0,16 15,14 30,10 45,8 60,12 75,6 100,4" />
        <SmallKpi title="PANIER MOY." value={fmtKEur(stats.panier)} haloColor="#B7410E" lineColor="#B7410E" linePoints="0,8 15,10 30,12 45,10 60,14 75,12 100,16" />
        <SmallKpi title="APPELS" value={fmtCompact(stats.appels)} haloColor="#D4AF37" lineColor="#D4AF37" linePoints="0,12 15,8 30,10 45,6 60,8 75,4 100,6" />

        <div className="glass-card col-span-8 p-5">
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

        <div className="glass-card col-span-7 p-5">
          <h3 className="font-bold mb-3">Performance équipe — top 4</h3>
          {teamPerf.length === 0 ? (
            <div className="text-xs text-faint py-4">Pas de RDV honorés pour calculer la perf équipe.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left eyebrow border-b border-line">
                <tr>
                  <th className="pb-2">MEMBRE</th>
                  <th className="pb-2">RÔLE</th>
                  <th className="pb-2">RDV/VENTES</th>
                  <th className="pb-2">CLOSING</th>
                  <th className="pb-2 text-right">CA</th>
                </tr>
              </thead>
              <tbody>
                {teamPerf.slice(0, 4).map((p) => (
                  <TeamRow
                    key={p.id}
                    initials={p.initials}
                    name={p.name}
                    role="commercial"
                    stat={`${p.honored} / ${p.signed}`}
                    closing={`${p.closing}%`}
                    closingClass={p.closing >= 35 ? 'text-success' : ''}
                    ca={fmtKEur(p.ca)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="promo-card col-span-5 flex flex-col justify-between">
          <div className="promo-halo" style={{ background: '#B87333' }} />
          <div className="relative z-10">
            <span className="eyebrow block mb-2">RAPPEL</span>
            <h3 className="text-base font-bold leading-tight">Données live — backend connecté</h3>
            <p className="text-xs text-muted mt-2 leading-relaxed">
              {stats.leads} leads en base, {stats.classified} classifiés, {stats.appels} appels logiques. Un lead classifié compte comme un appel passé.
            </p>
          </div>
        </div>
      </main>
    </AppShell>
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

type TeamPerf = {
  id: string
  name: string
  initials: string
  honored: number
  signed: number
  closing: number
  ca: number
}

function buildTeamPerf(rdvs: RdvResponse[], users: { id: string; name: string; role: string }[]): TeamPerf[] {
  const userMap = new Map<string, { name: string }>()
  for (const u of users) userMap.set(u.id, u)
  const grouped = new Map<string, TeamPerf>()
  for (const r of rdvs) {
    if (r.status !== 'honore') continue
    if (!r.commercialId) continue
    const u = userMap.get(r.commercialId)
    if (!u) continue
    let p = grouped.get(r.commercialId)
    if (!p) {
      const parts = u.name.split(' ').filter(Boolean)
      const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
      p = { id: r.commercialId, name: u.name, initials: inits, honored: 0, signed: 0, closing: 0, ca: 0 }
      grouped.set(r.commercialId, p)
    }
    p.honored += 1
    if (r.result === 'signe') {
      p.signed += 1
      p.ca += parseFloat(r.montantTotal ?? '0') || 0
    }
  }
  for (const p of grouped.values()) {
    p.closing = p.honored ? Math.round((p.signed / p.honored) * 100) : 0
  }
  return [...grouped.values()].sort((a, b) => b.ca - a.ca)
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
    <div className="relative h-full rounded-2xl bg-white/35 border border-line-soft overflow-hidden p-4">
      <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle at 75% 20%, ${color}55, transparent 38%)` }} />
      <svg viewBox="0 0 300 150" className="relative z-10 w-full h-full" preserveAspectRatio="none">
        <defs><linearGradient id={`line-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1"><stop stopColor={color} stopOpacity="0.35"/><stop stopColor={color} stopOpacity="0"/></linearGradient></defs>
        {[30, 60, 90, 120].map((y) => <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#E5E1DA" strokeDasharray="4 6" />)}
        <polygon points={`0,150 ${points} 300,150`} fill={`url(#line-${color.replace('#', '')})`} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute top-4 right-4 text-right z-20">
        <div className="text-2xl font-extrabold">{last}</div>
        <div className="eyebrow">Aujourd'hui · {total} / 7j</div>
      </div>
    </div>
  )
}

function FuturisticAreaChart({ values, color }: { values: number[]; color: string }) {
  const points = chartPoints(values)
  return (
    <div className="relative h-full rounded-2xl bg-white/35 border border-line-soft overflow-hidden p-4">
      <div className="absolute inset-0 opacity-50" style={{ background: `linear-gradient(135deg, ${color}22, transparent 55%)` }} />
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
      <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle at 15% 15%, ${colors[0]}55, transparent 35%)` }} />
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
    <div className="kpi-card col-span-2">
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

function TeamRow({ initials, name, role, stat, closing, closingClass = '', ca }: {
  initials: string
  name: string
  role: 'setter' | 'commercial'
  stat: string
  closing: string
  closingClass?: string
  ca: string
}) {
  const isComm = role === 'commercial'
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-2">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${isComm ? 'bg-or-tint' : 'bg-cuivre-tint'}`}>{initials}</div>
          <span className="font-semibold">{name}</span>
        </div>
      </td>
      <td>
        <span className={`status-badge ${isComm ? 'bg-info-tint text-info' : 'bg-cuivre-tint text-cuivre'}`}>{isComm ? 'Comm.' : 'Setter'}</span>
      </td>
      <td>{stat}</td>
      <td className={`font-bold ${closingClass}`}>{closing}</td>
      <td className={`text-right font-bold ${ca === '0€' ? 'text-faint' : 'text-or'}`}>{ca}</td>
    </tr>
  )
}

