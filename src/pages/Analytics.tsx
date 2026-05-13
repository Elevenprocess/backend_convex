import { useState, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useAnalyticsSummary } from '../lib/hooks'
import type { AnalyticsAdminSummary, AnalyticsCommercialSummary, AnalyticsDailyPoint, AnalyticsSegment, AnalyticsSetterSummary } from '../lib/types'

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

// ----- F11 Setter -----
function AnalyticsSetter({ name }: { name: string }) {
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAnalyticsSummary({ from: range.from, to: range.to })
  const stats = data?.setter ?? EMPTY_SETTER_STATS

  return (
    <AppShell blobsKey="setter">
      <Topbar eyebrow="ANALYTICS / SETTER" title={`Mes performances — ${name}`} />
      <div className="px-8 pt-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="text-xs text-faint font-semibold">
          Moteur OLAP/ETL backend : {range.label}.{loading ? ' Chargement…' : ''}{error ? ` Erreur: ${error}` : ''}
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
          <EvolutionChart title="Courbes d'évolution setter" data={stats.dailyEvolution} series={[
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
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAnalyticsSummary({ from: range.from, to: range.to })
  const stats = data?.commercial ?? EMPTY_COMMERCIAL_STATS

  return (
    <AppShell blobsKey="commercial">
      <Topbar eyebrow="ANALYTICS / COMMERCIAL" title={`Mes performances — ${name}`} />
      <div className="px-8 pt-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="text-xs text-faint font-semibold">OLAP/ETL backend sur {range.label}.{loading ? ' Chargement…' : ''}{error ? ` Erreur: ${error}` : ''}</div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes`} />
          <BigStatCard label="CLOSING RATE" value={`${stats.closing}%`} sub={`${stats.honored} RDV honorés`} />
          <BigStatCard label="PANIER MOYEN" value={fmtKEur(stats.panier)} />
          <BigStatCard label="RDV HONORÉS" value={`${stats.honored}/${stats.total}`} />
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
  const [period, setPeriod] = useState<PeriodState>(DEFAULT_PERIOD)
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAnalyticsSummary({ from: range.from, to: range.to })
  const stats = data?.admin ?? EMPTY_ADMIN_STATS

  return (
    <AppShell blobsKey="admin">
      <Topbar eyebrow="ANALYTICS / ADMIN" title="Performance globale équipe" />
      <div className="px-8 pt-4 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="text-xs text-faint font-semibold">Requête unique backend /analytics/summary : {range.label}.{loading ? ' Chargement…' : ''}{error ? ` Erreur: ${error}` : ''}</div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="APPELS LOGIQUES" value={fmtInt(stats.calls)} delta={`${stats.syntheticCalls} ETL`} sub="call_logs + classifications" />
          <BigStatCard label="LEADS CLASSIFIÉS" value={fmtInt(stats.classified)} sub={`${stats.qualificationRate}% qualifiés`} />
          <BigStatCard label="RDV PRIS" value={fmtInt(stats.rdvPris)} sub={`${stats.rdvRate}% / appels`} />
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes`} />
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          <div className="col-span-12 xl:col-span-7">
            <AnalyticsStatsTable title="Tableau statistiques global" rows={adminTableRows(stats)} />
          </div>
          <EvolutionChart title="Courbes d'évolution globales" data={stats.dailyEvolution} series={[
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

        <div className="glass-card p-6">
          <h3 className="font-bold mb-4">Performance par commercial</h3>
          <table className="w-full text-sm">
            <thead className="bg-or-tint">
              <tr className="text-left eyebrow">
                <Th>COMMERCIAL</Th>
                <Th>RDV HONORÉS</Th>
                <Th>VENTES</Th>
                <Th>CLOSING %</Th>
                <Th>PANIER MOY.</Th>
                <Th className="text-right">CA</Th>
              </tr>
            </thead>
            <tbody>
              {stats.commercials.length === 0 ? (
                <tr><td className="px-3 py-5 text-faint" colSpan={6}>Aucun RDV honoré.</td></tr>
              ) : stats.commercials.map((c) => (
                <CommercialRow key={c.id} initials={c.initials} name={c.name} honored={c.honored} ventes={c.signed} closing={`${c.closing}%`} panier={fmtKEur(c.panier)} ca={fmtKEur(c.ca)} />
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </AppShell>
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
  if (val === 0) return '0€'
  if (val >= 1000) return `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k€`
  return `${Math.round(val)}€`
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

function commercialTableRows(stats: AnalyticsCommercialSummary) {
  return [
    ['RDV total', fmtInt(stats.total), 'Planifiés sur la période'],
    ['RDV honorés', fmtInt(stats.honored), 'Présents'],
    ['Ventes', fmtInt(stats.signed), `${stats.closing}% closing`],
    ['CA signé', fmtKEur(stats.ca), 'Montant total signé'],
    ['Panier moyen', fmtKEur(stats.panier), 'CA / ventes'],
  ]
}

function adminTableRows(stats: AnalyticsAdminSummary) {
  return [
    ['Appels logiques', fmtInt(stats.calls), `${stats.syntheticCalls} ajoutés par ETL`],
    ['Leads classifiés', fmtInt(stats.classified), `${stats.qualificationRate}% qualifiés`],
    ['Qualifiés', fmtInt(stats.qualified), 'Leads prêts / avancés'],
    ['RDV pris', fmtInt(stats.rdvPris), `${stats.rdvRate}% / appels`],
    ['Ventes signées', fmtInt(stats.signed), 'RDV signés'],
    ['CA signé', fmtKEur(stats.ca), 'Total ventes'],
    ['Non traités', fmtInt(stats.unclassified), 'Leads sans classification'],
  ]
}

// ===== Atoms =====

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
          <div key={n.label} className="relative rounded-2xl bg-white/60 border border-line-soft p-4 min-h-[112px] overflow-hidden">
            <div className="absolute -right-8 -top-8 w-20 h-20 rounded-full opacity-20" style={{ background: n.color }} />
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
        <div className="rounded-2xl bg-cuivre-tint/60 border border-line-soft p-4">
          <div className="eyebrow mb-1">Non répondu → relance</div>
          <div className="text-2xl font-extrabold text-cuivre">{stats.relance}</div>
          <div className="text-xs text-muted">À rappeler / pas de réponse / relance</div>
        </div>
        <div className="rounded-2xl bg-rouille-tint/60 border border-line-soft p-4">
          <div className="eyebrow mb-1">Répondu → pas qualifié</div>
          <div className="text-2xl font-extrabold text-rouille">{stats.notQualified}</div>
          <div className="text-xs text-muted">Refus / hors cible / pas budget</div>
        </div>
        <div className="rounded-2xl bg-success-tint/60 border border-line-soft p-4">
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
  let cursor = 0
  const gradient = total === 0
    ? '#E5E1DA 0deg 360deg'
    : segments.map((s) => {
      const start = cursor
      const end = cursor + (s.value / total) * 360
      cursor = end
      return `${s.color} ${start}deg ${end}deg`
    }).join(', ')
  return (
    <div className="grid grid-cols-[220px_1fr] gap-8 items-center">
      <div className="relative w-[220px] h-[220px] rounded-full shadow-[0_0_45px_rgba(212,175,55,0.18)]" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-8 rounded-full bg-white/90 border border-line-soft flex items-center justify-center text-center">
          <div>
            {center.split('\n').map((line) => <div key={line} className="font-extrabold text-xl leading-tight">{line}</div>)}
            <div className="eyebrow mt-1">total</div>
          </div>
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
    <div className="h-[180px] rounded-2xl bg-white/35 border border-line-soft p-4 flex items-end gap-2 overflow-hidden relative">
      <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle at 75% 20%, ${color}55, transparent 38%)` }} />
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

function EvolutionChart({ title, data, series }: { title: string; data: AnalyticsDailyPoint[]; series: EvolutionSeries[] }) {
  const width = 520
  const height = 210
  const pad = 28
  const sample = data.length > 32 ? data.filter((_, i) => i % Math.ceil(data.length / 32) === 0 || i === data.length - 1) : data
  const max = Math.max(1, ...sample.flatMap((point) => series.map((serie) => point[serie.key] || 0)))
  const pointsFor = (serie: EvolutionSeries) => sample.map((point, i) => {
    const x = sample.length <= 1 ? width / 2 : pad + (i / (sample.length - 1)) * (width - pad * 2)
    const y = height - pad - ((point[serie.key] || 0) / max) * (height - pad * 2)
    return `${x},${y}`
  }).join(' ')
  const last = sample[sample.length - 1]

  return (
    <div className="glass-card p-6 col-span-12 xl:col-span-5 overflow-hidden">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold">{title}</h3>
          <div className="text-xs text-faint mt-1">Évolution jour par jour selon la période</div>
        </div>
        <span className="eyebrow">courbes</span>
      </div>
      {sample.length === 0 ? (
        <div className="h-[210px] rounded-2xl bg-white/40 border border-line-soft flex items-center justify-center text-sm text-faint">Aucune donnée sur la période.</div>
      ) : (
        <>
          <div className="relative rounded-2xl bg-white/45 border border-line-soft p-3 shadow-inner">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[210px]" role="img" aria-label={title}>
              <defs>
                <linearGradient id="evolutionGlow" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#3DA86A" stopOpacity="0.08" />
                </linearGradient>
              </defs>
              <rect x="0" y="0" width={width} height={height} rx="18" fill="url(#evolutionGlow)" />
              {[0, 1, 2, 3].map((line) => (
                <line key={line} x1={pad} x2={width - pad} y1={pad + line * ((height - pad * 2) / 3)} y2={pad + line * ((height - pad * 2) / 3)} stroke="#E5E1DA" strokeWidth="1" />
              ))}
              {series.map((serie, i) => (
                <g key={serie.key}>
                  <polyline
                    points={pointsFor(serie)}
                    fill="none"
                    stroke={serie.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ strokeDasharray: 900, strokeDashoffset: 0, animation: `dashDraw 1.15s ease ${i * 0.16}s both` }}
                  />
                  {sample.map((point, idx) => {
                    const x = sample.length <= 1 ? width / 2 : pad + (idx / (sample.length - 1)) * (width - pad * 2)
                    const y = height - pad - ((point[serie.key] || 0) / max) * (height - pad * 2)
                    return <circle key={`${serie.key}-${point.date}`} cx={x} cy={y} r="3.5" fill="white" stroke={serie.color} strokeWidth="2" />
                  })}
                </g>
              ))}
              <text x={pad} y={height - 8} fill="#6B7C8C" fontSize="11" fontWeight="700">{sample[0]?.label}</text>
              <text x={width - pad} y={height - 8} fill="#6B7C8C" fontSize="11" fontWeight="700" textAnchor="end">{last?.label}</text>
              <text x={pad} y="18" fill="#6B7C8C" fontSize="11" fontWeight="700">max {fmtInt(max)}</text>
            </svg>
          </div>
          <div className="flex flex-wrap gap-3 mt-4 text-xs font-bold">
            {series.map((serie) => (
              <span key={serie.key} className="inline-flex items-center gap-2 rounded-full bg-white/65 border border-line-soft px-3 py-1.5">
                <i className="w-2.5 h-2.5 rounded-full" style={{ background: serie.color }} />
                {serie.label}: {fmtInt(last?.[serie.key] || 0)}
              </span>
            ))}
          </div>
        </>
      )}
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
              <Th>DÉTAIL</Th>
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

function CommercialRow({ initials, name, honored, ventes, closing, panier, ca }: {
  initials: string; name: string; honored: number; ventes: number; closing: string; panier: string; ca: string
}) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-or-tint flex items-center justify-center text-[10px] font-bold">{initials}</div>
          <span className="font-semibold">{name}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">{honored}</td>
      <td className="px-3 py-2.5">{ventes}</td>
      <td className="px-3 py-2.5">{closing}</td>
      <td className="px-3 py-2.5">{panier}</td>
      <td className="px-3 py-2.5 text-right font-bold text-or">{ca}</td>
    </tr>
  )
}

