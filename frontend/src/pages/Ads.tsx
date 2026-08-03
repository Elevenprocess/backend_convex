import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Spinner } from '../components/Spinner'
import { Icon, type IconName } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useAdsReport } from '../lib/hooks'
import { useConvexSimulatorFunnel } from '../lib/convexHooks'
import type { ConvexSimulatorFunnel } from '../lib/convexApi'
import {
  fetchSourceMap,
  fetchUnmappedSources,
  resyncAdSpend,
  upsertSourceMap,
} from '../lib/api'
import {
  AD_CHANNEL_LABEL,
  type AdChannel,
  type AdsLevel,
  type AdsReport,
  type AdsReportRow,
  type AdsSeriesPoint,
  type SourceMapEntry,
  type UnmappedSource,
} from '../lib/types'
import { MagicKpi } from '../components/kpi/MagicKpi'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { DEFAULT_PERIOD, buildPeriodRange, type PeriodState } from '../lib/period'

// Les seuls canaux pour lesquels on dispose d'une dépense (Windsor.ai pull Meta
// pour l'instant). Le sélecteur reste extensible aux autres canaux ad.
const AD_CHANNELS: AdChannel[] = ['meta', 'google', 'tiktok', 'linkedin', 'microsoft']
// Les 9 valeurs du mapping admin (sources → canal normalisé).
const ALL_CHANNELS: AdChannel[] = [
  'meta', 'google', 'tiktok', 'linkedin', 'microsoft', 'organic', 'referral', 'direct', 'other',
]

type Tab = 'rapport' | 'creatives' | 'sources'

