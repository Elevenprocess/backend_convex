import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useAnalyticsSummary, prefetchAnalyticsSummary, useLeads, useRdvList } from '../lib/hooks'
import type { AnalyticsAdminSummary, AnalyticsCommercialPerf, AnalyticsCommercialSummary, AnalyticsSegment, AnalyticsSetterSummary } from '../lib/types'
import { DebriefAnalytics } from '../components/analytics/DebriefAnalytics'
import { MagicKpi, type KpiAccent, type DeltaTone } from '../components/kpi/MagicKpi'
import type { IconName } from '../components/Icon'
import { DEFAULT_PERIOD, buildPeriodRange, type PeriodState, type PeriodMode, type PeriodRange } from '../lib/period'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { computeSetterAverages } from '../lib/setterAverages'

type Segment = AnalyticsSegment

const EMPTY_SETTER_STATS: AnalyticsSetterSummary = {
  newLeads: 0,
  calls: 0,
  loggedCalls: 0,
  syntheticCalls: 0,
  callsPerDay: 0,
  classified: 0,
  unclassified: 0,
  answered: 0,
  connected: 0,
  relance: 0,
  notQualified: 0,
  qualified: 0,
  rdvPris: 0,
  responseRate: 0,
  rdvAfterAnswerRate: 0,
  globalRdvRate: 0,
  connectionRate: 0,
  qualificationRate: 0,
  rdvRate: 0,
  resultSegments: [],
  dailyCalls: [],
  hourlyCalls: [],
  dailyEvolution: [],
}

const EMPTY_COMMERCIAL_STATS: AnalyticsCommercialSummary = {
  total: 0,
  honored: 0,
  signed: 0,
  ca: 0,
  panier: 0,
  closing: 0,
  resultSegments: [],
  financingSegments: [],
  dailyEvolution: [],
}

const EMPTY_ADMIN_STATS: AnalyticsAdminSummary = {
  calls: 0,
  loggedCalls: 0,
  newLeads: 0,
  classified: 0,
  qualified: 0,
  unclassified: 0,
  syntheticCalls: 0,
  scheduledRdv: 0,
  rdvPris: 0,
  rdvRate: 0,
  qualificationRate: 0,
  ca: 0,
  signed: 0,
  resultSegments: [],
  hourlyCalls: [],
  dailyEvolution: [],
  setters: [],
  commercials: [],
}

export function Analytics() {
  const me = useAuth((s) => s.user)

  if (me?.role === 'admin' || me?.role === 'commercial_lead') return <AnalyticsAdmin />
  if (me?.role === 'commercial') return <AnalyticsCommercial name={me.name} />
  if (me?.role === 'delivrabilite' || me?.role === 'responsable_technique' || me?.role === 'back_office' || me?.role === 'technicien') return <AnalyticsSuivi />
  return <AnalyticsSetter name={me?.name ?? 'Setter'} />
}

function AnalyticsSuivi() {
  const { data: leadsData } = useLeads({ limit: 500 })
  const { data: rdvsData } = useRdvList({ limit: 200 })
  const leads = leadsData ?? []
  const rdvs = rdvsData ?? []
  const signedRdvs = rdvs.filter((r) => r.result === 'signe' || Boolean(r.signatureAt))
  const signedIds = new Set(signedRdvs.map((r) => r.leadId))
  const signedLeads = leads.filter((l) => l.status === 'signe' || signedIds.has(l.id))
  const ca = signedRdvs.reduce((sum, r) => sum + (Number(r.montantTotal ?? 0) || 0), 0)
  const comptant = signedRdvs.filter((r) => r.financingType === 'comptant').length
  const financement = signedRdvs.filter((r) => r.financingType && r.financingType !== 'comptant').length
  const lateLike = signedLeads.filter((l) => (l.daysSinceLastStageChange ?? 0) >= 7).length

  return (
    <AppShell flat>
      <Topbar eyebrow="ANALYSE / DÉLIVRABILITÉ" title="Performance suivi post-signature" />
      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          <BigStatCard label="DOSSIERS SIGNÉS" value={fmtInt(signedLeads.length)} sub="base Suivi" accent="green" icon="check" />
          <BigStatCard label="CA À LIVRER" value={fmtKEur(ca)} sub={fmtFullEur(ca)} accent="gold" icon="trophy" />
          <BigStatCard label="FINANCEMENTS" value={fmtInt(financement)} sub={`${comptant} comptants`} accent="info" icon="tag" />
          <BigStatCard label="ALERTES 7J" value={fmtInt(lateLike)} sub="étape sans mouvement" accent="rust" icon="clock" deltaTone="danger" />
        </div>
        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-12 xl:col-span-7">
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold">Pipeline délivrabilité</h3><span className="eyebrow">workflow réel côté UI</span></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Goal label="Devis signés" value={`${signedLeads.length} dossiers`} pct={100} color="#0E7E6B" />
              <Goal label="VT / technique" value="à piloter dans Suivi" pct={62} color="#9DC41A" />
              <Goal label="DP / CNO" value="mandat + mairie" pct={44} color="#3E9A6F" />
              <Goal label="Installation" value="pose + satisfaction" pct={28} color="#1F7857" />
            </div>
          </div>
          <div className="glass-card p-6 col-span-12 xl:col-span-5">
            <h3 className="font-bold mb-4">Répartition paiement</h3>
            <div className="space-y-4">
              <Goal label="Comptant" value={`${comptant} dossiers · acompte 40/20/20/20`} pct={percent(comptant, signedRdvs.length)} color="#0E7E6B" />
              <Goal label="Financement" value={`${financement} dossiers · sans acomptes`} pct={percent(financement, signedRdvs.length)} color="#9DC41A" />
              <Row label="Action principale" value="ouvrir /suivi" highlight />
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function useWarmAnalyticsPresetRanges() {
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const initialRange = buildPeriodRange(DEFAULT_PERIOD)
      const currentKey = `${initialRange.from}|${initialRange.to}`
      const warmRanges = getAnalyticsWarmupRanges()
      void Promise.allSettled(
        warmRanges.map((range) => {
          const force = `${range.from}|${range.to}` !== currentKey
          return prefetchAnalyticsSummary({ from: range.from, to: range.to }, { force })
        }),
      )
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])
}

