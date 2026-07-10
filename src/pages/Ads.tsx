import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Spinner } from '../components/Spinner'
import { Icon, type IconName } from '../components/Icon'
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
          <MagicKpi label="PROSPECTS" value={fmtInt(totals?.leads)} sub={`${fmtInt(totals?.clicks)} clics`} accent="info" icon="users" />
          <MagicKpi label="CPL" value={fmtEur(totals?.cpl)} sub="Coût par lead" accent="green" icon="target" />
          <MagicKpi label="CA SIGNÉ" value={fmtEur(totals?.ca)} sub={`${fmtInt(totals?.devisSignes)} devis signés`} accent="gold" icon="trophy" />
          <MagicKpi label="ROAS" value={fmtRoas(totals?.roas)} sub="CA / dépense" accent={roasAccent(totals?.roas)} icon="chart" />
          <MagicKpi label="TX SIGNATURE" value={fmtPct(totals?.tauxSignature)} sub="Devis signés / prospects" accent="success" icon="check" progress={pctValue(totals?.tauxSignature)} />
        </div>

        {(rows.length > 0 || (totals?.impressions ?? 0) > 0) && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
              <div className="glass-card p-6 lg:col-span-3">
                <SectionHead icon="filter" eyebrow="ENTONNOIR D'ACQUISITION" title="Du clic au devis signé" />
                <AcquisitionFunnel totals={totals} />
              </div>
              <div className="glass-card p-6 lg:col-span-2">
                <SectionHead icon="tag" eyebrow="RÉPARTITION" title="Dépense par campagne" />
                <SpendDonut rows={rows} />
              </div>
            </div>
            {rows.length > 0 && (
              <div className="glass-card p-6">
                <SectionHead icon="trophy" eyebrow="RENTABILITÉ" title="ROAS par campagne" hint="repère vertical = seuil 1×" />
                <RoasByCampaign rows={rows} />
              </div>
            )}
          </>
        )}

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
            <SortableTh label="PROSPECTS" k="leads" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
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
              ⚠ {row.unmatched === 'spend_no_leads' ? 'dépense sans prospect' : 'prospect sans dépense'}
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

// Entonnoir tapered : Impressions → Clics → Leads → Devis signés.
const FUNNEL_COLORS = ['#6B87A0', '#3DC6FF', '#00A8E8', '#B59241']

function AcquisitionFunnel({ totals }: { totals?: AdsTotals }) {
  const stages = [
    { label: 'Impressions', value: Math.round(totals?.impressions ?? 0) },
    { label: 'Clics', value: Math.round(totals?.clicks ?? 0) },
    { label: 'Prospects', value: Math.round(totals?.leads ?? 0) },
    { label: 'Devis signés', value: Math.round(totals?.devisSignes ?? 0) },
  ]
  const maxVal = Math.max(stages[0].value, 1)
  const W = 360
  const bandH = 50
  const gap = 30
  const cx = W / 2
  const maxW = W - 40
  const widthFor = (v: number) => Math.max(12, (v / maxVal) * maxW)
  const H = stages.length * bandH + (stages.length - 1) * gap

  const conversions = [
    { label: 'CTR', sub: 'clic / impression', v: pct1(stages[1].value, stages[0].value) },
    { label: 'Conv. prospect', sub: 'prospect / clic', v: pct1(stages[2].value, stages[1].value) },
    { label: 'Signature', sub: 'devis / lead', v: pct1(stages[3].value, stages[2].value) },
  ]

  return (
    <div className="grid sm:grid-cols-[1fr_minmax(150px,200px)] gap-6 items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Entonnoir d'acquisition">
        {stages.map((s, i) => {
          const y = i * (bandH + gap)
          const topW = widthFor(s.value)
          const botW = widthFor(stages[i + 1]?.value ?? s.value)
          const points = `${cx - topW / 2},${y} ${cx + topW / 2},${y} ${cx + botW / 2},${y + bandH} ${cx - botW / 2},${y + bandH}`
          const conv = i < stages.length - 1 && s.value > 0 ? Math.round((stages[i + 1].value / s.value) * 100) : null
          return (
            <g key={s.label}>
              <polygon points={points} fill={FUNNEL_COLORS[i]} />
              <text x={cx} y={y + bandH / 2 - 3} textAnchor="middle" fill="#ffffff" fontWeight={800} fontSize={17}>{fmtInt(s.value)}</text>
              <text x={cx} y={y + bandH / 2 + 13} textAnchor="middle" fill="#ffffff" fillOpacity={0.85} fontSize={10} fontWeight={700} letterSpacing={0.4}>{s.label.toUpperCase()}</text>
              {conv != null && (
                <>
                  <rect x={cx - 30} y={y + bandH + gap / 2 - 11} width={60} height={20} rx={10} fill="var(--color-or-tint)" />
                  <text x={cx} y={y + bandH + gap / 2 + 3} textAnchor="middle" fill="var(--color-or-dark)" fontSize={11} fontWeight={800}>▾ {conv}%</text>
                </>
              )}
            </g>
          )
        })}
      </svg>

      <div className="space-y-2.5">
        {conversions.map((c) => (
          <div key={c.label} className="rounded-2xl border border-line-soft bg-white/55 px-3.5 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold">{c.label}</span>
              <span className="text-lg font-extrabold text-or-dark tabular-nums">{c.v}%</span>
            </div>
            <div className="text-[11px] text-faint">{c.sub}</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-line-soft overflow-hidden">
              <div className="h-full rounded-full bg-or" style={{ width: `${Math.min(100, c.v)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Donut : répartition de la dépense entre les 5 plus grosses campagnes + « Autres ».
const DONUT_PALETTE = ['#00A8E8', '#3DC6FF', '#B59241', '#A85D2E', '#6B87A0', '#C4D3CA']

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

// Barres classées par ROAS, colorées vert/rouille autour du seuil 1×.
function RoasByCampaign({ rows }: { rows: AdsReportRow[] }) {
  const list = useMemo(
    () => rows.filter((r) => (r.spend ?? 0) > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0)).slice(0, 8),
    [rows],
  )
  if (list.length === 0) return <ChartEmpty message="Aucune campagne avec dépense sur la période." />

  const maxRoas = Math.max(...list.map((r) => r.roas ?? 0), 2)
  const breakEven = (1 / maxRoas) * 100

  return (
    <div className="space-y-3">
      {list.map((r, i) => {
        const roas = r.roas ?? 0
        const good = roas >= 1
        const pct = Math.min(100, (roas / maxRoas) * 100)
        return (
          <div key={r.campaignId ?? r.campaign ?? i}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-sm font-semibold truncate min-w-0">{r.campaign?.trim() || '— (sans nom)'}</span>
              <span className="text-sm font-bold tabular-nums flex-shrink-0">
                <span className={good ? 'text-success' : 'text-rouille'}>{fmtRoas(roas)}</span>
                <span className="text-faint font-semibold"> · {fmtEur(r.spend)}</span>
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-line-soft overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, background: good ? '#00A8E8' : '#A85D2E' }}
              />
              <div
                className="absolute top-[-2px] bottom-[-2px] w-px bg-faint/70"
                style={{ left: `${breakEven}%` }}
                aria-hidden="true"
              />
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-4 pt-1 text-[11px] text-faint font-semibold">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: '#00A8E8' }} /> rentable (≥ 1×)</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: '#A85D2E' }} /> à perte (&lt; 1×)</span>
      </div>
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

function pct1(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0
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
