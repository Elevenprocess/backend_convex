import { useMemo, useState, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useAnalyticsSummary } from '../lib/hooks'
import type { AnalyticsResponse } from '../lib/types'

type AnalyticsPeriodMode = 'today' | 'week' | 'month' | 'year'
type AnalyticsRange = { from: Date; to: Date; label: string; days: number }


export function Analytics() {
  const me = useAuth((s) => s.user)

  if (me?.role === 'admin') return <AnalyticsAdmin />
  if (me?.role === 'commercial') return <AnalyticsCommercial name={me.name} userId={me.id} />
  return <AnalyticsSetter name={me?.name ?? 'Setter'} userId={me?.id} />
}

// ----- F11 Setter -----
function AnalyticsSetter({ name }: { name: string; userId?: string }) {
  const period = useAnalyticsPeriod('month')
  const days = period.range.days
  const { data } = useAnalyticsSummary(rangeQuery(period.range))
  const stats = data ?? EMPTY_ANALYTICS_STATS

  return (
    <AppShell blobsKey="setter">
      <Topbar eyebrow="ANALYTICS / SETTER" title={`Mes performances — ${name}`} />
      <AnalyticsPeriodBar
        helper="Moteur OLAP local : call_logs + statuts leads + RDV, sans données fictives."
        period={period}
      />
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="APPELS LOGIQUES" value={fmtInt(stats.calls)} delta={`${stats.callsPerDay}/j`} sub="1 classification = au moins 1 appel" />
          <BigStatCard label="TAUX DE CONNEXION" value={`${stats.connectionRate}%`} delta={`${stats.connected} joints`} />
          <BigStatCard label="RDV / APPELS" value={`${stats.rdvRate}%`} sub={`${stats.rdvPris} RDV pris`} />
          <BigStatCard label="CLASSIFICATIONS" value={fmtInt(stats.classified)} sub={`${stats.syntheticCalls} appels déduits des statuts`} />
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Camembert des issues d'appel</h3>
              <span className="eyebrow">ETL classifications → appels</span>
            </div>
            <PieChart segments={stats.resultSegments} center={`${stats.calls}\nappels`} />
          </div>
          <div className="glass-card p-6 col-span-5">
            <h3 className="font-bold mb-4">Pipeline setter</h3>
            <div className="space-y-4">
              <Goal label="Appels logiques" value={`${stats.calls} / ${Math.max(1, days * 35)}`} pct={pct(stats.calls, days * 35)} color="#D4AF37" />
              <Goal label="Leads qualifiés" value={`${stats.qualified} / ${Math.max(1, Math.round(days * 2.5))}`} pct={pct(stats.qualified, Math.round(days * 2.5))} color="#3DA86A" />
              <Goal label="RDV pris" value={`${stats.rdvPris} / ${Math.max(1, Math.round(days * 1.2))}`} pct={pct(stats.rdvPris, Math.round(days * 1.2))} color="#B87333" />
              <Row label="Leads sans appel/statut" value={String(stats.unclassified)} />
              <Row label="Ratio qualification" value={`${stats.qualificationRate}%`} highlight />
            </div>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="font-bold mb-4">Série OLAP — appels passés par jour</h3>
          <Heatline values={stats.dailyCalls} color="#D4AF37" />
        </div>
      </main>
    </AppShell>
  )
}

