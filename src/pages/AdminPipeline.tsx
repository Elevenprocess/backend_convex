import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import {
  useLeads,
  usePipelineByCommercial,
  usePipelineDistribution,
  usePipelineStuck,
  useUsers,
  type PipelineCommercialKpi,
  type PipelineDistributionEntry,
  type PipelineStuckLead,
} from '../lib/hooks'
import type { LeadResponse, UserResponse } from '../lib/types'

type Tab = 'kanban' | 'commercials' | 'stuck'

// Ordre figé pour le rendu kanban (suit l'organisation logique du pipeline GHL).
const STAGE_ORDER: string[] = [
  '0. Nouveaux Prospects 🌱',
  '(BIS) Retour à l\'Assistant 🔙',
  '4. Qualification Commerciale 📋',
  '(BIS) Prospects Attribués 🫴',
  '(BIS) En cours de traitement',
  '5. RDV Planifié 📅',
  '🙅‍♂️ (BIS) No-Show',
  '6. RDV Annulé 🛑',
  '7. RDV Pas Qualifié ⚠️',
  '8. RDV Reprogrammé 🔁',
  '10. Devis En Attente 📝',
  '11. Devis Signé ✍️',
  '12. Devis Perdu 💔',
  '2. Suivi & Relance 🔄',
  '9. Relance Long Terme ⏳',
  '3. Pas Qualifiés ❌',
  '1. Prospects Archivés 📦',
]

export function AdminPipeline() {
  const role = useAuth((s) => s.user?.role)
  if (role && role !== 'admin') return <Navigate to="/overview" replace />

  const [tab, setTab] = useState<Tab>('kanban')

  return (
    <AppShell>
      <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <Topbar />
        <div className="px-6 pt-4 pb-2 flex items-baseline justify-between">
          <div>
            <span className="eyebrow text-[10px]">PIPELINE GHL</span>
            <h1 className="text-2xl font-black tracking-tight">Pipeline (admin)</h1>
            <p className="text-sm text-muted mt-0.5">
              Vue temps réel des opportunités GHL importées dans le SaaS.
            </p>
          </div>
          <TabSwitcher tab={tab} setTab={setTab} />
        </div>
        <div className="px-6 pb-6 flex-1 min-h-0">
          {tab === 'kanban' && <KanbanView />}
          {tab === 'commercials' && <CommercialsView />}
          {tab === 'stuck' && <StuckView />}
        </div>
      </main>
    </AppShell>
  )
}

// ─── Tabs ─────────────────────────────────────────────────