// ----- F11 Setter -----
function AnalyticsSetter({ name }: { name: string }) {
  useWarmAnalyticsPresetRanges()
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAnalyticsSummary({ from: range.from, to: range.to })
  const stats = data?.setter ?? EMPTY_SETTER_STATS

  return (
    <AppShell flat>
      <Topbar eyebrow="ANALYSE / SETTER" title={`Mes performances — ${name}`} />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center justify-between gap-2 sm:gap-4 flex-shrink-0 flex-wrap">
        <div className="text-xs text-faint font-semibold">
          Moteur d'analyse backend : {range.label}.{loading && <AnalyticsInlineLoading />}{error ? ` Erreur: ${error}` : ''}
        </div>
        <DateRangePicker value={period} onChange={setPeriod} align="right" />
      </div>
      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          <BigStatCard label="NOUVEAUX PROSPECTS" value={fmtInt(stats.newLeads)} sub="Entrées du système sur la période" accent="info" icon="inbox" />
          <BigStatCard label="APPELS EFFECTUÉS" value={fmtInt(stats.calls)} delta={`${stats.callsPerDay}/j`} sub={`${stats.syntheticCalls} déduits des statuts`} accent="green" icon="phone" trend={stats.dailyCalls} />
          <BigStatCard label="PROSPECTS AYANT RÉPONDU" value={fmtInt(stats.answered)} delta={`${stats.responseRate}%`} deltaTone={stats.responseRate >= 50 ? 'success' : 'warn'} sub="Taux réponse = répondu / nouveaux prospects" accent="success" icon="message" progress={stats.responseRate} />
          <BigStatCard label="RDV PRIS" value={fmtInt(stats.rdvPris)} delta={`${stats.globalRdvRate}%`} deltaTone={stats.globalRdvRate >= 10 ? 'success' : 'warn'} sub="Taux global RDV = RDV / nouveaux prospects" accent="gold" icon="calendar" trend={stats.dailyEvolution.map((d) => d.rdv)} />
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          <div className="col-span-12 xl:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques setter" rows={setterTableRows(stats)} />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-12 xl:col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Entonnoir setter — nouveau prospect → RDV</h3>
              <span className="eyebrow">backend live</span>
            </div>
            <PipelineFlow stats={stats} />
          </div>
          <div className="glass-card p-6 col-span-12 xl:col-span-5">
            <h3 className="font-bold mb-4">Taux de conversion</h3>
            <div className="space-y-4">
              <Goal label="Taux de réponse" value={`${stats.answered} / ${Math.max(1, stats.newLeads)} · ${stats.responseRate}%`} pct={stats.responseRate} color="#1F7857" />
              <Goal label="RDV après réponse" value={`${stats.rdvPris} / ${Math.max(1, stats.answered)} · ${stats.rdvAfterAnswerRate}%`} pct={stats.rdvAfterAnswerRate} color="#3DA86A" />
              <Goal label="Taux global RDV" value={`${stats.rdvPris} / ${Math.max(1, stats.newLeads)} · ${stats.globalRdvRate}%`} pct={stats.globalRdvRate} color="#3E9A6F" />
              <Row label="Prospects en relance" value={String(stats.relance)} />
              <Row label="Pas qualifiés" value={String(stats.notQualified)} />
              <Row label="Qualifiés" value={String(stats.qualified)} highlight />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-12 xl:col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Issues d'appel</h3>
              <span className="eyebrow">répondu / relance / refus</span>
            </div>
            <PieChart segments={stats.resultSegments} center={`${stats.calls}\nappels`} />
          </div>
          <div className="glass-card p-6 col-span-12 xl:col-span-5">
            <h3 className="font-bold mb-4">Série — appels par jour</h3>
            <Heatline values={stats.dailyCalls} color="#1F7857" />
          </div>
        </div>
      </main>
    </AppShell>
  )
}