export function Ads() {
  const role = useAuth((s) => s.user?.role)
  const isAdmin = role === 'admin'
  const [tab, setTab] = useState<Tab>('rapport')

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar eyebrow="ACQUISITION / PUBLICITÉ" title="Performance publicitaire — Meta" />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center gap-2 flex-shrink-0">
        <TabButton active={tab === 'rapport'} onClick={() => setTab('rapport')}>Rapport</TabButton>
        <TabButton active={tab === 'creatives'} onClick={() => setTab('creatives')}>Performance créative</TabButton>
        {isAdmin && (
          <TabButton active={tab === 'sources'} onClick={() => setTab('sources')}>Sources à classer</TabButton>
        )}
      </div>
      {tab === 'rapport' ? <AdsReportView isAdmin={isAdmin} /> : tab === 'creatives' ? <CreativesView /> : <AdsSourcesView />}
    </AppShell>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-bold transition ${
        active ? 'bg-or-tint text-or-dark border border-or/30' : 'text-muted hover:text-text border border-transparent'
      }`}
    >
      {children}
    </button>
  )
}

// ===== Rapport =====
function AdsReportView({ isAdmin }: { isAdmin: boolean }) {
  const [period, setPeriod] = useState<PeriodState>({ ...DEFAULT_PERIOD, mode: 'this_month' })
  const range = buildPeriodRange(period)
  const [channel, setChannel] = useState<AdChannel>('meta')
  const { data, loading, error, refetch } = useAdsReport({ from: range.from, to: range.to, level: 'campaign', channel })
  const { data: simFunnel } = useConvexSimulatorFunnel({ from: range.from, to: range.to })
  const [resyncState, setResyncState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [resyncMsg, setResyncMsg] = useState<string | null>(null)

  const report = data
  // Période sans aucune donnée réelle (ni dépense, ni prospect) : état vide
  // honnête — plus de mode démo depuis que les données Meta sont live.
  const emptyPeriod =
    !loading && !error && report !== null &&
    report.rows.length === 0 &&
    (report.totals?.spend ?? 0) === 0 &&
    (report.totals?.leads ?? 0) === 0 &&
    (report.totals?.impressions ?? 0) === 0

  const totals = report?.totals
  const rows = useMemo(() => (report?.rows ?? []).filter((r) => !r.unmatched), [report])
  const unmatchedRows = useMemo(() => (report?.rows ?? []).filter((r) => r.unmatched), [report])

  // Granularité des graphes d'évolution selon la plage sélectionnée :
  // 1 jour → par heure, ≤ ~3 mois → par jour, au-delà → par mois.
  const granularity: 'hour' | 'day' | 'month' =
    range.days === 1 ? 'hour' : range.days > 92 ? 'month' : 'day'
  const displaySeries = useMemo(() => {
    const s = report?.series ?? []
    if (granularity !== 'month') return s
    const byMonth = new Map<string, AdsSeriesPoint>()
    for (const p of s) {
      const key = p.date.slice(0, 7)
      let agg = byMonth.get(key)
      if (!agg) {
        agg = { date: `${key}-01`, spend: 0, impressions: 0, clicks: 0, leads: 0, devisSignes: 0, ca: 0 }
        byMonth.set(key, agg)
      }
      agg.spend += p.spend
      agg.impressions += p.impressions
      agg.clicks += p.clicks
      agg.leads += p.leads
      agg.devisSignes += p.devisSignes
      agg.ca += p.ca
    }
    return [...byMonth.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
  }, [report, granularity])

  async function handleResync() {
    setResyncState('running')
    setResyncMsg(null)
    try {
      const res = await resyncAdSpend({ from: range.from, to: range.to })
      setResyncState('done')
      setResyncMsg(res.skipped
        ? 'Sync sautée (aucune source de dépense configurée côté serveur).'
        : `${res.synced} lignes synchronisées · ${res.totalSpend} € de dépense.`)
      refetch()
    } catch (e) {
      setResyncState('error')
      setResyncMsg(e instanceof Error ? e.message : 'Échec de la resynchronisation.')
    }
  }

  return (
    <>
      <div className="px-4 sm:px-6 md:px-8 pt-3 flex items-center justify-between gap-2 sm:gap-4 flex-shrink-0 flex-wrap">
        <div className="text-xs text-faint font-semibold">
          Cohorte : {range.label}.
          {loading && <InlineLoading />}
          {error ? ` Erreur: ${error}` : ''}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-faint">Canal</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as AdChannel)}
              className="rounded-xl border border-line-soft bg-white/70 px-3 py-1.5 text-sm font-semibold"
            >
              {AD_CHANNELS.map((c) => (
                <option key={c} value={c}>{AD_CHANNEL_LABEL[c]}</option>
              ))}
            </select>
          </label>
          {isAdmin && (
            <button
              type="button"
              onClick={handleResync}
              disabled={resyncState === 'running'}
              className="inline-flex items-center gap-1.5 rounded-xl border border-or/30 bg-or-tint px-3 py-1.5 text-sm font-bold text-or-dark disabled:opacity-60"
            >
              {resyncState === 'running' ? <Spinner size={14} stroke={3} color="currentColor" /> : <Icon name="download" size={14} />}
              Resync dépense
            </button>
          )}
          <DateRangePicker value={period} onChange={setPeriod} align="right" />
        </div>
      </div>

      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
        {emptyPeriod && (
          <div className="rounded-2xl border border-line-soft bg-white/60 px-4 py-3 text-sm font-semibold text-muted">
            Aucune donnée publicitaire sur cette période. La dépense Meta se synchronise chaque
            nuit (03h10, heure Réunion) — les chiffres d'aujourd'hui apparaîtront demain matin.
          </div>
        )}
        {resyncMsg && (
          <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            resyncState === 'error'
              ? 'border-rouille/30 bg-rouille-tint/40 text-rouille'
              : 'border-success/30 bg-success-tint/40 text-success'
          }`}>
            {resyncMsg}
          </div>
        )}

        <PeriodKpis totals={totals} simFunnel={simFunnel} />

        {granularity === 'hour'
          ? (report?.hourly?.some((h) => h.leads > 0) ?? false) && (
              <div className="glass-card p-6">
                <SectionHead
                  icon="chart"
                  eyebrow="ÉVOLUTION"
                  title="Prospects par heure"
                  hint="heure Réunion — la dépense Meta n'existe qu'à la journée"
                />
                <HourlyLeadsChart hourly={report!.hourly!} />
              </div>
            )
          : displaySeries.some((p) => p.spend > 0 || p.leads > 0) && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
                <div className="glass-card p-6">
                  <SectionHead
                    icon="chart"
                    eyebrow="ÉVOLUTION"
                    title={granularity === 'month' ? 'Dépense & prospects par mois' : 'Dépense & prospects par jour'}
                  />
                  <DailySpendLeadsChart series={displaySeries} monthly={granularity === 'month'} />
                </div>
                <div className="glass-card p-6">
                  <SectionHead icon="trophy" eyebrow="RENTABILITÉ CUMULÉE" title="Dépense vs CA signé (cumulés)" hint="le CA passe au-dessus = campagne rentable" />
                  <CumulativeRoasChart series={displaySeries} monthly={granularity === 'month'} />
                </div>
              </div>
            )}

        {(rows.length > 0 || (totals?.impressions ?? 0) > 0) && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
              <div className="glass-card p-6 lg:col-span-3">
                <SectionHead icon="filter" eyebrow="ENTONNOIR D'ACQUISITION" title="Du clic au devis signé" />
                <AcquisitionFunnel totals={totals} />
              </div>
              <div className="glass-card p-6 lg:col-span-2">
                <SectionHead icon="tag" eyebrow="RÉPARTITION" title="Dépense par campagne" />
                {/* Lignes non rapprochées incluses : la dépense d'une campagne
                    existe même quand aucun prospect n'a pu lui être rattaché. */}
                <SpendDonut rows={[...rows, ...unmatchedRows]} />
              </div>
            </div>
          </>
        )}

        {simFunnel?.hasData && (
          <div className="glass-card p-6">
            <SectionHead
              icon="filter"
              eyebrow="TUNNEL SIMULATEUR"
              title="Du clic pub à l'arrivée en prospect"
              hint="sessions du simulateur solaire, cohorte par jour d'arrivée"
            />
            <SimulatorFunnel funnel={simFunnel} clicks={totals?.clicks} leads={totals?.leads} />
          </div>
        )}
        {isAdmin && simFunnel !== null && !simFunnel?.hasData && (
          <div className="rounded-2xl border border-line-soft bg-white/60 px-4 py-3 text-sm font-semibold text-muted">
            Tunnel simulateur : aucune donnée synchronisée sur la période — la clé Supabase du
            simulateur doit être configurée côté serveur pour activer cette section.
          </div>
        )}

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Drill-down campagne → adset → annonce</h3>
            <span className="eyebrow">cliquer une ligne pour déplier</span>
          </div>
          {loading && !report ? (
            <div className="py-10 text-center text-faint"><Spinner size={28} /> Chargement…</div>
          ) : rows.length === 0 && unmatchedRows.length === 0 ? (
            <div className="rounded-3xl border border-line-soft bg-white/60 p-8 text-center text-muted">
              Aucune donnée publicitaire sur cette période.
            </div>
          ) : (
            <AdsTable rows={rows} unmatchedRows={unmatchedRows} from={range.from} to={range.to} channel={channel} />
          )}
        </div>
      </main>
    </>
  )
}

// ===== Table avec dépliage in-place =====
type SortKey = 'spend' | 'leads' | 'cpl' | 'ca' | 'tauxSignature'