// ----- F12 Commercial -----
function AnalyticsCommercial({ name }: { name: string; userId: string }) {
  const period = useAnalyticsPeriod('month')
  const { data } = useAnalyticsSummary(rangeQuery(period.range))
  const stats = data ?? EMPTY_ANALYTICS_STATS

  return (
    <AppShell blobsKey="commercial">
      <Topbar eyebrow="ANALYTICS / COMMERCIAL" title={`Mes performances — ${name}`} />
      <AnalyticsPeriodBar
        helper="Analyse live des RDV honorés, ventes et modes de financement."
        period={period}
      />
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes`} />
          <BigStatCard label="CLOSING RATE" value={`${stats.closing}%`} sub={`${stats.honored} RDV honorés`} />
          <BigStatCard label="PANIER MOYEN" value={fmtKEur(stats.panier)} />
          <BigStatCard label="RDV HONORÉS" value={`${stats.honored}/${stats.total}`} />
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
  const period = useAnalyticsPeriod('month')
  const { data } = useAnalyticsSummary(rangeQuery(period.range))
  const stats = data ?? EMPTY_ANALYTICS_STATS

  return (
    <AppShell blobsKey="admin">
      <Topbar eyebrow="ANALYTICS / ADMIN" title="Performance globale équipe" />
      <AnalyticsPeriodBar
        helper="Filtre toutes les métriques équipe sur la période choisie."
        period={period}
      />
      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <BigStatCard label="APPELS LOGIQUES" value={fmtInt(stats.calls)} delta={`${stats.syntheticCalls} ETL`} sub="call_logs + classifications" />
          <BigStatCard label="LEADS CLASSIFIÉS" value={fmtInt(stats.classified)} sub={`${stats.qualificationRate}% qualifiés`} />
          <BigStatCard label="RDV PRIS" value={fmtInt(stats.rdvPris)} sub={`${stats.rdvRate}% / appels`} />
          <BigStatCard label="CA SIGNÉ" value={fmtKEur(stats.ca)} delta={`${stats.signed} ventes`} />
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Camembert OLAP — issues d'appel</h3>
              <span className="eyebrow">requête agrégée par résultat</span>
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

// ===== Analytics backend helpers =====

type Segment = AnalyticsResponse['resultSegments'][number]

const EMPTY_ANALYTICS_STATS: AnalyticsResponse = {
  calls: 0,
  loggedCalls: 0,
  syntheticCalls: 0,
  callsPerDay: 0,
  classified: 0,
  unclassified: 0,
  connected: 0,
  qualified: 0,
  rdvPris: 0,
  rdvRate: 0,
  connectionRate: 0,
  qualificationRate: 0,
  ca: 0,
  signed: 0,
  total: 0,
  honored: 0,
  closing: 0,
  panier: 0,
  resultSegments: [],
  financingSegments: [],
  dailyCalls: [],
  setters: [],
  commercials: [],
}

function rangeQuery(range: AnalyticsRange) {
  return { from: range.from.toISOString(), to: range.to.toISOString() }
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

// ===== Period selector =====

function useAnalyticsPeriod(defaultMode: AnalyticsPeriodMode) {
  const [mode, setMode] = useState<AnalyticsPeriodMode>(defaultMode)
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()))
  const range = useMemo(() => buildAnalyticsRange(mode, selectedDate), [mode, selectedDate])
  return { mode, setMode, selectedDate, setSelectedDate, range }
}

function AnalyticsPeriodBar({ helper, period }: {
  helper: string
  period: ReturnType<typeof useAnalyticsPeriod>
}) {
  return (
    <div className="px-8 pt-4 flex flex-wrap items-center justify-between flex-shrink-0 gap-4">
      <div>
        <div className="text-xs text-faint font-semibold">{helper}</div>
        <div className="text-xs font-bold text-or-dark mt-1">Période : {period.range.label}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodSwitch
          value={period.mode}
          onChange={(mode) => setPeriodMode(period, mode)}
          options={[
            { id: 'today', label: "Aujourd'hui" },
            { id: 'week', label: 'Semaine' },
            { id: 'month', label: 'Mois' },
            { id: 'year', label: 'Année' },
          ]}
        />
        <PeriodCalendar period={period} />
      </div>
    </div>
  )
}

function PeriodCalendar({ period }: { period: ReturnType<typeof useAnalyticsPeriod> }) {
  const inputClass = 'h-9 rounded-xl border border-line bg-white px-3 text-xs font-semibold text-text shadow-sm outline-none focus:border-or'
  if (period.mode === 'today') {
    return <div className={`${inputClass} flex items-center`}>{formatDateInputFr(toDateInputValue(new Date()))}</div>
  }
  if (period.mode === 'month') {
    const currentMonth = toMonthInputValue(new Date())
    return (
      <input
        type="month"
        value={toMonthInputValue(parseDateInput(period.selectedDate))}
        max={currentMonth}
        onChange={(e) => setPeriodMonth(period, e.target.value)}
        className={inputClass}
        aria-label="Choisir le mois pour les analytics"
      />
    )
  }
  if (period.mode === 'year') {
    const currentYear = new Date().getFullYear()
    return (
      <input
        type="number"
        min="2000"
        max={currentYear}
        value={parseDateInput(period.selectedDate).getFullYear()}
        onChange={(e) => setPeriodYear(period, e.target.value)}
        className={`${inputClass} w-24`}
        aria-label="Choisir l'année pour les analytics"
      />
    )
  }
  return (
    <input
      type="date"
      value={period.selectedDate}
      max={toDateInputValue(new Date())}
      onChange={(e) => setPeriodDate(period, e.target.value)}
      className={inputClass}
      aria-label="Choisir une date dans la semaine pour les analytics"
    />
  )
}

function setPeriodMode(period: ReturnType<typeof useAnalyticsPeriod>, mode: AnalyticsPeriodMode) {
  period.setMode(mode)
  if (mode === 'today') period.setSelectedDate(toDateInputValue(new Date()))
}

function setPeriodDate(period: ReturnType<typeof useAnalyticsPeriod>, value: string) {
  period.setSelectedDate(clampDateInputToToday(value || toDateInputValue(new Date())))
}

function setPeriodMonth(period: ReturnType<typeof useAnalyticsPeriod>, value: string) {
  const safeValue = value || toMonthInputValue(new Date())
  const [year, month] = safeValue.split('-').map(Number)
  if (!year || !month) return
  period.setSelectedDate(clampDateInputToToday(`${year}-${String(month).padStart(2, '0')}-01`))
}

function setPeriodYear(period: ReturnType<typeof useAnalyticsPeriod>, value: string) {
  const year = Number(value)
  const currentYear = new Date().getFullYear()
  if (!year) return
  const safeYear = Math.min(Math.max(year, 2000), currentYear)
  period.setSelectedDate(clampDateInputToToday(`${safeYear}-01-01`))
}

function buildAnalyticsRange(mode: AnalyticsPeriodMode, selectedDate: string): AnalyticsRange {
  const anchor = parseDateInput(clampDateInputToToday(selectedDate))
  const todayEnd = endOfDay(new Date())
  if (mode === 'today') {
    const from = startOfDay(new Date())
    const to = minDate(endOfDay(from), todayEnd)
    return {
      from,
      to,
      label: formatDateInputFr(toDateInputValue(from)),
      days: 1,
    }
  }
  if (mode === 'week') {
    const from = startOfWeek(anchor)
    const to = minDate(endOfDay(addDays(from, 6)), todayEnd)
    return {
      from,
      to,
      label: `Semaine du ${shortDate(from)} au ${shortDate(to)}`,
      days: daysBetween(from, to),
    }
  }
  if (mode === 'month') {
    const from = startOfDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    const to = minDate(endOfDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)), todayEnd)
    return {
      from,
      to,
      label: `${anchor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} · 1-${to.getDate()}`,
      days: daysBetween(from, to),
    }
  }
  const from = startOfDay(new Date(anchor.getFullYear(), 0, 1))
  const to = minDate(endOfDay(new Date(anchor.getFullYear(), 11, 31)), todayEnd)
  return {
    from,
    to,
    label: `Année ${anchor.getFullYear()} · jusqu'au ${shortDate(to)}`,
    days: daysBetween(from, to),
  }
}

function clampDateInputToToday(value: string): string {
  const today = toDateInputValue(new Date())
  if (!value || value > today) return today
  return value
}

function parseDateInput(value: string): Date {
  if (!value) return startOfDay(new Date())
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return startOfDay(new Date())
  return startOfDay(new Date(year, month - 1, day))
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  const dow = d.getDay() || 7
  d.setDate(d.getDate() - dow + 1)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function minDate(a: Date, b: Date): Date {
  return a <= b ? a : b
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000) + 1)
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toMonthInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function formatDateInputFr(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
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

function PeriodSwitch<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
}) {
  return (
    <div className="flex bg-or-tint p-1 rounded-xl">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`px-3 py-1 text-xs font-semibold rounded-lg ${value === opt.id ? 'bg-white shadow-sm text-text' : 'text-muted'}`}
        >
          {opt.label}
        </button>
      ))}
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
