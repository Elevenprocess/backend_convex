import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Spinner } from '../components/Spinner'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useAdsReport } from '../lib/hooks'
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
  type SourceMapEntry,
  type UnmappedSource,
} from '../lib/types'
import { MagicKpi, type KpiAccent } from '../components/kpi/MagicKpi'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { DEFAULT_PERIOD, buildPeriodRange, type PeriodState } from '../lib/period'

// Les seuls canaux pour lesquels on dispose d'une dépense (Windsor.ai pull Meta
// pour l'instant). Le sélecteur reste extensible aux autres canaux ad.
const AD_CHANNELS: AdChannel[] = ['meta', 'google', 'tiktok', 'linkedin', 'microsoft']
// Les 9 valeurs du mapping admin (sources → canal normalisé).
const ALL_CHANNELS: AdChannel[] = [
  'meta', 'google', 'tiktok', 'linkedin', 'microsoft', 'organic', 'referral', 'direct', 'other',
]

type Tab = 'rapport' | 'sources'

export function Ads() {
  const role = useAuth((s) => s.user?.role)
  const isAdmin = role === 'admin'
  const [tab, setTab] = useState<Tab>('rapport')

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar eyebrow="ACQUISITION / PUBLICITÉ" title="Performance publicitaire — ROAS Meta" />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center gap-2 flex-shrink-0">
        <TabButton active={tab === 'rapport'} onClick={() => setTab('rapport')}>Rapport ROAS</TabButton>
        {isAdmin && (
          <TabButton active={tab === 'sources'} onClick={() => setTab('sources')}>Sources à classer</TabButton>
        )}
      </div>
      {tab === 'rapport' ? <AdsReportView isAdmin={isAdmin} /> : <AdsSourcesView />}
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

// ===== Rapport ROAS =====
function AdsReportView({ isAdmin }: { isAdmin: boolean }) {
  const [period, setPeriod] = useState<PeriodState>({ ...DEFAULT_PERIOD, mode: 'this_month' })
  const range = buildPeriodRange(period)
  const [channel, setChannel] = useState<AdChannel>('meta')
  const { data, loading, error, refetch } = useAdsReport({ from: range.from, to: range.to, level: 'campaign', channel })
  const [resyncState, setResyncState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [resyncMsg, setResyncMsg] = useState<string | null>(null)

  const totals = data?.totals
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !r.unmatched), [data])
  const unmatchedRows = useMemo(() => (data?.rows ?? []).filter((r) => r.unmatched), [data])

  async function handleResync() {
    setResyncState('running')
    setResyncMsg(null)
    try {
      const res = await resyncAdSpend({ from: range.from, to: range.to })
      setResyncState('done')
      setResyncMsg(res.skipped
        ? 'Sync sautée (clé Windsor absente côté serveur).'
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
          Cohorte ROAS backend /analytics/ads : {range.label}.
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
        {resyncMsg && (
          <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            resyncState === 'error'
              ? 'border-rouille/30 bg-rouille-tint/40 text-rouille'
              : 'border-success/30 bg-success-tint/40 text-success'
          }`}>
            {resyncMsg}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 lg:gap-6">
          <MagicKpi label="DÉPENSE" value={fmtEur(totals?.spend)} sub={`${fmtInt(totals?.impressions)} impressions`} accent="gold" icon="tag" />
          <MagicKpi label="LEADS" value={fmtInt(totals?.leads)} sub={`${fmtInt(totals?.clicks)} clics`} accent="info" icon="users" />
          <MagicKpi label="CPL" value={fmtEur(totals?.cpl)} sub="Coût par lead" accent="green" icon="target" />
          <MagicKpi label="CA SIGNÉ" value={fmtEur(totals?.ca)} sub={`${fmtInt(totals?.devisSignes)} devis signés`} accent="gold" icon="trophy" />
          <MagicKpi label="ROAS" value={fmtRoas(totals?.roas)} sub="CA / dépense" accent={roasAccent(totals?.roas)} icon="chart" />
          <MagicKpi label="TX SIGNATURE" value={fmtPct(totals?.tauxSignature)} sub="Devis signés / leads" accent="success" icon="check" progress={pctValue(totals?.tauxSignature)} />
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Drill-down campagne → adset → annonce</h3>
            <span className="eyebrow">cliquer une ligne pour déplier</span>
          </div>
          {loading && !data ? (
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
type SortKey = 'spend' | 'leads' | 'cpl' | 'ca' | 'roas' | 'tauxSignature'

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
      <table className="w-full text-sm min-w-[920px]">
        <thead className="bg-or-tint">
          <tr className="text-left eyebrow">
            <th className="px-3 py-2.5">CAMPAGNE / ADSET / ANNONCE</th>
            <SortableTh label="DÉPENSE" k="spend" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="LEADS" k="leads" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="CPL" k="cpl" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="CA" k="ca" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="ROAS" k="roas" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
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
              <tr><td colSpan={7} className="px-3 pt-5 pb-1 eyebrow text-rouille">⚠ Lignes non rapprochées</td></tr>
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
    return <tr><td colSpan={7} className="px-3 py-3 pl-10 text-faint"><Spinner size={16} /> Chargement {level === 'adset' ? 'des adsets' : 'des annonces'}…</td></tr>
  }
  if (error) {
    return <tr><td colSpan={7} className="px-3 py-3 pl-10 text-rouille text-xs">Erreur : {error}</td></tr>
  }
  if (children.length === 0) {
    return <tr><td colSpan={7} className="px-3 py-3 pl-10 text-faint text-xs">Aucun {level === 'adset' ? 'adset' : 'annonce'} rattaché.</td></tr>
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
              ⚠ {row.unmatched === 'spend_no_leads' ? 'dépense sans lead' : 'lead sans dépense'}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 font-semibold">{fmtEur(row.spend)}</td>
      <td className="px-3 py-2.5">{fmtInt(row.leads)}</td>
      <td className="px-3 py-2.5">{fmtEur(row.cpl)}</td>
      <td className="px-3 py-2.5 font-semibold text-or-dark">{fmtEur(row.ca)}</td>
      <td className={`px-3 py-2.5 font-bold ${roasClass(row.roas)}`}>{fmtRoas(row.roas)}</td>
      <td className="px-3 py-2.5">{fmtPct(row.tauxSignature)}</td>
    </tr>
  )
}

function SortableTh({ label, k, sortKey, sortDir, onSort }: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
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
            <p className="text-sm text-muted mt-1">Ces leads sont tombés sur « Autre ». Ajoute un mapping pour les rattacher à un canal.</p>
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
        Réappliquer aux leads existants
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

function fmtRoas(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}×`
}

function fmtPct(n: number | null | undefined): string {
  // Le backend renvoie un ratio 0..1 (tauxSignature). On l'affiche en %.
  return `${Math.round(Number(n ?? 0) * 100)}%`
}

function pctValue(n: number | null | undefined): number {
  return Math.min(100, Math.round(Number(n ?? 0) * 100))
}

// ROAS vert au-dessus de ~1, rouge en dessous.
function roasClass(roas: number | null | undefined): string {
  const v = Number(roas ?? 0)
  if (v >= 1) return 'text-success'
  return 'text-rouille'
}

function roasAccent(roas: number | null | undefined): KpiAccent {
  return Number(roas ?? 0) >= 1 ? 'success' : 'rust'
}
