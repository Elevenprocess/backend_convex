import { useMemo, useState, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import { useCallLogs, useLeads, useRdvList, useUsers } from '../lib/hooks'
import { CALL_RESULT_LABEL, type CallLogResponse, type CallResult, type LeadResponse, type RdvResponse, type UserResponse } from '../lib/types'

const QUALIFIED_STATUSES = new Set(['qualifie', 'rdv_pris', 'rdv_honore', 'signe'])
const CLASSIFIED_STATUSES = new Set(['qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu', 'relance', 'pas_qualifie', 'a_rappeler', 'pas_de_reponse'])
const COLORS = ['#D4AF37', '#B87333', '#3DA86A', '#6B7C8C', '#B7410E', '#2F4858']

type AnalyticsPeriodMode = 'today' | 'date' | 'week' | 'month' | 'year'
type AnalyticsRange = { from: Date; to: Date; label: string; days: number }


export function Analytics() {
  const me = useAuth((s) => s.user)

  if (me?.role === 'admin') return <AnalyticsAdmin />
  if (me?.role === 'commercial') return <AnalyticsCommercial name={me.name} userId={me.id} />
  return <AnalyticsSetter name={me?.name ?? 'Setter'} userId={me?.id} />
}

// ----- F11 Setter -----
function AnalyticsSetter({ name, userId }: { name: string; userId?: string }) {
  const period = useAnalyticsPeriod('month')
  const days = period.range.days
  const { data: leads = [] } = useLeads({ limit: 3000 })
  const { data: calls = [] } = useCallLogs(userId ? { setterId: userId, limit: 3000 } : { limit: 3000 })
  const { data: rdvs = [] } = useRdvList(userId ? { setterId: userId, limit: 1000 } : { limit: 1000 })

  const stats = useMemo(() => buildSetterStats(leads ?? [], calls ?? [], rdvs ?? [], userId, period.range), [leads, calls, rdvs, userId, period.range])

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
function AnalyticsCommercial({ name, userId }: { name: string; userId: string }) {
  const period = useAnalyticsPeriod('month')
  const { data: rdvs = [] } = useRdvList({ commercialId: userId, limit: 1000 })
  const stats = useMemo(() => buildCommercialStats(rdvs ?? [], period.range), [rdvs, period.range])

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
  const { data: leads = [] } = useLeads({ limit: 5000 })
  const { data: calls = [] } = useCallLogs({ limit: 5000 })
  const { data: rdvs = [] } = useRdvList({ limit: 2000 })
  const { data: users = [] } = useUsers()
  const stats = useMemo(() => buildAdminStats(leads ?? [], calls ?? [], rdvs ?? [], users ?? [], period.range), [leads, calls, rdvs, users, period.range])

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

// ===== Analytics ETL/OLAP helpers =====

type Segment = { label: string; value: number; color: string }
type SetterPerf = { id: string; name: string; initials: string; calls: number; connected: number; classified: number; qualified: number; rdvPris: number; efficiency: number }
type CommercialPerf = { id: string; name: string; initials: string; honored: number; signed: number; closing: number; panier: number; ca: number }

function buildSetterStats(leads: LeadResponse[], calls: CallLogResponse[], rdvs: RdvResponse[], setterId: string | undefined, range: AnalyticsRange) {
  const days = range.days
  const scopedCalls = filterRange(calls, range)
  const scopedLeads = leads.filter((l) => belongsToSetter(l, setterId) && isInRange(l.updatedAt, range))
  const classifiedLeads = scopedLeads.filter(isClassifiedLead)
  const syntheticCalls = Math.max(0, classifiedLeads.length - scopedCalls.length)
  const resultCounts = countResults(scopedCalls)
  addSyntheticResults(resultCounts, classifiedLeads, syntheticCalls)
  const callsTotal = scopedCalls.length + syntheticCalls
  const connected = (resultCounts.joint ?? 0) + (resultCounts.rdv_pris ?? 0)
  const rdvPris = Math.max(resultCounts.rdv_pris ?? 0, rdvs.filter((r) => isInRange(r.createdAt, range)).length, classifiedLeads.filter((l) => l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length)
  const qualified = classifiedLeads.filter(isQualifiedLead).length
  return {
    calls: callsTotal,
    loggedCalls: scopedCalls.length,
    syntheticCalls,
    callsPerDay: days ? Math.round(callsTotal / days) : 0,
    classified: classifiedLeads.length,
    unclassified: scopedLeads.length - classifiedLeads.length,
    connected,
    qualified,
    rdvPris,
    connectionRate: pct(connected, callsTotal),
    qualificationRate: pct(qualified, callsTotal),
    rdvRate: pct(rdvPris, callsTotal),
    resultSegments: resultSegments(resultCounts),
    dailyCalls: dailyLogicalCalls(scopedCalls, classifiedLeads, range),
  }
}

function buildCommercialStats(rdvs: RdvResponse[], range: AnalyticsRange) {
  const scoped = filterRange(rdvs, range, (r) => r.scheduledAt)
  const honored = scoped.filter((r) => r.status === 'honore')
  const signed = honored.filter((r) => r.result === 'signe')
  const ca = signed.reduce((sum, r) => sum + money(r.montantTotal), 0)
  return {
    total: scoped.length,
    honored: honored.length,
    signed: signed.length,
    ca,
    panier: signed.length ? ca / signed.length : 0,
    closing: pct(signed.length, honored.length),
    resultSegments: pieFromCounts([
      ['Signé', signed.length],
      ['Réflexion', honored.filter((r) => r.result === 'reflexion').length],
      ['Perdu', honored.filter((r) => r.result === 'perdu').length],
      ['No-show', scoped.filter((r) => r.status === 'no_show').length],
      ['Reporté', scoped.filter((r) => r.status === 'reporte').length],
    ]),
    financingSegments: pieFromCounts([
      ['Comptant', signed.filter((r) => r.financingType === 'comptant').length],
      ['Financement', signed.filter((r) => r.financingType === 'financement').length],
      ['À définir', signed.filter((r) => !r.financingType).length],
    ]),
  }
}

function buildAdminStats(leads: LeadResponse[], calls: CallLogResponse[], rdvs: RdvResponse[], users: UserResponse[], range: AnalyticsRange) {
  const scopedLeads = leads.filter((l) => isInRange(l.updatedAt, range))
  const scopedCalls = filterRange(calls, range)
  const scopedRdvs = filterRange(rdvs, range, (r) => r.scheduledAt)
  const classifiedLeads = scopedLeads.filter(isClassifiedLead)
  const syntheticCalls = Math.max(0, classifiedLeads.length - scopedCalls.length)
  const resultCounts = countResults(scopedCalls)
  addSyntheticResults(resultCounts, classifiedLeads, syntheticCalls)
  const callsTotal = scopedCalls.length + syntheticCalls
  const qualified = classifiedLeads.filter(isQualifiedLead).length
  const rdvPris = Math.max(resultCounts.rdv_pris ?? 0, scopedLeads.filter((l) => l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length)
  const honored = scopedRdvs.filter((r) => r.status === 'honore')
  const signed = honored.filter((r) => r.result === 'signe')
  const ca = signed.reduce((sum, r) => sum + money(r.montantTotal), 0)
  return {
    calls: callsTotal,
    classified: classifiedLeads.length,
    qualified,
    unclassified: scopedLeads.length - classifiedLeads.length,
    syntheticCalls,
    rdvPris,
    rdvRate: pct(rdvPris, callsTotal),
    qualificationRate: pct(qualified, callsTotal),
    ca,
    signed: signed.length,
    resultSegments: resultSegments(resultCounts),
    setters: buildSetterRows(scopedLeads, scopedCalls, scopedRdvs, users),
    commercials: buildCommercialRows(scopedRdvs, users),
  }
}

function buildSetterRows(leads: LeadResponse[], calls: CallLogResponse[], _rdvs: RdvResponse[], users: UserResponse[]): SetterPerf[] {
  return users
    .filter((u) => u.role === 'setter')
    .map((u) => {
      const ownLeads = leads.filter((l) => belongsToSetter(l, u.id))
      const classified = ownLeads.filter(isClassifiedLead)
      const ownCalls = calls.filter((c) => c.setterId === u.id)
      const synthetic = Math.max(0, classified.length - ownCalls.length)
      const counts = countResults(ownCalls)
      addSyntheticResults(counts, classified, synthetic)
      const callsTotal = ownCalls.length + synthetic
      const connected = (counts.joint ?? 0) + (counts.rdv_pris ?? 0)
      const qualified = classified.filter(isQualifiedLead).length
      const rdvPris = Math.max(counts.rdv_pris ?? 0, classified.filter((l) => l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length)
      return { id: u.id, name: u.name, initials: initialsFromName(u.name), calls: callsTotal, connected, classified: classified.length, qualified, rdvPris, efficiency: pct(qualified + rdvPris, callsTotal) }
    })
    .sort((a, b) => b.calls - a.calls)
}

function buildCommercialRows(rdvs: RdvResponse[], users: UserResponse[]): CommercialPerf[] {
  return users
    .filter((u) => u.role === 'commercial')
    .map((u) => {
      const honored = rdvs.filter((r) => r.commercialId === u.id && r.status === 'honore')
      const signed = honored.filter((r) => r.result === 'signe')
      const ca = signed.reduce((sum, r) => sum + money(r.montantTotal), 0)
      return { id: u.id, name: u.name, initials: initialsFromName(u.name), honored: honored.length, signed: signed.length, closing: pct(signed.length, honored.length), panier: signed.length ? ca / signed.length : 0, ca }
    })
    .filter((p) => p.honored > 0 || p.signed > 0)
    .sort((a, b) => b.ca - a.ca)
}

function belongsToSetter(lead: LeadResponse, setterId: string | undefined): boolean {
  if (!setterId) return true
  return lead.setterId === setterId || lead.assignedSetterIds.includes(setterId)
}

function isClassifiedLead(lead: LeadResponse) {
  return CLASSIFIED_STATUSES.has(lead.status)
}

function isQualifiedLead(lead: LeadResponse) {
  return QUALIFIED_STATUSES.has(lead.status)
}

function countResults(calls: CallLogResponse[]): Record<CallResult, number> {
  const counts = { joint: 0, non_joint: 0, rappel_planifie: 0, rdv_pris: 0, refus: 0, injoignable: 0, messagerie: 0 }
  for (const call of calls) counts[call.result] += 1
  return counts
}

function addSyntheticResults(counts: Record<CallResult, number>, leads: LeadResponse[], maxToAdd: number) {
  if (maxToAdd <= 0) return
  for (const lead of leads.slice(0, maxToAdd)) {
    counts[statusToResult(lead.status)] += 1
  }
}

function statusToResult(status: LeadResponse['status']): CallResult {
  if (status === 'rdv_pris' || status === 'rdv_honore' || status === 'signe') return 'rdv_pris'
  if (status === 'qualifie') return 'joint'
  if (status === 'a_rappeler' || status === 'relance') return 'rappel_planifie'
  if (status === 'pas_de_reponse') return 'non_joint'
  if (status === 'pas_qualifie' || status === 'perdu') return 'refus'
  return 'non_joint'
}

function resultSegments(counts: Record<CallResult, number>): Segment[] {
  return pieFromCounts((Object.keys(counts) as CallResult[]).map((key) => [CALL_RESULT_LABEL[key], counts[key]]))
}

function pieFromCounts(rows: [string, number][]): Segment[] {
  return rows.filter(([, value]) => value > 0).map(([label, value], i) => ({ label, value, color: COLORS[i % COLORS.length] }))
}

function dailyLogicalCalls(calls: CallLogResponse[], classified: LeadResponse[], range: AnalyticsRange): number[] {
  const keys = dayKeys(range)
  return keys.map((day) => {
    const logged = calls.filter((c) => c.calledAt.slice(0, 10) === day).length
    const classifs = classified.filter((l) => l.updatedAt.slice(0, 10) === day).length
    return Math.max(logged, classifs)
  })
}

function filterRange<T>(rows: T[], range: AnalyticsRange, getIso: (row: T) => string = (row) => (row as { calledAt?: string; updatedAt?: string }).calledAt ?? (row as { updatedAt: string }).updatedAt): T[] {
  return rows.filter((row) => isInRange(getIso(row), range))
}

function isInRange(iso: string, range: AnalyticsRange): boolean {
  const d = new Date(iso)
  return d >= range.from && d <= range.to
}

function dayKeys(range: AnalyticsRange): string[] {
  const keys: string[] = []
  const d = startOfDay(range.from)
  while (d <= range.to) {
    keys.push(toDateInputValue(d))
    d.setDate(d.getDate() + 1)
  }
  return keys
}

function pct(num: number, denom: number): number {
  if (denom <= 0) return 0
  return Math.min(100, Math.round((num / denom) * 100))
}

function money(value: string | null): number {
  return parseFloat(value ?? '0') || 0
}

function fmtInt(n: number): string {
  return n.toLocaleString('fr-FR')
}

function fmtKEur(val: number): string {
  if (val === 0) return '0€'
  if (val >= 1000) return `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k€`
  return `${Math.round(val)}€`
}

function initialsFromName(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '??'
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
          onChange={period.setMode}
          options={[
            { id: 'today', label: "Aujourd'hui" },
            { id: 'date', label: 'Date' },
            { id: 'week', label: 'Semaine' },
            { id: 'month', label: 'Mois' },
            { id: 'year', label: 'Année' },
          ]}
        />
        <input
          type="date"
          value={period.selectedDate}
          max={toDateInputValue(new Date())}
          onChange={(e) => setPeriodDate(period, e.target.value)}
          className="h-9 rounded-xl border border-line bg-white px-3 text-xs font-semibold text-text shadow-sm outline-none focus:border-or"
          aria-label="Choisir une date pour les analytics"
        />
      </div>
    </div>
  )
}

function setPeriodDate(period: ReturnType<typeof useAnalyticsPeriod>, value: string) {
  period.setSelectedDate(clampDateInputToToday(value || toDateInputValue(new Date())))
  if (period.mode === 'today') period.setMode('date')
}

function buildAnalyticsRange(mode: AnalyticsPeriodMode, selectedDate: string): AnalyticsRange {
  const anchor = parseDateInput(clampDateInputToToday(selectedDate))
  const todayEnd = endOfDay(new Date())
  if (mode === 'today' || mode === 'date') {
    const from = startOfDay(mode === 'today' ? new Date() : anchor)
    const to = minDate(endOfDay(from), todayEnd)
    return {
      from,
      to,
      label: mode === 'today' ? "Aujourd'hui" : from.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
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