function AdsTable({ rows, unmatchedRows, from, to, channel }: {
  rows: AdsReportRow[]
  unmatchedRows: AdsReportRow[]
  from: string
  to: string
  channel: AdChannel
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('spend')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      return sortDir === 'desc' ? vb - va : va - vb
    })
    return arr
  }, [rows, sortKey, sortDir])

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[840px]">
        <thead className="bg-or-tint">
          <tr className="text-left eyebrow">
            <th className="px-3 py-2.5">CAMPAGNE / ADSET / ANNONCE</th>
            <SortableTh label="DÉPENSE" k="spend" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="PROSPECTS" k="leads" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="CPL" k="cpl" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="CA" k="ca" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="TX SIGN." k="tauxSignature" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <CampaignRows
              key={`c:${row.campaignId ?? row.campaign ?? ''}`}
              row={row}
              expanded={expanded}
              onToggle={toggle}
              from={from}
              to={to}
              channel={channel}
            />
          ))}
          {unmatchedRows.length > 0 && (
            <>
              <tr><td colSpan={6} className="px-3 pt-5 pb-1 eyebrow text-rouille">⚠ Lignes non rapprochées</td></tr>
              {unmatchedRows.map((row, i) => (
                <DataRow key={`u:${row.campaignId ?? row.campaign ?? i}`} row={row} depth={0} unmatched />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}

// Une campagne (niveau 0) +, si dépliée, ses adsets (fetch level=adset).
function CampaignRows({ row, expanded, onToggle, from, to, channel }: {
  row: AdsReportRow
  expanded: Set<string>
  onToggle: (id: string) => void
  from: string
  to: string
  channel: AdChannel
}) {
  const id = `c:${row.campaignId ?? row.campaign ?? ''}`
  const open = expanded.has(id)
  return (
    <>
      <DataRow row={row} depth={0} expandable open={open} onClick={() => onToggle(id)} />
      {open && (
        <ChildLevel
          parent={row}
          level="adset"
          from={from}
          to={to}
          channel={channel}
          expanded={expanded}
          onToggle={onToggle}
        />
      )}
    </>
  )
}

// Charge les enfants (adset ou ad) d'une ligne parente et les rend.
function ChildLevel({ parent, level, from, to, channel, expanded, onToggle }: {
  parent: AdsReportRow
  level: AdsLevel
  from: string
  to: string
  channel: AdChannel
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const { data, loading, error } = useAdsReport({ from, to, level, channel })
  const children = useMemo(() => filterChildren(data, parent, level), [data, parent, level])

  if (loading && !data) {
    return <tr><td colSpan={6} className="px-3 py-3 pl-10 text-faint"><Spinner size={16} /> Chargement {level === 'adset' ? 'des adsets' : 'des annonces'}…</td></tr>
  }
  if (error) {
    return <tr><td colSpan={6} className="px-3 py-3 pl-10 text-rouille text-xs">Erreur : {error}</td></tr>
  }
  if (children.length === 0) {
    return <tr><td colSpan={6} className="px-3 py-3 pl-10 text-faint text-xs">Aucun {level === 'adset' ? 'adset' : 'annonce'} rattaché.</td></tr>
  }

  return (
    <>
      {children.map((child, i) => {
        if (level === 'adset') {
          const childId = `a:${parent.campaignId ?? parent.campaign}:${child.adsetId ?? child.adset ?? i}`
          const open = expanded.has(childId)
          return (
            <span key={childId} style={{ display: 'contents' }}>
              <DataRow row={child} depth={1} expandable open={open} onClick={() => onToggle(childId)} />
              {open && (
                <ChildLevel
                  parent={child}
                  level="ad"
                  from={from}
                  to={to}
                  channel={channel}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              )}
            </span>
          )
        }
        return <DataRow key={`ad:${child.adId ?? child.ad ?? i}`} row={child} depth={2} />
      })}
    </>
  )
}

// Garde les lignes enfant rattachées au parent : match par ID si présent, sinon
// par nom (mirroir de la stratégie de fusion backend).
function filterChildren(data: AdsReport | null, parent: AdsReportRow, level: AdsLevel): AdsReportRow[] {
  if (!data) return []
  return data.rows.filter((r) => {
    if (r.unmatched) return false
    if (level === 'adset' || level === 'ad') {
      if (parent.campaignId && r.campaignId) {
        if (parent.campaignId !== r.campaignId) return false
      } else if ((parent.campaign ?? '') !== (r.campaign ?? '')) {
        return false
      }
    }
    if (level === 'ad') {
      // parent est un adset : restreindre aux annonces de cet adset
      if (parent.adsetId && r.adsetId) return parent.adsetId === r.adsetId
      return (parent.adset ?? '') === (r.adset ?? '')
    }
    return true
  })
}

function DataRow({ row, depth, expandable = false, open = false, onClick, unmatched = false }: {
  row: AdsReportRow
  depth: number
  expandable?: boolean
  open?: boolean
  onClick?: () => void
  unmatched?: boolean
}) {
  const name = row.level === 'campaign' ? row.campaign : row.level === 'adset' ? row.adset : row.ad
  const padLeft = 12 + depth * 22
  return (
    <tr
      className={`border-b border-line-soft last:border-0 ${expandable ? 'cursor-pointer hover:bg-or-tint/30' : ''} ${unmatched ? 'bg-rouille-tint/20' : ''}`}
      onClick={onClick}
    >
      <td className="px-3 py-2.5" style={{ paddingLeft: padLeft }}>
        <div className="flex items-center gap-2">
          {expandable ? (
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-faint flex-shrink-0" />
          ) : <span className="w-[14px] flex-shrink-0" />}
          <span className={depth === 0 ? 'font-bold' : depth === 1 ? 'font-semibold' : ''}>
            {name?.trim() || '— (sans nom)'}
          </span>
          {unmatched && (
            <span className="ml-2 inline-flex items-center rounded-full bg-rouille-tint px-2 py-0.5 text-[10px] font-bold text-rouille">
              ⚠ {row.unmatched === 'spend_no_leads' ? 'dépense sans prospect' : 'prospect sans dépense'}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 font-semibold">{fmtEur(row.spend)}</td>
      <td className="px-3 py-2.5">{fmtInt(row.leads)}</td>
      <td className="px-3 py-2.5">{fmtEur(row.cpl)}</td>
      <td className="px-3 py-2.5 font-semibold text-or-dark">{fmtEur(row.ca)}</td>
      <td className="px-3 py-2.5">{fmtPct(row.tauxSignature)}</td>
    </tr>
  )
}

function SortableTh<K extends string>({ label, k, sortKey, sortDir, onSort }: {
  label: string
  k: K
  sortKey: K
  sortDir: 'asc' | 'desc'
  onSort: (k: K) => void
}) {
  const active = sortKey === k
  return (
    <th className="px-3 py-2.5">
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 ${active ? 'text-or-dark' : ''}`}>
        {label}
        <span className="text-[10px]">{active ? (sortDir === 'desc' ? '▾' : '▴') : ''}</span>
      </button>
    </th>
  )
}

// ===== KPI de période : les 3 chiffres qui comptent (réunion 2026-08-03) ====
// Dépense · Nouveaux prospects · CPL. Impressions/clics restent lisibles dans
// l'entonnoir d'acquisition, les arrivées au formulaire dans le tunnel
// simulateur. Le KPI prospects affiche les prospects réellement arrivés dans
// Velora, pas les envois de formulaire (doublons/échecs : ~868 envois pour
// 601 prospects en juillet).

function PeriodKpis({ totals, simFunnel }: {
  totals?: AdsTotals
  simFunnel: ConvexSimulatorFunnel | null
}) {
  const spend = totals?.spend ?? 0
  const leads = totals?.leads ?? 0
  const formSubmits = simFunnel?.formSubmits ?? 0

  // La donnée simulateur couvre la période quand il y a au moins autant
  // d'envois que de nouveaux prospects. Écart envois − nouveaux = contacts
  // déjà dans Velora qui ont refait une simulation (GHL déduplique par
  // téléphone/email, pas de nouvelle fiche) — rien n'est perdu.
  const simCovers = formSubmits > 0 && formSubmits >= leads
  const alreadyKnown = simCovers ? formSubmits - leads : 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
      <MagicKpi
        label="DÉPENSE"
        value={fmtEur(spend)}
        sub="sur la période"
        accent="gold"
        icon="tag"
      />
      <MagicKpi
        label="NOUVEAUX PROSPECTS"
        value={fmtInt(leads)}
        sub={simCovers
          ? alreadyKnown > 0
            ? `${fmtInt(formSubmits)} envois · ${fmtInt(alreadyKnown)} déjà connus`
            : `${fmtInt(formSubmits)} formulaires envoyés`
          : 'arrivés dans Velora'}
        accent="success"
        icon="check"
        tooltip={simCovers && alreadyKnown > 0
          ? `${fmtInt(formSubmits)} formulaires envoyés sur la période : ${fmtInt(leads)} nouvelles personnes → ${fmtInt(leads)} fiches créées dans Velora. Les ${fmtInt(alreadyKnown)} autres étaient des contacts DÉJÀ dans Velora qui ont refait une simulation : GHL reconnaît leur téléphone/email et met à jour leur fiche existante au lieu de créer un doublon. Rien n'est perdu — ces retours sont marqués « re-simulation » dans la liste des leads et repassent « à rappeler » s'ils étaient perdus ou sans réponse.`
          : `Prospects réellement créés dans Velora sur la période. Un envoi de formulaire d'un contact déjà connu ne crée pas de doublon : sa fiche existante est mise à jour et marquée « re-simulation ».`}
        {...(simCovers ? { progress: Math.min(100, Math.round((leads / formSubmits) * 100)) } : {})}
      />
      <MagicKpi
        label="CPL"
        value={leads > 0 ? fmtEurCents(spend / leads) : '—'}
        sub="dépense / nouveaux prospects"
        accent="info"
        icon="target"
        tooltip="Coût par lead : la dépense publicitaire de la période divisée par le nombre de nouveaux prospects arrivés dans Velora."
      />
    </div>
  )
}

// ===== Performance créative =================================================
// Rentabilité PAR créative (réunion 2026-08-03) : une créative peut générer
// beaucoup de leads mais peu de RDV — leads, RDV planifiés et ventes comptent
// donc autant que le CPL. Rattachement leads ↔ créatives : adId GHL ou, à
// défaut, le nom (utm_content posé dans les publicités Meta).

type CreativeSortKey = 'spend' | 'leads' | 'cpl' | 'rdvs' | 'devisSignes' | 'ca'

function CreativesView() {
  const [period, setPeriod] = useState<PeriodState>({ ...DEFAULT_PERIOD, mode: 'this_month' })
  const range = buildPeriodRange(period)
  const { data, loading, error } = useAdsReport({ from: range.from, to: range.to, level: 'ad', channel: 'meta' })
  const [sortKey, setSortKey] = useState<CreativeSortKey>('rdvs')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Les prospects sans créative identifiable (pas d'adId ni d'utm_content —
  // typiquement les pubs d'avant les paramètres UTM) ne sont PAS une créative :
  // on les sort du tableau et on les résume dans un encart dédié.
  const { rows, orphan } = useMemo(() => {
    const all = (data?.rows ?? []).filter((r) => (r.spend ?? 0) > 0 || r.leads > 0)
    const named = all.filter((r) => r.ad?.trim())
    named.sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      if (vb !== va) return sortDir === 'desc' ? vb - va : va - vb
      return (b.leads ?? 0) - (a.leads ?? 0)
    })
    const orphan = all
      .filter((r) => !r.ad?.trim())
      .reduce(
        (acc, r) => ({
          leads: acc.leads + r.leads,
          rdvs: acc.rdvs + r.rdvs,
          devisSignes: acc.devisSignes + r.devisSignes,
          ca: acc.ca + r.ca,
        }),
        { leads: 0, rdvs: 0, devisSignes: 0, ca: 0 },
      )
    return { rows: named, orphan }
  }, [data, sortKey, sortDir])

  const onSort = (key: CreativeSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  return (
    <>
      <div className="px-4 sm:px-6 md:px-8 pt-3 flex items-center justify-between gap-2 sm:gap-4 flex-shrink-0 flex-wrap">
        <div className="text-xs text-faint font-semibold">
          Cohorte : {range.label}.
          {loading && <InlineLoading />}
          {error ? ` Erreur: ${error}` : ''}
        </div>
        <DateRangePicker value={period} onChange={setPeriod} align="right" />
      </div>

      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
        <div className="glass-card p-6">
          <SectionHead
            icon="trophy"
            eyebrow="RENTABILITÉ PAR CRÉATIVE"
            title="Quelle publicité rapporte vraiment ?"
            hint="prospects, RDV et ventes rattachés à chaque créative"
          />
          {loading && !data ? (
            <div className="py-10 text-center text-faint"><Spinner size={28} /> Chargement…</div>
          ) : rows.length === 0 && orphan.leads === 0 ? (
            <div className="rounded-3xl border border-line-soft bg-white/60 p-8 text-center text-muted">
              Aucune créative sur cette période. Les prospects se rattachent aux créatives via
              les paramètres UTM (utm_content) des publicités Meta — configurés sur les
              prochaines campagnes, les données apparaîtront avec les nouveaux prospects.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-or-tint">
                  <tr className="text-left eyebrow">
                    <th className="px-3 py-2.5">CRÉATIVE</th>
                    <SortableTh label="DÉPENSE" k="spend" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="PROSPECTS" k="leads" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="CPL" k="cpl" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="RDV" k="rdvs" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <th className="px-3 py-2.5">TX RDV</th>
                    <SortableTh label="VENTES" k="devisSignes" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                    <SortableTh label="CA" k="ca" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => <CreativeRow key={`${r.adId ?? r.ad ?? i}`} row={r} />)}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">
                      Aucun prospect rattaché à une créative sur cette période.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {orphan.leads > 0 && (
          <div className="rounded-2xl border border-line-soft bg-white/60 px-4 py-3 text-sm font-semibold text-muted">
            <span className="font-extrabold text-text">{fmtInt(orphan.leads)} prospect{orphan.leads > 1 ? 's' : ''} sans créative identifiée</span>
            {' '}({fmtInt(orphan.rdvs)} RDV · {fmtInt(orphan.devisSignes)} vente{orphan.devisSignes > 1 ? 's' : ''} · {fmtEur(orphan.ca)} de CA) —
            arrivés sans utm_content ni identifiant d'annonce. Les paramètres UTM ajoutés aux
            publicités Meta le 03/08 rattacheront les prochains prospects à leur créative.
          </div>
        )}
      </main>
    </>
  )
}

function CreativeRow({ row }: { row: AdsReportRow }) {
  const context = [row.campaign, row.adset].filter((s) => s?.trim()).join(' · ')
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-3 py-2.5">
        <div className="font-bold">{row.ad?.trim() || '— (sans nom)'}</div>
        {context && <div className="text-[11px] text-faint truncate max-w-[280px]" title={context}>{context}</div>}
      </td>
      <td className="px-3 py-2.5 font-semibold">{fmtEur(row.spend)}</td>
      <td className="px-3 py-2.5">{fmtInt(row.leads)}</td>
      <td className="px-3 py-2.5">{row.spend > 0 && row.leads > 0 ? fmtEurCents(row.cpl) : '—'}</td>
      <td className="px-3 py-2.5 font-semibold">{fmtInt(row.rdvs)}</td>
      <td className="px-3 py-2.5 text-muted">{row.leads > 0 ? pctFine(row.rdvs, row.leads) : '—'}</td>
      <td className="px-3 py-2.5">{fmtInt(row.devisSignes)}</td>
      <td className="px-3 py-2.5 font-semibold text-or-dark">{fmtEur(row.ca)}</td>
    </tr>
  )
}

// ===== Sources à classer (admin) =====
function AdsSourcesView() {
  const [unmapped, setUnmapped] = useState<UnmappedSource[] | null>(null)
  const [mapping, setMapping] = useState<SourceMapEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [u, m] = await Promise.all([fetchUnmappedSources(), fetchSourceMap()])
      setUnmapped(u)
      setMapping(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Charge au montage.
  useEffect(() => { void reload() }, [reload])

  return (
    <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
      {error && (
        <div className="rounded-2xl border border-rouille/30 bg-rouille-tint/40 px-4 py-3 text-sm font-semibold text-rouille">{error}</div>
      )}

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="eyebrow">SOURCES NON CLASSÉES</span>
            <h3 className="text-xl font-extrabold mt-1">Sources GHL brutes sans canal</h3>
            <p className="text-sm text-muted mt-1">Ces prospects sont tombés sur « Autre ». Ajoute un mapping pour les rattacher à un canal.</p>
          </div>
          <button type="button" onClick={() => void reload()} className="inline-flex items-center gap-1.5 rounded-xl border border-line-soft bg-white/70 px-3 py-1.5 text-sm font-bold">
            <Icon name="download" size={14} /> Rafraîchir
          </button>
        </div>
        {loading && !unmapped ? (
          <div className="py-8 text-center text-faint"><Spinner size={24} /> Chargement…</div>
        ) : (unmapped?.length ?? 0) === 0 ? (
          <div className="rounded-3xl border border-line-soft bg-white/60 p-8 text-center text-muted">Aucune source à classer 🎉</div>
        ) : (
          <div className="space-y-2">
            {unmapped!.map((u) => (
              <UnmappedRow key={u.raw} source={u} onSaved={() => void reload()} />
            ))}
          </div>
        )}
      </div>

      <div className="glass-card p-6">
        <h3 className="font-bold mb-4">Mappings existants</h3>
        {loading && !mapping ? (
          <div className="py-6 text-center text-faint"><Spinner size={20} /></div>
        ) : (mapping?.length ?? 0) === 0 ? (
          <div className="text-sm text-faint">Aucun mapping enregistré.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-or-tint">
                <tr className="text-left eyebrow">
                  <th className="px-3 py-2.5">SOURCE BRUTE</th>
                  <th className="px-3 py-2.5">LIBELLÉ</th>
                  <th className="px-3 py-2.5">CANAL</th>
                </tr>
              </thead>
              <tbody>
                {mapping!.map((m) => (
                  <tr key={m.id} className="border-b border-line-soft last:border-0">
                    <td className="px-3 py-2.5 font-semibold">{m.rawSource}</td>
                    <td className="px-3 py-2.5">{m.label}</td>
                    <td className="px-3 py-2.5">{AD_CHANNEL_LABEL[m.channel]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}

function UnmappedRow({ source, onSaved }: { source: UnmappedSource; onSaved: () => void }) {
  const [channel, setChannel] = useState<AdChannel>('meta')
  const [label, setLabel] = useState(source.raw)
  const [reapply, setReapply] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      await upsertSourceMap({ rawSource: source.raw, channel, label: label.trim() || source.raw, reapply })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Échec de l’enregistrement.')
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-line-soft bg-white/65 p-3 flex flex-wrap items-center gap-3">
      <div className="min-w-[160px]">
        <div className="font-bold">{source.raw || '— (vide)'}</div>
        <div className="text-xs text-faint">{source.n} lead{source.n > 1 ? 's' : ''}</div>
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Libellé"
        className="rounded-xl border border-line-soft bg-white/80 px-3 py-1.5 text-sm flex-1 min-w-[140px]"
      />
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value as AdChannel)}
        className="rounded-xl border border-line-soft bg-white/80 px-3 py-1.5 text-sm font-semibold"
      >
        {ALL_CHANNELS.map((c) => (
          <option key={c} value={c}>{AD_CHANNEL_LABEL[c]}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <input type="checkbox" checked={reapply} onChange={(e) => setReapply(e.target.checked)} />
        Réappliquer aux prospects existants
      </label>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-xl border border-or/30 bg-or-tint px-3 py-1.5 text-sm font-bold text-or-dark disabled:opacity-60"
      >
        {saving ? <Spinner size={14} stroke={3} color="currentColor" /> : <Icon name="plus" size={14} />}
        Classer
      </button>
      {err && <span className="text-xs text-rouille w-full">{err}</span>}
    </div>
  )
}

// ===== Visualisations (dérivées des totals + rows, aucun appel back en plus) =====

type AdsTotals = AdsReport['totals']

function SectionHead({ icon, eyebrow, title, hint }: {
  icon: IconName
  eyebrow: string
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-or-tint text-or-dark flex-shrink-0">
          <Icon name={icon} size={18} />
        </span>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3 className="font-extrabold leading-tight">{title}</h3>
        </div>
      </div>
      {hint && <span className="eyebrow text-faint text-right whitespace-nowrap">{hint}</span>}
    </div>
  )
}

// ── Graphes d'évolution (série quotidienne ads:report.series) ───────────────
// Palette alignée sur le thème Velora (cf. TerrainMonthlyChart).
const CHART_SPEND = '#B59241'   // cuivre — dépense
const CHART_LEADS = '#1F7857'   // vert forêt — prospects
const CHART_CA = '#3E9A6F'      // vert clair — CA signé
const CHART_GRID = '#E1EBE3'
const CHART_TICK = '#5E7264'

function chartDayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`
}

function chartMonthLabel(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(0, 4)}`
}

type SeriesTooltipEntry = { name: string; value: number; color?: string; stroke?: string; fill?: string }

function SeriesTooltip({ active, payload, label, euros }: {
  active?: boolean
  payload?: SeriesTooltipEntry[]
  label?: string
  euros: Set<string>
}) {
  if (!active || !payload?.length) return null
  // CPL du point survolé quand dépense et prospects sont tous deux tracés
  // (graphe « Dépense & prospects ») — demandé en réunion 2026-08-03.
  const spendEntry = payload.find((e) => e.name === 'Dépense')
  const leadsEntry = payload.find((e) => e.name === 'Prospects')
  const cpl = spendEntry && leadsEntry && leadsEntry.value > 0
    ? spendEntry.value / leadsEntry.value
    : null
  return (
    <div style={{
      background: 'var(--color-card, #fff)',
      border: '1px solid #DCE8DE',
      borderRadius: 10,
      padding: '9px 13px',
      fontSize: 12,
      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11, letterSpacing: '0.04em' }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color ?? entry.stroke ?? entry.fill, flexShrink: 0 }} />
          <span style={{ color: CHART_TICK }}>{entry.name}</span>
          <span style={{ fontWeight: 700, marginLeft: 'auto' }}>
            {euros.has(entry.name) ? fmtEur(entry.value) : fmtInt(entry.value)}
          </span>
        </div>
      ))}
      {cpl != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 4, borderTop: '1px solid #ECF2ED' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#A85D2E', flexShrink: 0 }} />
          <span style={{ color: CHART_TICK }}>CPL</span>
          <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{fmtEurCents(cpl)}</span>
        </div>
      )}
    </div>
  )
}

// Barres dépense (€) + courbe prospects, axes gauche/droite.
function DailySpendLeadsChart({ series, monthly = false }: { series: AdsSeriesPoint[]; monthly?: boolean }) {
  const rows = useMemo(
    () => series.map((p) => ({ ...p, day: monthly ? chartMonthLabel(p.date) : chartDayLabel(p.date) })),
    [series, monthly],
  )
  return (
    <div>
      <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis yAxisId="spend" tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${Math.round(v)} €`} />
          <YAxis yAxisId="leads" orientation="right" allowDecimals={false} tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} width={30} />
          <Tooltip content={<SeriesTooltip euros={new Set(['Dépense'])} />} cursor={{ fill: 'rgba(181, 146, 65, 0.08)' }} />
          <Bar yAxisId="spend" dataKey="spend" name="Dépense" fill={CHART_SPEND} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line yAxisId="leads" type="monotone" dataKey="leads" name="Prospects" stroke={CHART_LEADS} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: 'Dépense (€)', color: CHART_SPEND }, { label: monthly ? 'Prospects / mois' : 'Prospects / jour', color: CHART_LEADS }]} />
    </div>
  )
}

// Répartition horaire des prospects (plage d'un seul jour). La dépense Meta
// n'existant qu'à la journée, seul le volume de prospects est ventilé.
function HourlyLeadsChart({ hourly }: { hourly: Array<{ hour: number; leads: number }> }) {
  const rows = useMemo(
    () => hourly.map((h) => ({ ...h, day: `${String(h.hour).padStart(2, '0')}h` })),
    [hourly],
  )
  return (
    <div>
      <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} width={30} />
          <Tooltip content={<SeriesTooltip euros={new Set()} />} cursor={{ fill: 'rgba(31, 120, 87, 0.08)' }} />
          <Bar dataKey="leads" name="Prospects" fill={CHART_LEADS} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: 'Prospects / heure', color: CHART_LEADS }]} />
    </div>
  )
}

// Aires cumulées dépense vs CA signé : le croisement matérialise le seuil de
// rentabilité (ROAS 1×) dans le temps.
function CumulativeRoasChart({ series, monthly = false }: { series: AdsSeriesPoint[]; monthly?: boolean }) {
  const rows = useMemo(() => {
    let cumSpend = 0
    let cumCa = 0
    return series.map((p) => {
      cumSpend += p.spend
      cumCa += p.ca
      return { day: monthly ? chartMonthLabel(p.date) : chartDayLabel(p.date), cumSpend: Math.round(cumSpend), cumCa: Math.round(cumCa) }
    })
  }, [series, monthly])
  return (
    <div>
      <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="adsCumSpend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_SPEND} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_SPEND} stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="adsCumCa" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_CA} stopOpacity={0.4} />
              <stop offset="100%" stopColor={CHART_CA} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`} />
          <Tooltip content={<SeriesTooltip euros={new Set(['Dépense cumulée', 'CA signé cumulé'])} />} />
          <Area type="monotone" dataKey="cumSpend" name="Dépense cumulée" stroke={CHART_SPEND} strokeWidth={2} fill="url(#adsCumSpend)" />
          <Area type="monotone" dataKey="cumCa" name="CA signé cumulé" stroke={CHART_CA} strokeWidth={2.5} fill="url(#adsCumCa)" />
        </AreaChart>
      </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ label: 'Dépense cumulée', color: CHART_SPEND }, { label: 'CA signé cumulé', color: CHART_CA }]} />
    </div>
  )
}

function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex items-center gap-4 pt-1 text-[11px] text-faint font-semibold">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} /> {it.label}
        </span>
      ))}
    </div>
  )
}