function TabSwitcher({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'kanban', label: 'Kanban' },
    { id: 'commercials', label: 'Performance' },
    { id: 'stuck', label: 'Leads stuck' },
  ]
  return (
    <div className="inline-flex rounded-full border border-line-soft bg-white p-1 gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
            tab === t.id ? 'bg-or-fonce text-white' : 'text-muted hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Kanban view ──────────────────────────────────────────

function KanbanView() {
  const { data, loading, error } = usePipelineDistribution()
  // On charge tous les leads ouverts et on les groupe client-side par ghlStageName.
  // Volume actuel ECOI : ~5000 leads avec ghl_stage_name → ~3MB JSON, OK pour admin.
  const { data: leads } = useLeads({ limit: 5000 })
  const { data: users } = useUsers()

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  const leadsByStage = useMemo(() => {
    const m = new Map<string, LeadResponse[]>()
    for (const lead of leads ?? []) {
      const key = lead.ghlStageName ?? '__null__'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(lead)
    }
    // Tri intra-colonne : plus récent d'abord
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          new Date(b.lastStageChangeAt ?? b.updatedAt).getTime() -
          new Date(a.lastStageChangeAt ?? a.updatedAt).getTime(),
      )
    }
    return m
  }, [leads])

  const sorted = useMemo(() => {
    if (!data) return []
    const byName = new Map(data.stages.map((s) => [s.ghlStageName ?? '__null__', s]))
    const ordered: PipelineDistributionEntry[] = []
    for (const name of STAGE_ORDER) {
      const entry = byName.get(name)
      if (entry) {
        ordered.push(entry)
        byName.delete(name)
      } else {
        ordered.push({ ghlStageName: name, saasStatus: null, count: 0, totalValue: 0 })
      }
    }
    // Stages inconnus en fin (futur si GHL ajoute un stage)
    for (const remaining of byName.values()) ordered.push(remaining)
    return ordered
  }, [data])

  if (loading) return <Skeleton label="Chargement du pipeline…" />
  if (error) return <ErrorBanner error={error} />
  if (!data) return null

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <KpiCard label="Leads ouverts" value={data.totalOpenLeads.toLocaleString('fr-FR')} />
        <KpiCard label="Valeur totale" value={formatCurrency(data.totalOpenValue)} />
        <KpiCard
          label="Stages utilisés"
          value={`${data.stages.filter((s) => s.count > 0).length} / ${STAGE_ORDER.length}`}
        />
      </div>
      <div className="overflow-x-auto flex-1 min-h-0 pb-2">
        <div className="flex gap-3 min-w-max h-full pb-1">
          {sorted.map((stage) => (
            <StageColumn
              key={stage.ghlStageName ?? 'null'}
              stage={stage}
              leads={leadsByStage.get(stage.ghlStageName ?? '__null__') ?? []}
              userMap={userMap}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const CARDS_PER_COLUMN = 50

function StageColumn({
  stage,
  leads,
  userMap,
}: {
  stage: PipelineDistributionEntry
  leads: LeadResponse[]
  userMap: Map<string, UserResponse>
}) {
  const navigate = useNavigate()
  const visible = leads.slice(0, CARDS_PER_COLUMN)
  const remaining = leads.length - visible.length
  return (
    <div className="w-[260px] rounded-[18px] border border-line-soft bg-cream/45 p-3 flex flex-col min-h-0">
      <div className="bg-white rounded-[14px] border border-line-soft p-3 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-black text-sm leading-tight">
            {stage.ghlStageName ?? 'Sans stage GHL'}
          </h4>
          <span className="rounded-full border border-line-soft px-2 py-0.5 text-xs font-bold text-muted shrink-0">
            {stage.count}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
          <div>
            <p className="text-faint uppercase tracking-wide text-[10px]">Leads</p>
            <p className="font-black text-base">{stage.count}</p>
          </div>
          <div>
            <p className="text-faint uppercase tracking-wide text-[10px]">Valeur</p>
            <p className="font-black text-base truncate">{formatCurrency(stage.totalValue)}</p>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 overflow-y-auto pr-1 mt-2 flex-grow min-h-0">
        {visible.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line-soft bg-white/70 p-4 text-center text-[11px] text-faint">
            Aucun lead
          </div>
        ) : (
          visible.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              commercial={lead.assignedToId ? userMap.get(lead.assignedToId) : undefined}
              onOpen={() => navigate(`/leads/${lead.id}`)}
            />
          ))
        )}
        {remaining > 0 && (
          <div className="rounded-[14px] border border-dashed border-line-soft bg-white/60 p-2 text-center text-[10px] text-faint">
            + {remaining} autre{remaining > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}

function LeadCard({
  lead,
  commercial,
  onOpen,
}: {
  lead: LeadResponse
  commercial?: UserResponse
  onOpen: () => void
}) {
  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') ||
    lead.email ||
    lead.phone ||
    'Lead'
  const value = lead.monetaryValue ? Number(lead.monetaryValue) : null
  const days = lead.daysSinceLastStageChange ?? null
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-[14px] border border-line-soft bg-white p-2.5 hover:-translate-y-0.5 hover:shadow-sm transition cursor-pointer"
      title={lead.email ?? lead.id}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-xs truncate">{name}</p>
        {value != null && value > 0 && (
          <span className="text-[10px] font-black text-text whitespace-nowrap">
            {formatCurrency(value)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted">
        <span className="truncate">{commercial?.name ?? <span className="text-rouille">Non attribué</span>}</span>
        {days != null && (
          <span
            className={`px-1.5 py-0.5 rounded-full whitespace-nowrap ${
              days >= 30 ? 'bg-rouille/10 text-rouille' : days >= 14 ? 'bg-cuivre/10 text-cuivre' : 'text-faint'
            }`}
          >
            {days}j
          </span>
        )}
      </div>
    </button>
  )
}

// ─── Commercials view ─────────────────────────────────────

function CommercialsView() {
  const { data, loading, error } = usePipelineByCommercial()
  if (loading) return <Skeleton label="Chargement des commerciaux…" />
  if (error) return <ErrorBanner error={error} />
  if (!data) return null

  return (
    <div className="rounded-[18px] border border-line-soft bg-white overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-cream/40 text-left">
          <tr className="text-[11px] uppercase tracking-wide text-muted">
            <th className="px-4 py-3 font-bold">Commercial</th>
            <th className="px-4 py-3 font-bold text-right">Leads ouverts</th>
            <th className="px-4 py-3 font-bold text-right">RDV planifiés</th>
            <th className="px-4 py-3 font-bold text-right">Devis en attente</th>
            <th className="px-4 py-3 font-bold text-right">Signés</th>
            <th className="px-4 py-3 font-bold text-right">CA</th>
            <th className="px-4 py-3 font-bold text-right">Closing rate</th>
          </tr>
        </thead>
        <tbody>
          {data.commercials.map((c) => (
            <CommercialRow key={c.userId} row={c} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CommercialRow({ row }: { row: PipelineCommercialKpi }) {
  const navigate = useNavigate()
  return (
    <tr
      onClick={() => navigate(`/team/commerciaux/${row.userId}`)}
      className="border-t border-line-soft hover:bg-cream/40 cursor-pointer"
    >
      <td className="px-4 py-3">
        <div className="font-bold">{row.name}</div>
        {!row.ghlUserId && (
          <div className="text-[10px] text-rouille">GHL non relié</div>
        )}
      </td>
      <td className="px-4 py-3 text-right font-bold">{row.openLeads}</td>
      <td className="px-4 py-3 text-right">{row.rdvPlanned}</td>
      <td className="px-4 py-3 text-right">{row.devisEnAttente}</td>
      <td className="px-4 py-3 text-right">{row.signed}</td>
      <td className="px-4 py-3 text-right font-bold">{formatCurrency(row.ca)}</td>
      <td className="px-4 py-3 text-right">{(row.closingRate * 100).toFixed(0)}%</td>
    </tr>
  )
}

// ─── Stuck view ───────────────────────────────────────────

function StuckView() {
  const [days, setDays] = useState(30)
  const { data, loading, error } = usePipelineStuck(days)
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Seuil :</span>
        {[14, 30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 text-xs rounded-full border transition ${
              days === d
                ? 'border-or-fonce bg-or-fonce text-white'
                : 'border-line-soft text-muted hover:text-foreground'
            }`}
          >
            {d}j
          </button>
        ))}
      </div>
      {loading && <Skeleton label="Calcul des leads stuck…" />}
      {error && <ErrorBanner error={error} />}
      {data && (
        <>
          <p className="text-sm text-muted">
            <span className="font-black text-foreground">{data.total}</span> leads sans mouvement depuis ≥ {days}j.
          </p>
          <div className="rounded-[18px] border border-line-soft bg-white overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-cream/40 text-left">
                <tr className="text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-bold">Lead</th>
                  <th className="px-4 py-3 font-bold">Stage GHL</th>
                  <th className="px-4 py-3 font-bold">Commercial</th>
                  <th className="px-4 py-3 font-bold text-right">Valeur</th>
                  <th className="px-4 py-3 font-bold text-right">Jours stuck</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.slice(0, 100).map((lead) => (
                  <StuckRow key={lead.leadId} lead={lead} />
                ))}
              </tbody>
            </table>
            {data.leads.length > 100 && (
              <p className="px-4 py-2 text-xs text-muted text-center bg-cream/30">
                Affichage des 100 plus anciens sur {data.leads.length}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StuckRow({ lead }: { lead: PipelineStuckLead }) {
  const navigate = useNavigate()
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email || '—'
  return (
    <tr
      onClick={() => navigate(`/leads/${lead.leadId}`)}
      className="border-t border-line-soft hover:bg-cream/40 cursor-pointer"
    >
      <td className="px-4 py-3 font-bold">{name}</td>
      <td className="px-4 py-3">{lead.ghlStageName ?? '—'}</td>
      <td className="px-4 py-3">{lead.assignedToName ?? <span className="text-rouille">Non attribué</span>}</td>
      <td className="px-4 py-3 text-right">{formatCurrency(lead.monetaryValue ?? 0)}</td>
      <td className="px-4 py-3 text-right">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            lead.daysSinceLastChange >= 90
              ? 'bg-rouille/10 text-rouille'
              : lead.daysSinceLastChange >= 60
              ? 'bg-cuivre/10 text-cuivre'
              : 'bg-muted/10 text-muted'
          }`}
        >
          {lead.daysSinceLastChange}j
        </span>
      </td>
    </tr>
  )
}

// ─── Atoms ────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-line-soft bg-white px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
      <p className="text-2xl font-black mt-1">{value}</p>
    </div>
  )
}

function Skeleton({ label }: { label: string }) {
  return <div className="text-sm text-muted py-12 text-center">{label}</div>
}

function ErrorBanner({ error }: { error: string }) {
  return <div className="text-sm text-rouille py-6">{error}</div>
}

function formatCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