// ----- F12 Commercial -----
function AnalyticsCommercial({ name }: { name: string }) {
  useWarmAnalyticsPresetRanges()
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAnalyticsSummary({ from: range.from, to: range.to })
  const stats = data?.commercial ?? EMPTY_COMMERCIAL_STATS
  const me = useAuth((s) => s.user)

  return (
    <AppShell blobsKey="commercial">
      <Topbar eyebrow="ANALYSE / COMMERCIAL" title={`Mes performances — ${name}`} />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center justify-between gap-2 sm:gap-4 flex-shrink-0 flex-wrap">
        <div className="text-xs text-faint font-semibold">Moteur d'analyse backend sur {range.label}.{loading && <AnalyticsInlineLoading />}{error ? ` Erreur: ${error}` : ''}</div>
        <DateRangePicker value={period} onChange={setPeriod} align="right" />
      </div>
      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes signées`} sub={fmtFullEur(stats.ca)} accent="gold" icon="trophy" trend={stats.dailyEvolution.map((d) => d.ca)} />
          <BigStatCard label="TAUX DE VENTE" value={`${stats.closing}%`} sub={`${commercialOutcomeCount(stats)} résultats RDV`} accent="success" icon="target" progress={stats.closing} />
          <BigStatCard label="PANIER MOYEN" value={fmtKEur(stats.panier)} sub="sur ventes signées" accent="green" icon="tag" />
          <BigStatCard label="ACTIVITÉ RDV" value={fmtInt(stats.total)} sub={`${stats.honored} honorés confirmés`} accent="info" icon="calendar" trend={stats.dailyEvolution.map((d) => d.rdv)} />
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          <div className="col-span-12 xl:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques commercial" rows={commercialTableRows(stats)} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Camembert des résultats RDV</h3>
            <PieChart segments={stats.resultSegments} center={`${stats.closing}%\nvente`} />
          </div>
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Mode de paiement</h3>
            <PieChart segments={stats.financingSegments} center={fmtKEur(stats.ca)} />
          </div>
        </div>

        <DebriefAnalytics
          commercialId={me?.id}
          fromDate={range.from}
          toDate={range.to}
          title="Analyse débriefs — mes RDV"
        />
      </main>
    </AppShell>
  )
}

// ----- F13 Admin -----
function AnalyticsAdmin() {
  useWarmAnalyticsPresetRanges()
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAnalyticsSummary({ from: range.from, to: range.to })
  const stats = data?.admin ?? EMPTY_ADMIN_STATS
  const commercialStats = stats
  const periodDays = data?.range?.days ?? Math.max(1, range.days)
  const setterAverages = useMemo(() => computeSetterAverages(stats.setters, periodDays), [stats.setters, periodDays])
  const qualifRate = stats.classified > 0 ? Math.round((stats.qualified / stats.classified) * 100) : 0
  // Le commercial_lead partage la vue AnalyticsAdmin mais ne voit pas les
  // métriques setter / call-center (leads traités, qualifiés, CA global, tableau
  // global, camembert OLAP, performance par setter) : seuls le suivi par
  // commercial et l'analyse des débriefs lui sont utiles.
  const isCommercialLead = useAuth((s) => s.user?.role) === 'commercial_lead'

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar eyebrow="ANALYSE / ADMIN" title="Performance globale équipe" />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center justify-between gap-2 sm:gap-4 flex-shrink-0 flex-wrap">
        <div className="text-xs text-faint font-semibold">Requête unique backend /analytics/summary : {range.label}.{loading && <AnalyticsInlineLoading />}{error ? ` Erreur: ${error}` : ''}</div>
        <DateRangePicker value={period} onChange={setPeriod} align="right" />
      </div>
      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
        {!isCommercialLead && (
        <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          <BigStatCard label="PROSPECTS TRAITÉS" value={fmtInt(stats.classified)} delta={`${stats.loggedCalls} appels`} deltaTone="info" sub={`Prospects avec un vrai statut sur ${stats.loggedCalls} appels réels`} accent="info" icon="users" />
          <BigStatCard label="QUALIFIÉS" value={fmtInt(stats.qualified)} delta={`${qualifRate}%`} deltaTone="info" sub={`${qualifRate}% des prospects traités deviennent qualifiés`} accent="success" icon="target" progress={qualifRate} trend={stats.dailyEvolution.map((d) => d.rdv)} />
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes signées`} sub={fmtFullEur(stats.ca)} accent="gold" icon="trophy" trend={stats.dailyEvolution.map((d) => d.ca)} />
        </div>

        <div className="grid grid-cols-12 gap-6 items-start">
          <div className="col-span-12 md:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques global" rows={adminTableRows(stats)} />
          </div>
          <div className="col-span-12 md:col-span-5 flex flex-col gap-6">
            <div className="glass-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Camembert OLAP — issues d'appel & statuts</h3>
                <span className="eyebrow">appels réels enregistrés</span>
              </div>
              <PieChart segments={stats.resultSegments} center={`${stats.loggedCalls}\nappels réels`} />
            </div>

          </div>
        </div>

        <div className="glass-card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
            <div>
              <span className="eyebrow">MOYENNES SETTER</span>
              <h3 className="text-xl font-extrabold mt-1">Moyenne d’appels &amp; de qualifiés par setter</h3>
              <p className="text-sm text-muted mt-1">
                Calculé sur les {setterAverages.activeSetters} setter{setterAverages.activeSetters > 1 ? 's' : ''} actif{setterAverages.activeSetters > 1 ? 's' : ''}
                {setterAverages.totalSetters > setterAverages.activeSetters ? ` (sur ${setterAverages.totalSetters})` : ''} · période {range.label} · {periodDays} jour{periodDays > 1 ? 's' : ''}.
              </p>
            </div>
          </div>
          {setterAverages.activeSetters === 0 ? (
            <div className="rounded-3xl border border-line-soft bg-white/60 p-8 text-center text-muted">Aucun setter actif sur cette période.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
              <BigStatCard
                label="MOY. APPELS / SETTER"
                value={fmtAvg(setterAverages.avgCallsPerSetter)}
                delta={`~${fmtAvg(setterAverages.avgCallsPerSetterPerDay)}/j`}
                deltaTone="info"
                sub={`${fmtInt(setterAverages.totalCalls)} appels ÷ ${setterAverages.activeSetters} setter${setterAverages.activeSetters > 1 ? 's' : ''} actif${setterAverages.activeSetters > 1 ? 's' : ''}`}
                accent="green"
                icon="phone"
              />
              <BigStatCard
                label="MOY. QUALIFIÉS / SETTER"
                value={fmtAvg(setterAverages.avgQualifiedPerSetter)}
                delta={`~${fmtAvg(setterAverages.avgQualifiedPerSetterPerDay)}/j`}
                deltaTone="info"
                sub={`${fmtInt(setterAverages.totalQualified)} qualifiés ÷ ${setterAverages.activeSetters} setter${setterAverages.activeSetters > 1 ? 's' : ''} actif${setterAverages.activeSetters > 1 ? 's' : ''}`}
                accent="gold"
                icon="target"
              />
              <BigStatCard
                label="TRANSFO APPEL → QUALIF"
                value={`${fmtAvg(setterAverages.qualifiedPerCallRate)}%`}
                sub={`${fmtInt(setterAverages.totalQualified)} qualifiés pour ${fmtInt(setterAverages.totalCalls)} appels`}
                accent="success"
                icon="check"
                progress={setterAverages.qualifiedPerCallRate}
              />
            </div>
          )}
        </div>

        <div className="glass-card p-6">
          <h3 className="font-bold mb-4">Performances par setter — chiffres personnels</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead className="bg-or-tint">
                <tr className="text-left eyebrow">
                  <Th>SETTER</Th>
                  <Th>APPELS LOGIQUES</Th>
                  <Th>CLASSIFIÉS</Th>
                  <Th>JOINTS</Th>
                  <Th>QUALIFIÉS</Th>
                  <Th className="text-right">EFFICACITÉ</Th>
                </tr>
              </thead>
              <tbody>
                {stats.setters.length === 0 ? (
                  <tr><td className="px-3 py-5 text-faint" colSpan={6}>Aucun setter trouvé.</td></tr>
                ) : stats.setters.map((s, i) => (
                  <SetterRow key={s.id} initials={s.initials} name={s.name} appels={s.calls} cnx={s.connected} qual={s.qualified} classified={s.classified} eff={`${s.efficiency}%`} effClass={s.efficiency >= 70 ? 'text-success' : s.efficiency >= 45 ? 'text-cuivre' : 'text-rouille'} star={i === 0} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        <CommercialTrackingDashboard commercials={commercialStats.commercials} totalCa={commercialStats.ca} totalSigned={commercialStats.signed} totalHonored={commercialStats.commercials.reduce((sum, c) => sum + c.honored, 0)} loading={loading} />

        <DebriefAnalytics
          fromDate={range.from}
          toDate={range.to}
          title="Analyse débriefs — équipe complète"
        />
      </main>
    </AppShell>
  )
}

function CommercialTrackingDashboard({ commercials, totalCa, totalSigned, totalHonored, loading = false }: { commercials: AnalyticsCommercialPerf[]; totalCa: number; totalSigned: number; totalHonored: number; loading?: boolean }) {
  const sorted = useMemo(() => [...commercials].sort((a, b) => b.ca - a.ca || b.signed - a.signed || b.closing - a.closing), [commercials])
  const leader = sorted[0]
  const totalActivities = sorted.reduce((sum, c) => sum + (c.total ?? c.honored), 0)
  const totalPlanned = sorted.reduce((sum, c) => sum + (c.planned ?? 0), 0)
  const averageClosing = sorted.length ? Math.round(sorted.reduce((sum, c) => sum + c.closing, 0) / sorted.length) : 0
  const bestClosing = sorted.reduce<AnalyticsCommercialPerf | null>((best, c) => (!best || c.closing > best.closing ? c : best), null)
  const maxCa = Math.max(1, ...sorted.map((c) => c.ca))
  const maxClosing = Math.max(1, ...sorted.map((c) => c.closing))
  const watchList = sorted.filter((c) => c.honored > 0 && c.closing < 20).slice(0, 3)

  return (
    <section className="glass-card p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">TABLEAU DE BORD COMMERCIAUX</span>
          <h3 className="text-2xl font-extrabold mt-1">Suivi des commerciaux</h3>
          <p className="text-sm text-muted mt-1">Vue admin sur la période sélectionnée : activité GHL/RDV, ventes, taux de vente, panier moyen et CA par commercial.{loading && <AnalyticsInlineLoading />}</p>
        </div>
        <div className="rounded-2xl border border-or/15 bg-or-tint/50 px-4 py-3 text-sm">
          <div className="eyebrow mb-1">Leader CA</div>
          <div className="font-extrabold text-lg">{leader?.name ?? '—'}</div>
          <div className="text-xs text-faint">{leader ? `${fmtKEur(leader.ca)} · ${leader.signed} ventes` : 'Aucune donnée'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <CommercialMiniKpi label="Activités GHL/RDV" value={fmtInt(totalActivities)} detail="sur la période" />
        <CommercialMiniKpi label="RDV honorés" value={fmtInt(totalHonored)} detail={`${fmtInt(totalPlanned)} planifiés`} />
        <CommercialMiniKpi label="Ventes" value={fmtInt(totalSigned)} detail="devis signés" tone="success" />
        <CommercialMiniKpi label="Taux de vente moyen" value={`${averageClosing}%`} detail="moyenne équipe" tone={averageClosing >= 35 ? 'success' : averageClosing >= 20 ? 'warning' : 'danger'} />
        <CommercialMiniKpi label="CA signé" value={fmtKEur(totalCa)} detail="sur la période" tone="gold" />
        <CommercialMiniKpi label="Meilleur taux de vente" value={bestClosing ? `${bestClosing.closing}%` : '0%'} detail={bestClosing?.name ?? '—'} />
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-3xl border border-line-soft bg-white/60 p-8 text-center text-muted">Aucun commercial trouvé sur cette période.</div>
      ) : (
        <div className="grid grid-cols-12 gap-5 items-start">
          <div className="col-span-12 xl:col-span-7 space-y-3">
            {sorted.map((commercial, index) => (
              <CommercialScoreCard key={commercial.id} commercial={commercial} rank={index + 1} maxCa={maxCa} maxClosing={maxClosing} />
            ))}
          </div>
          <div className="col-span-12 xl:col-span-5 space-y-4">
            <div className="rounded-[28px] border border-line-soft bg-white/65 p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-extrabold">Points de suivi</h4>
                <span className="eyebrow">alertes douces</span>
              </div>
              <div className="space-y-3">
                {watchList.length === 0 ? (
                  <CommercialInsight title="Équipe stable" detail="Aucun commercial avec taux de vente faible sur des RDV honorés." tone="success" />
                ) : watchList.map((c) => (
                  <CommercialInsight key={c.id} title={c.name} detail={`${c.closing}% de taux de vente sur ${c.honored} RDV honorés · à accompagner.`} tone="warning" />
                ))}
                {leader && <CommercialInsight title="Meilleur CA" detail={`${leader.name} génère ${fmtKEur(leader.ca)} sur la période.`} tone="gold" />}
                {bestClosing && bestClosing.id !== leader?.id && <CommercialInsight title="Meilleur taux" detail={`${bestClosing.name} est à ${bestClosing.closing}% de taux de vente.`} />}
              </div>
            </div>

            <div className="rounded-[28px] border border-line-soft bg-white/65 p-5">
              <h4 className="font-extrabold mb-3">Tableau rapide</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-or-tint/70">
                    <tr className="text-left eyebrow">
                      <Th>COMMERCIAL</Th>
                      <Th>ACT.</Th>
                      <Th>RDV</Th>
                      <Th>VENTES</Th>
                      <Th>CLOSING</Th>
                      <Th className="text-right">CA</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((c) => (
                      <CommercialRow key={c.id} initials={c.initials} name={c.name} total={c.total} honored={c.honored} ventes={c.signed} closing={`${c.closing}%`} panier={fmtKEur(c.panier)} ca={fmtKEur(c.ca)} compact />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function CommercialMiniKpi({ label, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'gold' }) {
  const accent: KpiAccent = tone === 'success' ? 'success' : tone === 'warning' ? 'gold' : tone === 'danger' ? 'rust' : tone === 'gold' ? 'gold' : 'info'
  return <MagicKpi label={label} value={value} sub={detail} accent={accent} size="sm" />
}

function CommercialScoreCard({ commercial, rank, maxCa, maxClosing }: { commercial: AnalyticsCommercialPerf; rank: number; maxCa: number; maxClosing: number }) {
  const caPct = Math.min(100, Math.round((commercial.ca / maxCa) * 100))
  const closingPct = Math.min(100, Math.round((commercial.closing / maxClosing) * 100))
  const tone = commercial.closing >= 35 ? 'border-success/20 bg-success/5' : commercial.closing >= 20 ? 'border-or/20 bg-or-tint/35' : 'border-rouille/15 bg-rouille/5'
  return (
    <div className={`rounded-[28px] border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-white/80 border border-line-soft flex items-center justify-center text-xs font-extrabold text-or-dark">#{rank}</div>
          <div className="w-10 h-10 rounded-full bg-or-tint flex items-center justify-center text-xs font-bold flex-shrink-0">{commercial.initials}</div>
          <div className="min-w-0">
            <div className="font-extrabold truncate">{commercial.name}</div>
            <div className="text-xs text-faint">{commercial.total ?? commercial.honored} activités · {commercial.honored} honorés · {commercial.signed} ventes</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold text-or-dark">{fmtKEur(commercial.ca)}</div>
          <div className="text-xs text-faint">panier {fmtKEur(commercial.panier)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs font-semibold">
        <ProgressLine label="Contribution CA" value={`${caPct}%`} pct={caPct} color="bg-or" />
        <ProgressLine label="Taux de vente" value={`${commercial.closing}%`} pct={closingPct} color={commercial.closing >= 35 ? 'bg-success' : commercial.closing >= 20 ? 'bg-cuivre' : 'bg-rouille'} />
      </div>
    </div>
  )
}

function ProgressLine({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between gap-2 mb-1 text-faint"><span>{label}</span><span className="text-text">{value}</span></div>
      <div className="h-2 rounded-full bg-white/80 overflow-hidden border border-line-soft">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CommercialInsight({ title, detail, tone = 'neutral' }: { title: string; detail: string; tone?: 'neutral' | 'success' | 'warning' | 'gold' }) {
  const dot = tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-cuivre' : tone === 'gold' ? 'bg-or' : 'bg-muted'
  return (
    <div className="flex gap-3 rounded-2xl bg-white/70 border border-line-soft p-3">
      <span className={`mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`} />
      <div>
        <div className="font-bold text-sm">{title}</div>
        <div className="text-xs text-muted leading-relaxed">{detail}</div>
      </div>
    </div>
  )
}

function pct(num: number, denom: number): number {
  if (denom <= 0) return 0
  return Math.min(100, Math.round((num / denom) * 100))
}

function fmtInt(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString('fr-FR')
}

function fmtAvg(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function fmtKEur(val: number | null | undefined): string {
  const v = val ?? 0
  if (v === 0) return '0 €'
  if (Math.abs(v) >= 1_000_000) {
    return `${(v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€`
  }
  return fmtFullEur(v)
}

function fmtFullEur(val: number | null | undefined): string {
  return `${Math.round(val ?? 0).toLocaleString('fr-FR')} €`
}

function getAnalyticsWarmupRanges(): PeriodRange[] {
  const modes: PeriodMode[] = ['today', 'yesterday', 'this_week', 'this_month', 'this_year']
  const unique = new Map<string, PeriodRange>()
  modes.forEach((mode) => {
    const range = buildPeriodRange({ ...DEFAULT_PERIOD, mode })
    unique.set(`${range.from}|${range.to}`, range)
  })
  return Array.from(unique.values())
}

function setterTableRows(stats: AnalyticsSetterSummary) {
  return [
    ['Nouveaux prospects', fmtInt(stats.newLeads), 'Entrées sur la période'],
    ['Appels logiques', fmtInt(stats.calls), `${stats.loggedCalls} réels + ${stats.syntheticCalls} ETL`],
    ['Prospects ayant répondu', fmtInt(stats.answered), `${stats.responseRate}% des nouveaux leads`],
    ['Qualifiés', fmtInt(stats.qualified), `${stats.qualificationRate}% après réponse`],
    ['RDV pris', fmtInt(stats.rdvPris), `${stats.globalRdvRate}% global`],
    ['Relance', fmtInt(stats.relance), 'À rappeler / pas de réponse'],
    ['Pas qualifiés', fmtInt(stats.notQualified), 'Refus / hors cible'],
  ]
}

function commercialOutcomeCount(stats: AnalyticsCommercialSummary): number {
  return stats.resultSegments
    .filter((segment) => segment.label === 'Signé' || segment.label === 'Perdu' || segment.label === 'Réflexion')
    .reduce((sum, segment) => sum + segment.value, 0)
}

function commercialTableRows(stats: AnalyticsCommercialSummary) {
  return [
    ['Activité RDV', fmtInt(stats.total), 'Tous les RDV GHL/CRM de la période'],
    ['Honorés confirmés', fmtInt(stats.honored), 'Seulement les RDV marqués présents dans le CRM'],
    ['Résultats RDV', fmtInt(commercialOutcomeCount(stats)), 'Signé + perdu + réflexion récupérés depuis GHL'],
    ['Ventes', fmtInt(stats.signed), `${stats.closing}% closing sur résultats`],
    ['CA signé', fmtKEur(stats.ca), 'Montant total signé'],
    ['Panier moyen', fmtKEur(stats.panier), 'CA / ventes'],
  ]
}

function adminTableRows(stats: AnalyticsAdminSummary) {
  const qualifOnTreated = stats.classified > 0 ? Math.round((stats.qualified / stats.classified) * 100) : 0
  return [
    ['Appels réels enregistrés', fmtInt(stats.loggedCalls), 'Appels réellement créés dans les logs sur la période'],
    ['Prospects traités', fmtInt(stats.classified), 'Prospects qui ont eu un vrai statut : qualifié, relance, refus ou RDV'],
    ['Prospects qualifiés', fmtInt(stats.qualified), `${qualifOnTreated}% des prospects traités deviennent qualifiés`],
    ['Ventes signées', fmtInt(stats.signed), 'Nombre de dossiers signés après RDV honoré'],
    ['Chiffre d’affaires signé', fmtKEur(stats.ca), stats.signed > 0 ? `Panier moyen estimé : ${fmtKEur(stats.ca / stats.signed)}` : 'Aucune vente signée sur cette période'],
  ]
}

// ===== Atoms =====

function AnalyticsInlineLoading() {
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-or-tint/70 border border-or/20 px-2 py-0.5 text-or-dark shadow-sm">
      <Spinner size={14} stroke={3} color="currentColor" />
      <span className="font-extrabold">Chargement…</span>
    </span>
  )
}

function BigStatCard({ label, value, delta, sub, accent, icon, progress, deltaTone }: {
  label: string; value: string; delta?: string; sub?: string;
  accent?: KpiAccent; icon?: IconName; trend?: number[]; progress?: number; deltaTone?: DeltaTone
}) {
  return (
    <MagicKpi
      label={label} value={value} delta={delta} deltaTone={deltaTone} sub={sub}
      accent={accent} icon={icon} progress={progress}
    />
  )
}

function PipelineFlow({ stats }: { stats: AnalyticsSetterSummary }) {
  const nodes = [
    { label: 'Nouveau prospect', value: stats.newLeads, color: '#6B7C8C', sub: 'entrées' },
    { label: 'Appel setter', value: stats.calls, color: '#1F7857', sub: 'actions' },
    { label: 'A répondu', value: stats.answered, color: '#3DA86A', sub: `${stats.responseRate}% réponse` },
    { label: 'Qualifié', value: stats.qualified, color: '#3E9A6F', sub: `${stats.notQualified} pas qualifiés` },
    { label: 'Prise de RDV', value: stats.rdvPris, color: '#145A41', sub: `${stats.globalRdvRate}% global` },
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-stretch">
        {nodes.map((n, i) => (
          <div key={n.label} className="relative rounded-2xl bg-white/60 border border-line-soft p-4 min-h-[112px] overflow-hidden flat-target">
            <div className="absolute -right-8 -top-8 w-20 h-20 rounded-full opacity-20 decor-bubble" style={{ background: n.color }} />
            <div className="relative z-10">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-faint mb-2">Étape {i + 1}</div>
              <div className="font-bold leading-tight">{n.label}</div>
              <div className="text-[34px] font-extrabold leading-none mt-3" style={{ color: n.color }}>{fmtInt(n.value)}</div>
              <div className="text-[11px] text-muted mt-1">{n.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-2xl bg-cuivre-tint/60 border border-line-soft p-4 flat-target">
          <div className="eyebrow mb-1">Non répondu → relance</div>
          <div className="text-2xl font-extrabold text-cuivre">{stats.relance}</div>
          <div className="text-xs text-muted">À rappeler / pas de réponse / relance</div>
        </div>
        <div className="rounded-2xl bg-rouille-tint/60 border border-line-soft p-4 flat-target">
          <div className="eyebrow mb-1">Répondu → pas qualifié</div>
          <div className="text-2xl font-extrabold text-rouille">{stats.notQualified}</div>
          <div className="text-xs text-muted">Refus / hors cible / pas budget</div>
        </div>
        <div className="rounded-2xl bg-success-tint/60 border border-line-soft p-4 flat-target">
          <div className="eyebrow mb-1">Répondu → RDV</div>
          <div className="text-2xl font-extrabold text-success">{stats.rdvPris}</div>
          <div className="text-xs text-muted">{stats.rdvAfterAnswerRate}% des prospects répondus</div>
        </div>
      </div>
    </div>
  )
}

function PieChart({ segments, center }: { segments: Segment[]; center: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6 md:items-center">
      <div className="w-[180px] h-[180px] rounded-[28px] bg-white border border-line flex items-center justify-center text-center shadow-sm">
        <div>
          {center.split('\n').map((line) => <div key={line} className="font-extrabold text-xl leading-tight">{line}</div>)}
          <div className="eyebrow mt-1">total</div>
        </div>
      </div>
      <div className="space-y-3">
        {segments.length === 0 ? <div className="text-sm text-faint">Aucune donnée sur la période.</div> : segments.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between items-center mb-1.5 text-sm">
              <span className="flex items-center gap-2"><i className="w-3 h-3 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="font-bold">{s.value} · {pct(s.value, total)}%</span>
            </div>
            <div className="h-2 bg-line-soft rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct(s.value, total)}%`, background: s.color }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heatline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values)
  const sample = values.length > 18 ? values.filter((_, i) => i % Math.ceil(values.length / 18) === 0) : values
  return (
    <div className="h-[180px] rounded-2xl bg-white/35 border border-line-soft p-4 flex items-end gap-2 overflow-hidden relative flat-target">
      {sample.map((v, i) => (
        <div key={i} className="relative z-10 flex-1 flex flex-col items-center gap-2">
          <div className="w-full rounded-t-xl" style={{ height: `${Math.max(8, (v / max) * 135)}px`, background: color, opacity: 0.45 + (v / max) * 0.5 }} />
          <span className="text-[10px] text-faint font-semibold">{v}</span>
        </div>
      ))}
    </div>
  )
}

function Goal({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-semibold">{label}</span>
        <span className="font-bold">{value}</span>
      </div>
      <div className="h-2 bg-line-soft rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between ${highlight ? 'text-success font-bold pt-2 border-t border-line-soft' : ''}`}>
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}


function AnalyticsStatsTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold">{title}</h3>
        <span className="eyebrow">vue tableau</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-or-tint">
            <tr className="text-left eyebrow">
              <Th>INDICATEUR</Th>
              <Th>VALEUR</Th>
              <Th>LECTURE CRM</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value, detail]) => (
              <tr key={label} className="border-b border-line-soft last:border-0">
                <td className="px-3 py-2.5 font-semibold">{label}</td>
                <td className="px-3 py-2.5 text-lg font-extrabold text-or-dark">{value}</td>
                <td className="px-3 py-2.5 text-muted">{detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 ${className}`}>{children}</th>
}

function SetterRow({ initials, name, appels, cnx, qual, classified, eff, effClass = '', star = false }: {
  initials: string; name: string; appels: number; cnx: number; qual: number; classified: number; eff: string; effClass?: string; star?: boolean
}) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-cuivre-tint flex items-center justify-center text-[10px] font-bold">{initials}</div>
          <span className="font-semibold">{name}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">{appels.toLocaleString('fr-FR')}</td>
      <td className="px-3 py-2.5">{classified}</td>
      <td className="px-3 py-2.5">{cnx}</td>
      <td className="px-3 py-2.5">{qual}</td>
      <td className={`px-3 py-2.5 text-right font-bold ${effClass}`}>{star ? '★ ' : ''}{eff}</td>
    </tr>
  )
}

function CommercialRow({ initials, name, total, honored, ventes, closing, panier, ca, compact = false }: {
  initials: string; name: string; total?: number; honored: number; ventes: number; closing: string; panier: string; ca: string; compact?: boolean
}) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-or-tint flex items-center justify-center text-[10px] font-bold">{initials}</div>
          <span className="font-semibold">{name}</span>
        </div>
      </td>
      {compact && <td className="px-3 py-2.5">{total ?? honored}</td>}
      <td className="px-3 py-2.5">{honored}</td>
      <td className="px-3 py-2.5">{ventes}</td>
      <td className="px-3 py-2.5">{closing}</td>
      {!compact && <td className="px-3 py-2.5">{panier}</td>}
      <td className="px-3 py-2.5 text-right font-bold text-or">{ca}</td>
    </tr>
  )
}