// Entonnoir à paliers ordinaux : la largeur marque l'ORDRE des étapes, pas les
// volumes — avec 4 ordres de grandeur entre impressions et devis, toute largeur
// proportionnelle s'écrase en filet illisible. Les volumes = les chiffres ;
// l'info utile = les taux de conversion entre paliers, en vraie précision
// (l'ancien arrondi entier affichait « 2 % » pour un CTR réel de 1,7 %).
const FUNNEL_RAMP = ['#8ABB9E', '#5FA37F', '#3B8A62', '#1F7857'] // rampe ordinale 1 teinte, light→dark
const FUNNEL_WIDTHS = ['100%', '86%', '72%', '58%']

// Pourcentage fin : 2 décimales sous 1 %, 1 décimale sous 10 %, entier au-delà.
function pctFine(a: number, b: number): string {
  if (b <= 0) return '—'
  const p = (a / b) * 100
  const digits = p >= 10 || p === 0 ? 0 : p < 1 ? 2 : 1
  return `${p.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`
}

function AcquisitionFunnel({ totals }: { totals?: AdsTotals }) {
  const stages = [
    { label: 'Impressions', sub: 'annonces affichées (Meta)', value: Math.round(totals?.impressions ?? 0) },
    { label: 'Clics', sub: 'clics sur l’annonce', value: Math.round(totals?.clicks ?? 0) },
    { label: 'Prospects', sub: 'nouveaux contacts (Velora)', value: Math.round(totals?.leads ?? 0) },
    { label: 'Devis signés', sub: 'dossiers signés', value: Math.round(totals?.devisSignes ?? 0) },
  ]
  const bridges = ['taux de clic (CTR)', 'clic → prospect', 'prospect → devis signé']

  return (
    <div className="max-w-lg mx-auto pt-1" role="img" aria-label="Entonnoir d'acquisition, du clic au devis signé">
      {stages.map((s, i) => (
        <div key={s.label}>
          <div
            className="mx-auto rounded-2xl border border-line-soft bg-white/55 px-4 py-3 flex items-center justify-between gap-3"
            style={{ width: FUNNEL_WIDTHS[i], borderLeft: `4px solid ${FUNNEL_RAMP[i]}` }}
          >
            <div className="min-w-0">
              <div className="text-[11px] font-extrabold tracking-wider text-muted">{s.label.toUpperCase()}</div>
              <div className="text-[11px] text-faint truncate">{s.sub}</div>
            </div>
            <div className="text-xl sm:text-2xl font-extrabold tabular-nums whitespace-nowrap">{fmtInt(s.value)}</div>
          </div>
          {i < stages.length - 1 && (
            <div className="flex items-center justify-center gap-2 py-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-or-tint px-2.5 py-0.5 text-[11px] font-extrabold text-or-dark tabular-nums">
                ▾ {pctFine(stages[i + 1].value, s.value)}
              </span>
              <span className="text-[11px] text-faint font-semibold">{bridges[i]}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Tunnel simulateur : barres horizontales clic pub → session → étapes → envoi →
// prospect. Les étapes sont dynamiques (une barre par étape atteinte ≥ 2, la
// session démarrant à l'étape 1). En démo ads, clics/prospects sont fictifs :
// on n'affiche alors que la partie simulateur (données réelles).
function SimulatorFunnel({ funnel, clicks, leads }: {
  funnel: ConvexSimulatorFunnel
  clicks?: number
  leads?: number
}) {
  const stages: Array<{ label: string; value: number; sub?: string }> = []
  if ((clicks ?? 0) > 0) stages.push({ label: 'Clics pub', value: Math.round(clicks!), sub: 'Meta' })
  stages.push({ label: 'Arrivées simulateur', value: funnel.sessions, sub: 'sessions' })
  // La dernière étape du simulateur = le formulaire de coordonnées : on la
  // nomme explicitement (réunion 2026-08-03) au lieu d'un « Étape N » opaque.
  funnel.stepSessions.forEach((n, i) => {
    if (n === 0) return
    const isLast = i === funnel.stepSessions.length - 1
    stages.push({ label: isLast ? 'Arrivée au formulaire' : `Étape ${i + 1} atteinte`, value: n })
  })
  stages.push({ label: 'Formulaire envoyé', value: funnel.formSubmits })
  // « Nouveaux » : un contact déjà connu de GHL qui refait une simulation ne
  // recrée pas de fiche — l'écart avec « Formulaire envoyé » vient de là.
  if ((leads ?? 0) > 0) stages.push({ label: 'Nouveaux prospects', value: Math.round(leads!), sub: 'dans Velora' })

  const maxVal = Math.max(...stages.map((s) => s.value), 1)
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : 0
        const conv = i > 0 && prev > 0 ? Math.round((s.value / prev) * 100) : null
        return (
          <div key={s.label} className="grid grid-cols-[minmax(140px,180px)_1fr_64px] items-center gap-3">
            <div className="text-sm font-bold truncate">
              {s.label}
              {s.sub && <span className="ml-1.5 text-[11px] text-faint font-semibold">{s.sub}</span>}
            </div>
            <div className="h-6 rounded-lg bg-line-soft/60 overflow-hidden">
              <div
                className="h-full rounded-lg bg-or flex items-center px-2"
                style={{ width: `${Math.max(4, (s.value / maxVal) * 100)}%` }}
              >
                <span className="text-[11px] font-extrabold text-white tabular-nums">{fmtInt(s.value)}</span>
              </div>
            </div>
            <div className="text-right text-sm font-extrabold text-or-dark tabular-nums">
              {conv != null ? `${conv}%` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Donut : répartition de la dépense entre les 5 plus grosses campagnes + « Autres ».
const DONUT_PALETTE = ['#1F7857', '#3E9A6F', '#B59241', '#A85D2E', '#6B8C7C', '#C4D3CA']

function SpendDonut({ rows }: { rows: AdsReportRow[] }) {
  const sorted = useMemo(
    () => rows.filter((r) => (r.spend ?? 0) > 0).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)),
    [rows],
  )
  const segments = useMemo(() => {
    const top = sorted.slice(0, 5).map((r, i) => ({
      label: r.campaign?.trim() || '— (sans nom)',
      value: r.spend ?? 0,
      color: DONUT_PALETTE[i],
    }))
    const rest = sorted.slice(5).reduce((s, r) => s + (r.spend ?? 0), 0)
    if (rest > 0) top.push({ label: 'Autres', value: rest, color: DONUT_PALETTE[5] })
    return top
  }, [sorted])
  const total = segments.reduce((s, x) => s + x.value, 0)

  if (segments.length === 0 || total === 0) {
    return <ChartEmpty message="Aucune dépense rattachée à une campagne." />
  }

  const R = 90
  const r = 56
  return (
    <div className="grid grid-cols-[150px_1fr] sm:grid-cols-[170px_1fr] gap-5 items-center">
      <div className="relative w-[150px] h-[150px] sm:w-[170px] sm:h-[170px] mx-auto">
        <svg viewBox="-100 -100 200 200" className="w-full h-full -rotate-90">
          {segments.length === 1 ? (
            <>
              <path d={arcPath(R, r, 0, Math.PI)} fill={segments[0].color} />
              <path d={arcPath(R, r, Math.PI, 2 * Math.PI)} fill={segments[0].color} />
            </>
          ) : (() => {
            let acc = 0
            return segments.map((s) => {
              const a0 = (acc / total) * 2 * Math.PI
              acc += s.value
              const a1 = (acc / total) * 2 * Math.PI
              return <path key={s.label} d={arcPath(R, r, a0, a1)} fill={s.color} stroke="var(--color-line-soft)" strokeWidth={1.5} />
            })
          })()}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-lg font-extrabold leading-none tabular-nums">{fmtEur(total)}</div>
          <div className="eyebrow mt-1">dépense</div>
        </div>
      </div>
      <ul className="space-y-1.5 min-w-0">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <i className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <span className="font-semibold truncate flex-1 min-w-0">{s.label}</span>
            <span className="font-bold tabular-nums flex-shrink-0">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-white/50 p-6 text-center text-sm text-muted">{message}</div>
  )
}

// Secteur de donut (repris du pattern DebriefAnalytics), repère 0 = 3h, sens horaire.
function polarXY(radius: number, angle: number): [number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}
function arcPath(outer: number, inner: number, a0: number, a1: number): string {
  const [sx, sy] = polarXY(outer, a1)
  const [ex, ey] = polarXY(outer, a0)
  const [isx, isy] = polarXY(inner, a1)
  const [iex, iey] = polarXY(inner, a0)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return [
    'M', sx, sy,
    'A', outer, outer, 0, large, 0, ex, ey,
    'L', iex, iey,
    'A', inner, inner, 0, large, 1, isx, isy,
    'Z',
  ].join(' ')
}

// ===== Helpers d'affichage =====
function InlineLoading() {
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-or-tint/70 border border-or/20 px-2 py-0.5 text-or-dark shadow-sm">
      <Spinner size={14} stroke={3} color="currentColor" />
      <span className="font-extrabold">Chargement…</span>
    </span>
  )
}

function fmtInt(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString('fr-FR')
}

function fmtEur(n: number | null | undefined): string {
  return `${Math.round(Number(n ?? 0)).toLocaleString('fr-FR')} €`
}

// Montants unitaires (CPL) : les centimes comptent — 2,62 € ≠ 3 €.
function fmtEurCents(n: number | null | undefined): string {
  return `${Number(n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function fmtPct(n: number | null | undefined): string {
  // Le backend renvoie un ratio 0..1 (tauxSignature). On l'affiche en %.
  return `${Math.round(Number(n ?? 0) * 100)}%`
}

