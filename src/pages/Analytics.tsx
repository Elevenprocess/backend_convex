import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useAnalyticsSummary, prefetchAnalyticsSummary } from '../lib/hooks'
import type { AnalyticsAdminSummary, AnalyticsCommercialPerf, AnalyticsCommercialSummary, AnalyticsDailyPoint, AnalyticsHourlyCallPoint, AnalyticsSegment, AnalyticsSetterSummary } from '../lib/types'

type Segment = AnalyticsSegment

type PeriodMode = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom'
type PeriodState = { mode: PeriodMode; customFrom: string; customTo: string }
type PeriodRange = { from: string; to: string; label: string; days: number }

const PERIOD_OPTIONS: { id: PeriodMode; label: string }[] = [
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

const todayInput = toDateInputValue(new Date())
const DEFAULT_PERIOD: PeriodState = { mode: 'today', customFrom: todayInput, customTo: todayInput }


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
  classified: 0,
  qualified: 0,
  unclassified: 0,
  syntheticCalls: 0,
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

  if (me?.role === 'admin') return <AnalyticsAdmin />
  if (me?.role === 'commercial') return <AnalyticsCommercial name={me.name} />
  return <AnalyticsSetter name={me?.name ?? 'Setter'} />
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
      <Topbar eyebrow="ANALYTICS / SETTER" title={`Mes performances — ${name}`} />
      <div className="px-8 pt-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="text-xs text-faint font-semibold">
          Moteur OLAP/ETL backend : {range.label}.{loading && <AnalyticsInlineLoading />}{error ? ` Erreur: ${error}` : ''}
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="NOUVEAUX LEADS" value={fmtInt(stats.newLeads)} sub="Entrées du système sur la période" />
          <BigStatCard label="APPELS EFFECTUÉS" value={fmtInt(stats.calls)} delta={`${stats.callsPerDay}/j`} sub={`${stats.syntheticCalls} déduits des statuts`} />
          <BigStatCard label="LEADS AYANT RÉPONDU" value={fmtInt(stats.answered)} delta={`${stats.responseRate}%`} sub="Taux réponse = répondu / nouveaux leads" />
          <BigStatCard label="RDV PRIS" value={fmtInt(stats.rdvPris)} delta={`${stats.globalRdvRate}%`} sub="Taux global RDV = RDV / nouveaux leads" />
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          <div className="col-span-12 xl:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques setter" rows={setterTableRows(stats)} />
          </div>
          <EvolutionChart title="Courbes d'évolution setter" data={stats.dailyEvolution} hourlyCalls={stats.hourlyCalls} series={[
            { key: 'calls', label: 'Appels', color: '#D4AF37' },
            { key: 'rdv', label: 'RDV', color: '#B87333' },
          ]} />
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Pipeline setter — nouveau lead → RDV</h3>
              <span className="eyebrow">backend live</span>
            </div>
            <PipelineFlow stats={stats} />
          </div>
          <div className="glass-card p-6 col-span-5">
            <h3 className="font-bold mb-4">Taux de conversion</h3>
            <div className="space-y-4">
              <Goal label="Taux de réponse" value={`${stats.answered} / ${Math.max(1, stats.newLeads)} · ${stats.responseRate}%`} pct={stats.responseRate} color="#D4AF37" />
              <Goal label="RDV après réponse" value={`${stats.rdvPris} / ${Math.max(1, stats.answered)} · ${stats.rdvAfterAnswerRate}%`} pct={stats.rdvAfterAnswerRate} color="#3DA86A" />
              <Goal label="Taux global RDV" value={`${stats.rdvPris} / ${Math.max(1, stats.newLeads)} · ${stats.globalRdvRate}%`} pct={stats.globalRdvRate} color="#B87333" />
              <Row label="Leads en relance" value={String(stats.relance)} />
              <Row label="Pas qualifiés" value={String(stats.notQualified)} />
              <Row label="Qualifiés" value={String(stats.qualified)} highlight />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Issues d'appel</h3>
              <span className="eyebrow">répondu / relance / refus</span>
            </div>
            <PieChart segments={stats.resultSegments} center={`${stats.calls}\nappels`} />
          </div>
          <div className="glass-card p-6 col-span-5">
            <h3 className="font-bold mb-4">Série — appels par jour</h3>
            <Heatline values={stats.dailyCalls} color="#D4AF37" />
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

  return (
    <AppShell blobsKey="commercial">
      <Topbar eyebrow="ANALYTICS / COMMERCIAL" title={`Mes performances — ${name}`} />
      <div className="px-8 pt-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="text-xs text-faint font-semibold">OLAP/ETL backend sur {range.label}.{loading && <AnalyticsInlineLoading />}{error ? ` Erreur: ${error}` : ''}</div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes signées`} sub={fmtFullEur(stats.ca)} />
          <BigStatCard label="CLOSING RATE" value={`${stats.closing}%`} sub={`${commercialOutcomeCount(stats)} résultats RDV`} />
          <BigStatCard label="PANIER MOYEN" value={fmtKEur(stats.panier)} />
          <BigStatCard label="ACTIVITÉ RDV" value={fmtInt(stats.total)} sub={`${stats.honored} honorés confirmés`} />
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          <div className="col-span-12 xl:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques commercial" rows={commercialTableRows(stats)} />
          </div>
          <EvolutionChart title="Courbes d'évolution commercial" data={stats.dailyEvolution} series={[
            { key: 'rdv', label: 'RDV', color: '#D4AF37' },
            { key: 'signed', label: 'Ventes', color: '#3DA86A' },
            { key: 'ca', label: 'CA', color: '#B87333' },
          ]} />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Camembert des résultats RDV</h3>
            <PieChart segments={stats.resultSegments} center={`${stats.closing}%\nclosing`} />
          </div>
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Mode de paiement</h3>
            <PieChart segments={stats.financingSegments} center={fmtKEur(stats.ca)} />
          </div>
        </div>
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

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar eyebrow="ANALYTICS / ADMIN" title="Performance globale équipe" />
      <div className="px-8 pt-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="text-xs text-faint font-semibold">Requête unique backend /analytics/summary : {range.label}.{loading && <AnalyticsInlineLoading />}{error ? ` Erreur: ${error}` : ''}</div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="APPELS CRM" value={fmtInt(stats.calls)} delta={`${stats.classified} traités`} sub="Appels et statuts suivis dans le CRM" />
          <BigStatCard label="LEADS CLASSIFIÉS" value={fmtInt(stats.classified)} sub={`${stats.qualificationRate}% qualifiés`} />
          <BigStatCard label="RDV PRIS" value={fmtInt(stats.rdvPris)} sub={`${stats.rdvRate}% / appels`} />
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes signées`} sub={fmtFullEur(stats.ca)} />
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          <div className="col-span-12 xl:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques global" rows={adminTableRows(stats)} />
          </div>
          <EvolutionChart title="Courbes d'évolution globales" data={stats.dailyEvolution} hourlyCalls={stats.hourlyCalls} series={[
            { key: 'calls', label: 'Appels', color: '#D4AF37' },
            { key: 'rdv', label: 'RDV', color: '#B87333' },
            { key: 'signed', label: 'Ventes', color: '#3DA86A' },
          ]} />
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Camembert OLAP — issues d'appel</h3>
              <span className="eyebrow">requête backend agrégée</span>
            </div>
            <PieChart segments={stats.resultSegments} center={`${stats.calls}\nappels`} />
          </div>
          <div className="glass-card p-6 col-span-5">
            <h3 className="font-bold mb-4">ETL qualité data</h3>
            <div className="space-y-4">
              <Goal label="Traçabilité appels" value={`${stats.calls} appels / ${stats.classified} classifs`} pct={pct(stats.calls, stats.classified)} color="#D4AF37" />
              <Goal label="Qualification" value={`${stats.qualified} qualifiés`} pct={stats.qualificationRate} color="#3DA86A" />
              <Goal label="RDV" value={`${stats.rdvPris} RDV`} pct={stats.rdvRate} color="#B87333" />
              <Row label="Leads non traités" value={String(stats.unclassified)} />
            </div>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="font-bold mb-4">Performance par setter — chiffres personnels</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead className="bg-or-tint">
                <tr className="text-left eyebrow">
                  <Th>SETTER</Th>
                  <Th>APPELS LOGIQUES</Th>
                  <Th>CLASSIFIÉS</Th>
                  <Th>JOINTS</Th>
                  <Th>QUALIFIÉS</Th>
                  <Th>RDV PRIS</Th>
                  <Th className="text-right">EFFICACITÉ</Th>
                </tr>
              </thead>
              <tbody>
                {stats.setters.length === 0 ? (
                  <tr><td className="px-3 py-5 text-faint" colSpan={7}>Aucun setter trouvé.</td></tr>
                ) : stats.setters.map((s, i) => (
                  <SetterRow key={s.id} initials={s.initials} name={s.name} appels={s.calls} cnx={s.connected} qual={s.qualified} rdv={s.rdvPris} classified={s.classified} eff={`${s.efficiency}%`} effClass={s.efficiency >= 70 ? 'text-success' : s.efficiency >= 45 ? 'text-cuivre' : 'text-rouille'} star={i === 0} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <CommercialTrackingDashboard commercials={commercialStats.commercials} totalCa={commercialStats.ca} totalSigned={commercialStats.signed} totalHonored={commercialStats.commercials.reduce((sum, c) => sum + c.honored, 0)} loading={loading} />
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
          <span className="eyebrow">DASHBOARD COMMERCIAUX</span>
          <h3 className="text-2xl font-extrabold mt-1">Suivi des commerciaux</h3>
          <p className="text-sm text-muted mt-1">Vue admin depuis toujours : activité GHL/RDV, ventes, closing, panier moyen et CA par commercial.{loading && <AnalyticsInlineLoading />}</p>
        </div>
        <div className="rounded-2xl border border-or/15 bg-or-tint/50 px-4 py-3 text-sm">
          <div className="eyebrow mb-1">Leader CA</div>
          <div className="font-extrabold text-lg">{leader?.name ?? '—'}</div>
          <div className="text-xs text-faint">{leader ? `${fmtKEur(leader.ca)} · ${leader.signed} ventes` : 'Aucune donnée'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <CommercialMiniKpi label="Activités GHL/RDV" value={fmtInt(totalActivities)} detail="depuis toujours" />
        <CommercialMiniKpi label="RDV honorés" value={fmtInt(totalHonored)} detail={`${fmtInt(totalPlanned)} planifiés`} />
        <CommercialMiniKpi label="Ventes" value={fmtInt(totalSigned)} detail="devis signés" tone="success" />
        <CommercialMiniKpi label="Closing moyen" value={`${averageClosing}%`} detail="moyenne équipe" tone={averageClosing >= 35 ? 'success' : averageClosing >= 20 ? 'warning' : 'danger'} />
        <CommercialMiniKpi label="CA signé" value={fmtKEur(totalCa)} detail="historique complet" tone="gold" />
        <CommercialMiniKpi label="Meilleur closing" value={bestClosing ? `${bestClosing.closing}%` : '0%'} detail={bestClosing?.name ?? '—'} />
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
                  <CommercialInsight title="Équipe stable" detail="Aucun commercial avec closing faible sur des RDV honorés." tone="success" />
                ) : watchList.map((c) => (
                  <CommercialInsight key={c.id} title={c.name} detail={`${c.closing}% closing sur ${c.honored} RDV honorés · à accompagner.`} tone="warning" />
                ))}
                {leader && <CommercialInsight title="Meilleur CA" detail={`${leader.name} génère ${fmtKEur(leader.ca)} sur la période.`} tone="gold" />}
                {bestClosing && bestClosing.id !== leader?.id && <CommercialInsight title="Meilleur taux" detail={`${bestClosing.name} est à ${bestClosing.closing}% de closing.`} />}
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
  const toneClass = tone === 'success' ? 'bg-success/10 text-success border-success/15' : tone === 'warning' ? 'bg-cuivre-tint text-cuivre border-cuivre/15' : tone === 'danger' ? 'bg-rouille/10 text-rouille border-rouille/15' : tone === 'gold' ? 'bg-or-tint text-or-dark border-or/15' : 'bg-white/70 text-text border-line-soft'
  return (
    <div className={`rounded-3xl border p-4 ${toneClass}`}>
      <div className="eyebrow mb-2">{label}</div>
      <div className="text-2xl font-extrabold leading-none">{value}</div>
      <div className="text-[11px] text-faint mt-2">{detail}</div>
    </div>
  )
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
        <ProgressLine label="Closing" value={`${commercial.closing}%`} pct={closingPct} color={commercial.closing >= 35 ? 'bg-success' : commercial.closing >= 20 ? 'bg-cuivre' : 'bg-rouille'} />
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

function fmtInt(n: number): string {
  return n.toLocaleString('fr-FR')
}

function fmtKEur(val: number): string {
  if (val === 0) return '0 €'
  if (Math.abs(val) >= 1_000_000) {
    return `${(val / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€`
  }
  return fmtFullEur(val)
}

function fmtFullEur(val: number): string {
  return `${Math.round(val).toLocaleString('fr-FR')} €`
}

function buildPeriodRange(period: PeriodState): PeriodRange {
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
  const option = PERIOD_OPTIONS.find((p) => p.id === period.mode)?.label ?? 'Période'
  return { from: startOfDay(from).toISOString(), to: endOfDay(to).toISOString(), label: `${option} · ${formatShortDate(from)} → ${formatShortDate(to)}`, days }
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

function setterTableRows(stats: AnalyticsSetterSummary) {
  return [
    ['Nouveaux leads', fmtInt(stats.newLeads), 'Entrées sur la période'],
    ['Appels logiques', fmtInt(stats.calls), `${stats.loggedCalls} réels + ${stats.syntheticCalls} ETL`],
    ['Leads ayant répondu', fmtInt(stats.answered), `${stats.responseRate}% des nouveaux leads`],
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
  return [
    ['Appels CRM enregistrés', fmtInt(stats.calls), 'Nombre d’appels suivis dans le CRM sur la période'],
    ['Leads travaillés', fmtInt(stats.classified), 'Leads qui ont eu un vrai statut commercial : qualifié, relance, refus ou RDV'],
    ['Leads qualifiés', fmtInt(stats.qualified), `${stats.qualificationRate}% des appels deviennent des opportunités qualifiées`],
    ['RDV créés', fmtInt(stats.rdvPris), `${stats.rdvRate}% de transformation appel → RDV`],
    ['Ventes signées', fmtInt(stats.signed), 'Nombre de dossiers signés après RDV honoré'],
    ['Chiffre d’affaires signé', fmtKEur(stats.ca), stats.signed > 0 ? `Panier moyen estimé : ${fmtKEur(stats.ca / stats.signed)}` : 'Aucune vente signée sur cette période'],
    ['Leads à traiter', fmtInt(stats.unclassified), 'Leads encore sans qualification claire dans le CRM'],
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

function BigStatCard({ label, value, delta, sub }: { label: string; value: string; delta?: string; sub?: string }) {
  return (
    <div className="glass-card p-6">
      <span className="eyebrow">{label}</span>
      <div className="flex items-end justify-between mt-2 gap-2">
        <span className="text-[36px] font-bold leading-none">{value}</span>
        {delta && <span className="delta-badge delta-success">{delta}</span>}
      </div>
      {sub && <div className="text-xs text-faint mt-2">{sub}</div>}
    </div>
  )
}

function PipelineFlow({ stats }: { stats: AnalyticsSetterSummary }) {
  const nodes = [
    { label: 'Nouveau lead', value: stats.newLeads, color: '#6B7C8C', sub: 'entrées' },
    { label: 'Appel setter', value: stats.calls, color: '#D4AF37', sub: 'actions' },
    { label: 'A répondu', value: stats.answered, color: '#3DA86A', sub: `${stats.responseRate}% réponse` },
    { label: 'Qualifié', value: stats.qualified, color: '#B87333', sub: `${stats.notQualified} pas qualifiés` },
    { label: 'Prise de RDV', value: stats.rdvPris, color: '#B7410E', sub: `${stats.globalRdvRate}% global` },
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-5 gap-3 items-stretch">
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
      <div className="grid grid-cols-3 gap-3 text-sm">
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
          <div className="text-xs text-muted">{stats.rdvAfterAnswerRate}% des leads répondus</div>
        </div>
      </div>
    </div>
  )
}

function PieChart({ segments, center }: { segments: Segment[]; center: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return (
    <div className="grid grid-cols-[180px_1fr] gap-6 items-center">
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


type EvolutionSeries = { key: keyof Pick<AnalyticsDailyPoint, 'calls' | 'rdv' | 'signed' | 'ca'>; label: string; color: string }
type EvolutionGranularity = 'hour' | 'day' | 'week' | 'month'
type EvolutionPrepared = { points: AnalyticsDailyPoint[]; granularity: EvolutionGranularity; subtitle: string }

const HOUR_SLOTS = Array.from({ length: 14 }, (_, idx) => idx + 8)

function EvolutionChart({ title, data, hourlyCalls, series }: { title: string; data?: AnalyticsDailyPoint[]; hourlyCalls?: AnalyticsHourlyCallPoint[]; series: EvolutionSeries[] }) {
  const [activeKey, setActiveKey] = useState<EvolutionSeries['key']>(series[0]?.key ?? 'calls')
  const [hoveredPoint, setHoveredPoint] = useState<{ point: AnalyticsDailyPoint; x: number; y: number; cursorX: number; cursorY: number; cursorValue: number } | null>(null)
  const width = 620
  const height = 260
  const padX = 44
  const padTop = 24
  const padBottom = 42
  const points = data ?? []
  const prepared = useMemo(() => buildAdaptiveEvolutionPoints(points, hourlyCalls ?? []), [points, hourlyCalls])
  const chartPoints = prepared.points
  const active = series.find((serie) => serie.key === activeKey) ?? series[0]
  const sample = chartPoints.length > 56 ? chartPoints.filter((_, i) => i % Math.ceil(chartPoints.length / 56) === 0 || i === chartPoints.length - 1) : chartPoints
  const max = Math.max(1, ...sample.map((point) => active ? point[active.key] || 0 : 0))
  const total = chartPoints.reduce((sum, point) => sum + (active ? point[active.key] || 0 : 0), 0)
  const peak = chartPoints.reduce((best, point) => ((active ? point[active.key] || 0 : 0) > (active ? best[active.key] || 0 : 0) ? point : best), chartPoints[0] ?? null)
  const last = chartPoints[chartPoints.length - 1]
  const chartHeight = height - padTop - padBottom
  const xFor = (idx: number) => sample.length <= 1 ? width / 2 : padX + (idx / (sample.length - 1)) * (width - padX * 2)
  const yFor = (value: number) => padTop + chartHeight - (value / max) * chartHeight
  const linePoints = active ? sample.map((point, i) => `${xFor(i)},${yFor(point[active.key] || 0)}`).join(' ') : ''
  const areaPoints = active && sample.length
    ? `${padX},${height - padBottom} ${linePoints} ${width - padX},${height - padBottom}`
    : ''
  const ghostMax = Math.max(1, ...sample.flatMap((point) => series.map((serie) => point[serie.key] || 0)))
  const ghostPointsFor = (serie: EvolutionSeries) => sample.map((point, i) => {
    const x = xFor(i)
    const y = padTop + chartHeight - ((point[serie.key] || 0) / ghostMax) * chartHeight
    return `${x},${y}`
  }).join(' ')
  const formatMetric = (key: EvolutionSeries['key'], value: number) => key === 'ca' ? fmtKEur(value) : fmtInt(value)
  const delta = active && chartPoints.length >= 2 ? (last?.[active.key] || 0) - (chartPoints[0]?.[active.key] || 0) : 0
  const hoveredValue = hoveredPoint && active ? hoveredPoint.point[active.key] || 0 : 0
  const clamp = (value: number, min: number, maxValue: number) => Math.min(maxValue, Math.max(min, value))
  const lastLabel = prepared.granularity === 'hour' ? 'Dernière heure' : prepared.granularity === 'week' ? 'Dernière semaine' : prepared.granularity === 'month' ? 'Dernier mois' : 'Dernier jour'
  const handleChartMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (!active || sample.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const cursorX = clamp(((event.clientX - rect.left) / rect.width) * width, padX, width - padX)
    const cursorY = clamp(((event.clientY - rect.top) / rect.height) * height, padTop, height - padBottom)
    const nearestIndex = sample.length <= 1
      ? 0
      : clamp(Math.round(((cursorX - padX) / (width - padX * 2)) * (sample.length - 1)), 0, sample.length - 1)
    const point = sample[nearestIndex]
    const x = xFor(nearestIndex)
    const y = yFor(point[active.key] || 0)
    const cursorRatio = (padTop + chartHeight - cursorY) / chartHeight
    const cursorValue = Math.round(clamp(cursorRatio, 0, 1) * max)
    setHoveredPoint({ point, x, y, cursorX, cursorY, cursorValue })
  }

  return (
    <div className="glass-card p-6 col-span-12 xl:col-span-5 overflow-hidden">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold">{title}</h3>
          <div className="text-xs text-faint mt-1">{prepared.subtitle}</div>
        </div>
        <span className="eyebrow">évolution</span>
      </div>
      {sample.length === 0 || !active ? (
        <div className="h-[260px] rounded-[28px] bg-white/45 border border-line-soft flex items-center justify-center text-sm text-faint">Aucune donnée sur la période.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {series.map((serie) => {
              const isActive = serie.key === active.key
              const serieTotal = chartPoints.reduce((sum, point) => sum + (point[serie.key] || 0), 0)
              return (
                <button
                  key={serie.key}
                  type="button"
                  onClick={() => setActiveKey(serie.key)}
                  className={`evolution-tab text-left rounded-2xl border px-3 py-2 transition-all ${isActive ? 'evolution-tab-active bg-white shadow-lg border-or/40 scale-[1.02]' : 'bg-white/45 border-line-soft hover:bg-white/75'}`}
                >
                  <span className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-faint">
                    <i className="w-2.5 h-2.5 rounded-full" style={{ background: serie.color }} />{serie.label}
                  </span>
                  <span className="block text-xl font-extrabold mt-1" style={{ color: isActive ? serie.color : undefined }}>{formatMetric(serie.key, serieTotal)}</span>
                </button>
              )
            })}
          </div>

          <div className="evolution-chart relative rounded-[28px] bg-white border border-line-soft p-3 shadow-inner overflow-hidden flat-target">
            <div className="evolution-last-card pointer-events-none absolute right-4 top-4 rounded-2xl bg-white/80 border border-line-soft px-3 py-2 shadow-sm">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-faint">{lastLabel}</div>
              <div className="text-2xl font-extrabold" style={{ color: active.color }}>{formatMetric(active.key, last?.[active.key] || 0)}</div>
              <div className={`text-[11px] font-bold ${delta >= 0 ? 'text-success' : 'text-rouille'}`}>{delta >= 0 ? '+' : ''}{formatMetric(active.key, delta)} vs début</div>
            </div>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-[260px] cursor-crosshair"
              role="img"
              aria-label={title}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              {[0, 0.5, 1].map((ratio) => {
                const y = padTop + ratio * chartHeight
                const label = Math.round(max * (1 - ratio))
                return (
                  <g key={ratio}>
                    <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="var(--chart-grid, #DDD6C9)" strokeDasharray="6 8" strokeWidth="1" />
                    <text x="8" y={y + 4} fill="var(--chart-label, #6B7C8C)" fontSize="11" fontWeight="700">{formatMetric(active.key, label)}</text>
                  </g>
                )
              })}
              {series.filter((serie) => serie.key !== active.key).map((serie) => (
                <polyline key={serie.key} points={ghostPointsFor(serie)} fill="none" stroke={serie.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" strokeDasharray="5 8" />
              ))}
              <polygon points={areaPoints} fill={active.color} opacity="0.08" />
              <polyline
                points={linePoints}
                fill="none"
                stroke={active.color}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeDasharray: 1100, strokeDashoffset: 0, animation: 'dashDraw 1.05s ease both' }}
              />
              {hoveredPoint && (
                <g pointerEvents="none">
                  <line x1={hoveredPoint.cursorX} x2={hoveredPoint.cursorX} y1={padTop} y2={height - padBottom} stroke={active.color} strokeWidth="1.5" opacity="0.35" strokeDasharray="4 5" />
                  <line x1={padX} x2={width - padX} y1={hoveredPoint.cursorY} y2={hoveredPoint.cursorY} stroke={active.color} strokeWidth="1.2" opacity="0.22" strokeDasharray="3 6" />
                  <circle cx={hoveredPoint.cursorX} cy={hoveredPoint.cursorY} r="4" fill={active.color} opacity="0.9" />
                  <text x={hoveredPoint.cursorX + 8} y={hoveredPoint.cursorY - 8} fill={active.color} fontSize="11" fontWeight="800">
                    {formatMetric(active.key, hoveredPoint.cursorValue)}
                  </text>
                </g>
              )}
              {sample.map((point, idx) => {
                const x = xFor(idx)
                const y = yFor(point[active.key] || 0)
                const isPeak = peak?.date === point.date
                const isHovered = hoveredPoint?.point.date === point.date
                const showLabel = prepared.granularity === 'hour'
                  ? idx === 0 || idx === sample.length - 1 || idx % 7 === 0 || isPeak
                  : prepared.granularity === 'week'
                    ? sample.length <= 12 || idx === 0 || idx === sample.length - 1 || isPeak
                    : prepared.granularity === 'month'
                      ? sample.length <= 14 || idx === 0 || idx === sample.length - 1 || isPeak
                      : sample.length <= 10 || idx === 0 || idx === sample.length - 1 || isPeak
                return (
                  <g key={point.date}>
                    <title>{`${point.label} — ${active.label}: ${formatMetric(active.key, point[active.key] || 0)}`}</title>
                    {isHovered && <line x1={x} x2={x} y1={padTop} y2={height - padBottom} stroke={active.color} strokeWidth="1.5" opacity="0.25" strokeDasharray="4 5" />}
                    <circle cx={x} cy={y} r="14" fill="transparent" />
                    <circle cx={x} cy={y} r={isHovered ? 7 : isPeak ? 6 : 4} fill="var(--chart-point-fill, white)" stroke={active.color} strokeWidth={isHovered || isPeak ? 4 : 3} />
                    {isPeak && <text x={x} y={y - 12} fill={active.color} fontSize="11" fontWeight="800" textAnchor="middle">pic {formatMetric(active.key, point[active.key] || 0)}</text>}
                    {showLabel && <text x={x} y={height - 13} fill="var(--chart-label, #6B7C8C)" fontSize="11" fontWeight="700" textAnchor={idx === 0 ? 'start' : idx === sample.length - 1 ? 'end' : 'middle'}>{point.label}</text>}
                  </g>
                )
              })}
            </svg>
            {hoveredPoint && active && (
              <div
                className="pointer-events-none absolute z-30 min-w-[170px] rounded-2xl border border-line-soft bg-white/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md"
                style={{
                  left: hoveredPoint.cursorX > width * 0.58 ? 'auto' : `${Math.min(58, Math.max(2, (hoveredPoint.cursorX / width) * 100))}%`,
                  right: hoveredPoint.cursorX > width * 0.58 ? `${Math.min(58, Math.max(2, ((width - hoveredPoint.cursorX) / width) * 100))}%` : 'auto',
                  top: `${Math.min(62, Math.max(4, (hoveredPoint.cursorY / height) * 100))}%`,
                  transform: hoveredPoint.cursorY > height * 0.62 ? 'translateY(-100%)' : 'translateY(10px)',
                }}
              >
                <div className="font-extrabold text-text">{hoveredPoint.point.label}</div>
                <div className="mt-1 flex items-center justify-between gap-4">
                  <span className="font-bold" style={{ color: active.color }}>{active.label}</span>
                  <span className="text-lg font-extrabold" style={{ color: active.color }}>{formatMetric(active.key, hoveredValue)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-4 rounded-xl bg-or-tint px-2 py-1">
                  <span className="font-bold text-muted">niveau souris</span>
                  <span className="font-extrabold" style={{ color: active.color }}>{formatMetric(active.key, hoveredPoint.cursorValue)}</span>
                </div>
                <div className="mt-2 space-y-1 border-t border-line-soft pt-2 text-[11px] text-muted">
                  {series.filter((serie) => serie.key !== active.key).map((serie) => (
                    <div key={serie.key} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full" style={{ background: serie.color }} />{serie.label}</span>
                      <b>{formatMetric(serie.key, hoveredPoint.point[serie.key] || 0)}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
            <div className="evolution-summary rounded-2xl bg-white/60 border border-line-soft p-3">
              <div className="eyebrow mb-1">Total période</div>
              <div className="text-xl font-extrabold">{formatMetric(active.key, total)}</div>
            </div>
            <div className="evolution-summary rounded-2xl bg-white/60 border border-line-soft p-3">
              <div className="eyebrow mb-1">Pic</div>
              <div className="text-xl font-extrabold">{peak ? formatMetric(active.key, peak[active.key] || 0) : '0'}</div>
              <div className="text-[11px] text-faint">{peak?.label}</div>
            </div>
            <div className="evolution-summary rounded-2xl bg-white/60 border border-line-soft p-3">
              <div className="eyebrow mb-1">Tendance</div>
              <div className={`text-xl font-extrabold ${delta >= 0 ? 'text-success' : 'text-rouille'}`}>{delta >= 0 ? 'Hausse' : 'Baisse'}</div>
              <div className="text-[11px] text-faint">début → fin</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function buildAdaptiveEvolutionPoints(dailyPoints: AnalyticsDailyPoint[], hourlyCalls: AnalyticsHourlyCallPoint[]): EvolutionPrepared {
  if (dailyPoints.length === 0) {
    return { points: [], granularity: 'day', subtitle: 'Courbe claire par indicateur — clique sur une statistique' }
  }
  const sortedDaily = [...dailyPoints].sort((a, b) => dayTime(a.date) - dayTime(b.date))
  const daySpan = Math.max(1, Math.round((dayTime(sortedDaily[sortedDaily.length - 1].date) - dayTime(sortedDaily[0].date)) / 86_400_000) + 1)
  if (daySpan <= 2) {
    const hourly = buildHourlyEvolutionPoints(sortedDaily, hourlyCalls)
    if (hourly.length > 0) {
      return { points: hourly, granularity: 'hour', subtitle: 'Courbe par heure — 8h à 21h pour Appels, RDV et Ventes' }
    }
  }
  if (daySpan > 10 && daySpan <= 93) {
    return { points: groupEvolutionPoints(sortedDaily, 'week'), granularity: 'week', subtitle: 'Courbe groupée par semaine selon la plage sélectionnée' }
  }
  if (daySpan > 93) {
    return { points: groupEvolutionPoints(sortedDaily, 'month'), granularity: 'month', subtitle: 'Courbe groupée par mois selon la plage sélectionnée' }
  }
  return { points: sortedDaily, granularity: 'day', subtitle: 'Courbe claire par jour — clique sur une statistique' }
}

function buildHourlyEvolutionPoints(dailyPoints: AnalyticsDailyPoint[], hourlyCalls: AnalyticsHourlyCallPoint[]): AnalyticsDailyPoint[] {
  const hourlyByDate = new Map<string, AnalyticsHourlyCallPoint[]>()
  hourlyCalls.forEach((point) => {
    const key = dateKey(point.date)
    const rows = hourlyByDate.get(key) ?? []
    rows.push(point)
    hourlyByDate.set(key, rows)
  })
  return dailyPoints.flatMap((dailyPoint) => {
    const key = dateKey(dailyPoint.date)
    const existing = hourlyByDate.get(key)?.sort((a, b) => a.hour - b.hour)
    const baseHours = existing?.length
      ? existing
      : HOUR_SLOTS.map((hour) => ({ date: key, hour, label: `${shortDateLabel(key)} ${hour}h`, calls: 0 }))
    const callWeights = baseHours.map((point) => point.calls)
    const rdvValues = distributeValue(dailyPoint.rdv, callWeights)
    const signedValues = distributeValue(dailyPoint.signed, callWeights)
    const caValues = distributeValue(dailyPoint.ca, callWeights, false)
    return baseHours.map((hourPoint, idx) => ({
      date: `${key}-${String(hourPoint.hour).padStart(2, '0')}`,
      label: `${shortDateLabel(key)} ${hourPoint.hour}h`,
      calls: hourPoint.calls,
      rdv: rdvValues[idx] ?? 0,
      signed: signedValues[idx] ?? 0,
      ca: caValues[idx] ?? 0,
    }))
  })
}

function groupEvolutionPoints(points: AnalyticsDailyPoint[], mode: 'week' | 'month'): AnalyticsDailyPoint[] {
  const grouped = new Map<string, AnalyticsDailyPoint>()
  points.forEach((point) => {
    const date = parseDay(point.date)
    const key = mode === 'week' ? weekKey(date) : monthKey(date)
    const label = mode === 'week' ? weekLabel(date) : monthLabel(date)
    const current = grouped.get(key) ?? { date: key, label, calls: 0, rdv: 0, signed: 0, ca: 0 }
    current.calls += point.calls || 0
    current.rdv += point.rdv || 0
    current.signed += point.signed || 0
    current.ca += point.ca || 0
    grouped.set(key, current)
  })
  return Array.from(grouped.values()).sort((a, b) => dayTime(a.date) - dayTime(b.date))
}

function distributeValue(total: number, weights: number[], integer = true): number[] {
  if (weights.length === 0) return []
  if (!total) return weights.map(() => 0)
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
  const safeWeights = weightTotal > 0 ? weights.map((weight) => Math.max(0, weight)) : weights.map(() => 1)
  const safeTotal = weightTotal > 0 ? weightTotal : weights.length
  const raw = safeWeights.map((weight) => (total * weight) / safeTotal)
  if (!integer) return raw
  const values = raw.map(Math.floor)
  let remainder = Math.round(total - values.reduce((sum, value) => sum + value, 0))
  raw
    .map((value, idx) => ({ idx, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ idx }) => {
      if (remainder > 0) {
        values[idx] += 1
        remainder -= 1
      }
    })
  return values
}

function dateKey(value: string): string {
  const date = parseDay(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDay(value: string): Date {
  const clean = value.slice(0, 10)
  const date = new Date(`${clean}T00:00:00`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function dayTime(value: string): number {
  return parseDay(value).getTime()
}

function weekKey(date: Date): string {
  const monday = weekStart(date)
  return dateKey(monday.toISOString())
}

function weekLabel(date: Date): string {
  return `Sem. ${shortDateLabel(weekKey(date))}`
}

function weekStart(date: Date): Date {
  const copy = new Date(date)
  const day = copy.getDay() || 7
  copy.setDate(copy.getDate() - day + 1)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }).replace('.', '')
}

function shortDateLabel(value: string): string {
  const date = parseDay(value)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
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

function PeriodSelector({ value, onChange }: { value: PeriodState; onChange: (v: PeriodState) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as PeriodMode })}
        className="px-3 py-2 rounded-xl bg-white border border-line-soft text-xs font-bold text-text shadow-sm"
      >
        {PERIOD_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
      </select>
      {value.mode === 'custom' && (
        <>
          <input
            type="date"
            max={todayInput}
            value={value.customFrom}
            onChange={(e) => onChange({ ...value, customFrom: e.target.value > todayInput ? todayInput : e.target.value })}
            className="px-3 py-2 rounded-xl bg-white border border-line-soft text-xs font-semibold"
          />
          <span className="text-xs text-faint font-bold">à</span>
          <input
            type="date"
            max={todayInput}
            value={value.customTo}
            onChange={(e) => onChange({ ...value, customTo: e.target.value > todayInput ? todayInput : e.target.value })}
            className="px-3 py-2 rounded-xl bg-white border border-line-soft text-xs font-semibold"
          />
        </>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 ${className}`}>{children}</th>
}

function SetterRow({ initials, name, appels, cnx, qual, rdv, classified, eff, effClass = '', star = false }: {
  initials: string; name: string; appels: number; cnx: number; qual: number; rdv: number; classified: number; eff: string; effClass?: string; star?: boolean
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
      <td className="px-3 py-2.5">{rdv}</td>
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
