import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'
import {
  runPipelineBackfill,
  useLeads,
  useRdvList,
  usePipelineByCommercial,
  usePipelineDistribution,
  usePipelineStuck,
  useUsers,
  type PipelineBackfillSummary,
  type PipelineCommercialKpi,
  type PipelineDistributionEntry,
  type PipelineStuckLead,
} from '../lib/hooks'
import type { LeadResponse, RdvResponse, UserResponse } from '../lib/types'

type Tab = 'tracking' | 'kanban' | 'commercials' | 'stuck'

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

  const [tab, setTab] = useState<Tab>('tracking')

  return (
    <AppShell>
      <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <Topbar />
        <div className="px-6 pt-4 pb-2 flex items-baseline justify-between">
          <div>
            <span className="eyebrow text-[10px]">PIPELINE GHL</span>
            <h1 className="text-2xl font-black tracking-tight">Pipeline (admin)</h1>
            <p className="text-sm text-muted mt-0.5">
              Tracking admin des commerciaux : RDV, évolution prospect, debriefs et blocages.
            </p>
          </div>
          <TabSwitcher tab={tab} setTab={setTab} />
        </div>
        <div className="px-6 pb-6 flex-1 min-h-0">
          {tab === 'tracking' && <TrackingView />}
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
    { id: 'tracking', label: 'Tracking' },
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


// ─── Tracking commerciaux ──────────────────────────────────

type TrackingFilter = 'all' | 'today' | 'missingDebrief' | 'signed' | 'blocked'

type CommercialTracking = {
  userId: string
  name: string
  image: string | null
  ghlUserId: string | null
  rdvs: RdvResponse[]
  prospects: number
  planned: number
  done: number
  signed: number
  noShow: number
  missingDebrief: number
  ca: number
}

function TrackingView() {
  const [filter, setFilter] = useState<TrackingFilter>('all')
  const [selectedCommercialId, setSelectedCommercialId] = useState<string>('all')
  const { data: rdvs, loading: rdvLoading, error: rdvError } = useRdvList({ limit: 200 })
  const { data: leads, loading: leadsLoading, error: leadsError } = useLeads({ limit: 2000 })
  const { data: users } = useUsers()

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const lead of leads ?? []) m.set(lead.id, lead)
    return m
  }, [leads])

  const commercials = useMemo<CommercialTracking[]>(() => {
    const commercialUsers = (users ?? []).filter((u) => u.role === 'commercial' || u.team === 'closing')
    const ids = new Set<string>(commercialUsers.map((u) => u.id))
    for (const rdv of rdvs ?? []) if (rdv.commercialId) ids.add(rdv.commercialId)

    return Array.from(ids)
      .map((userId) => {
        const user = userMap.get(userId)
        const list = (rdvs ?? [])
          .filter((rdv) => rdv.commercialId === userId)
          .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
        const prospectIds = new Set(list.map((rdv) => rdv.leadId))
        return {
          userId,
          name: user?.name ?? 'Commercial non relié',
          image: user?.image ?? null,
          ghlUserId: user?.ghlUserId ?? null,
          rdvs: list,
          prospects: prospectIds.size,
          planned: list.filter((r) => r.status === 'planifie' || r.status === 'reporte').length,
          done: list.filter((r) => r.status === 'honore').length,
          signed: list.filter((r) => r.result === 'signe').length,
          noShow: list.filter((r) => r.status === 'no_show' || r.result === 'no_show').length,
          missingDebrief: list.filter((r) => needsDebrief(r)).length,
          ca: list.reduce((sum, r) => sum + Number(r.montantTotal ?? 0), 0),
        }
      })
      .filter((c) => c.rdvs.length > 0 || commercialUsers.some((u) => u.id === c.userId))
      .sort((a, b) => b.rdvs.length - a.rdvs.length || a.name.localeCompare(b.name))
  }, [rdvs, users, userMap])

  const filteredRdvs = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const end = start + 24 * 60 * 60 * 1000
    return (rdvs ?? [])
      .filter((rdv) => selectedCommercialId === 'all' || rdv.commercialId === selectedCommercialId)
      .filter((rdv) => {
        const t = new Date(rdv.scheduledAt).getTime()
        if (filter === 'today') return t >= start && t < end
        if (filter === 'missingDebrief') return needsDebrief(rdv)
        if (filter === 'signed') return rdv.result === 'signe'
        if (filter === 'blocked') {
          const lead = leadMap.get(rdv.leadId)
          return (lead?.daysSinceLastStageChange ?? 0) >= 14 || rdv.status === 'no_show' || rdv.result === 'perdu'
        }
        return true
      })
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
  }, [rdvs, selectedCommercialId, filter, leadMap])

  const totals = useMemo(() => {
    const allRdvs = rdvs ?? []
    return {
      rdvs: allRdvs.length,
      prospects: new Set(allRdvs.map((r) => r.leadId)).size,
      missingDebrief: allRdvs.filter((r) => needsDebrief(r)).length,
      signed: allRdvs.filter((r) => r.result === 'signe').length,
    }
  }, [rdvs])

  if (rdvLoading || leadsLoading) return <Skeleton label="Chargement du tracking commercial…" />
  if (rdvError) return <ErrorBanner error={rdvError} />
  if (leadsError) return <ErrorBanner error={leadsError} />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <KpiCard label="RDV suivis" value={totals.rdvs.toLocaleString('fr-FR')} />
        <KpiCard label="Prospects uniques" value={totals.prospects.toLocaleString('fr-FR')} />
        <KpiCard label="Debriefs à faire" value={totals.missingDebrief.toLocaleString('fr-FR')} />
        <KpiCard label="Signés" value={totals.signed.toLocaleString('fr-FR')} />
      </div>

      <div className="rounded-[18px] border border-line-soft bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-faint">Mode d’emploi</p>
            <h2 className="text-lg font-black">1. Choisis un commercial → 2. lis ses RDV et debriefs</h2>
            <p className="text-xs text-muted mt-1 max-w-3xl">
              À gauche : les commerciaux avec leurs compteurs. À droite : chaque RDV du commercial sélectionné,
              avec le stage du prospect, le résultat, le montant et les notes de debrief.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'Tous'],
              ['today', 'Aujourd’hui'],
              ['missingDebrief', 'Debrief manquant'],
              ['signed', 'Signés'],
              ['blocked', 'À débloquer'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id as TrackingFilter)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  filter === id ? 'border-or-fonce bg-or-fonce text-white' : 'border-line-soft text-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-3 max-h-[calc(100vh-360px)] min-h-[360px] overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setSelectedCommercialId('all')}
            className={`w-full rounded-[18px] border p-3 text-left transition ${
              selectedCommercialId === 'all' ? 'border-or-fonce bg-or-fonce/5' : 'border-line-soft bg-white hover:bg-cream/40'
            }`}
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-black text-sm">Tous les commerciaux</p>
                <p className="text-xs text-muted">Vue consolidée de tous les RDV</p>
              </div>
              <span className="text-xl font-black">{totals.rdvs}</span>
            </div>
          </button>
          {commercials.map((commercial) => (
            <CommercialTrackingCard
              key={commercial.userId}
              commercial={commercial}
              selected={selectedCommercialId === commercial.userId}
              onSelect={() => setSelectedCommercialId(commercial.userId)}
            />
          ))}
        </div>

        <div className="rounded-[18px] border border-line-soft bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-line-soft flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-faint">RDV du commercial sélectionné</p>
              <h3 className="font-black">Évolution prospect + debrief</h3>
              <p className="text-xs text-muted mt-0.5">Clique sur un prospect pour ouvrir sa fiche complète.</p>
            </div>
            <span className="text-xs font-bold text-muted">{filteredRdvs.length} RDV</span>
          </div>
          <div className="divide-y divide-line-soft max-h-[calc(100vh-360px)] min-h-[360px] overflow-y-auto">
            {filteredRdvs.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted">Aucun RDV dans ce filtre.</div>
            ) : (
              filteredRdvs.map((rdv) => (
                <TrackingRdvRow
                  key={rdv.id}
                  rdv={rdv}
                  lead={leadMap.get(rdv.leadId)}
                  commercial={rdv.commercialId ? userMap.get(rdv.commercialId) : undefined}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CommercialTrackingCard({
  commercial,
  selected,
  onSelect,
}: {
  commercial: CommercialTracking
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[18px] border p-3 text-left transition ${
        selected ? 'border-or-fonce bg-or-fonce/5' : 'border-line-soft bg-white hover:bg-cream/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-full bg-cream border border-line-soft overflow-hidden flex items-center justify-center font-black text-sm shrink-0">
          {commercial.image ? <img src={commercial.image} alt="" className="h-full w-full object-cover" /> : initials(commercial.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-black truncate">{commercial.name}</p>
              <p className="text-[10px] text-muted">{commercial.ghlUserId ? 'GHL relié' : 'GHL non relié'}</p>
            </div>
            {commercial.missingDebrief > 0 && (
              <span className="rounded-full bg-rouille/10 text-rouille px-2 py-0.5 text-[10px] font-black whitespace-nowrap">
                {commercial.missingDebrief} debrief
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 text-center">
            <MiniStat label="RDV" value={commercial.rdvs.length} />
            <MiniStat label="Prospects" value={commercial.prospects} />
            <MiniStat label="Signés" value={commercial.signed} />
            <MiniStat label="CA" value={formatCompactCurrency(commercial.ca)} />
          </div>
        </div>
      </div>
    </button>
  )
}

function TrackingRdvRow({
  rdv,
  lead,
  commercial,
}: {
  rdv: RdvResponse
  lead?: LeadResponse
  commercial?: UserResponse
}) {
  const navigate = useNavigate()
  const name = leadName(lead) || 'Prospect'
  const days = lead?.daysSinceLastStageChange ?? null
  const debriefMissing = needsDebrief(rdv)
  const hasDebrief = Boolean(rdv.debriefFilledAt || rdv.notes?.trim())
  return (
    <div className="p-4 hover:bg-cream/30 transition">
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
        <button type="button" onClick={() => navigate(`/leads/${rdv.leadId}`)} className="text-left min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-sm truncate">{name}</p>
            <StatusPill label={rdvStatusLabel(rdv.status)} tone={rdv.status === 'honore' ? 'green' : rdv.status === 'no_show' || rdv.status === 'annule' ? 'red' : 'neutral'} />
            {rdv.result && <StatusPill label={rdvResultLabel(rdv.result)} tone={rdv.result === 'signe' ? 'green' : rdv.result === 'perdu' ? 'red' : 'neutral'} />}
            {debriefMissing && <StatusPill label="Debrief à faire" tone="red" />}
          </div>
          <p className="text-xs text-muted mt-1">
            {formatDateTime(rdv.scheduledAt)} · {commercial?.name ?? 'Commercial non attribué'}
          </p>
        </button>
        <div className="text-left lg:text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wide text-faint">Montant</p>
          <p className="font-black">{formatCurrency(Number(rdv.montantTotal ?? 0))}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="rounded-[14px] border border-line-soft bg-cream/30 p-3">
          <p className="text-[10px] uppercase tracking-wide text-faint">Évolution prospect</p>
          <p className="text-sm font-bold mt-1">{lead?.ghlStageName ?? 'Stage GHL non renseigné'}</p>
          <p className="text-xs text-muted mt-1">
            SaaS : {lead?.status ?? '—'}{days != null ? ` · ${days}j sans mouvement stage` : ''}
          </p>
        </div>
        <div className="rounded-[14px] border border-line-soft bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-faint">Debrief / notes</p>
          <p className={`text-sm mt-1 ${hasDebrief ? 'text-foreground' : 'text-muted italic'}`}>
            {hasDebrief ? compactText(rdv.notes ?? 'Debrief renseigné', 150) : 'Aucun debrief renseigné'}
          </p>
          {rdv.debriefDueAt && !rdv.debriefFilledAt && (
            <p className="text-[11px] text-rouille mt-1">À compléter avant {formatDateTime(rdv.debriefDueAt)}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[12px] bg-cream/45 border border-line-soft px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-faint">{label}</p>
      <p className="font-black text-sm">{value}</p>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'red' | 'neutral' }) {
  const cls = tone === 'green' ? 'bg-success-tint text-success' : tone === 'red' ? 'bg-rouille/10 text-rouille' : 'bg-cream text-muted'
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${cls}`}>{label}</span>
}

function needsDebrief(rdv: RdvResponse) {
  return (rdv.status === 'honore' || rdv.result != null) && !rdv.debriefFilledAt && !rdv.notes?.trim()
}

function leadName(lead?: LeadResponse) {
  if (!lead) return ''
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email || lead.phone || ''
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'C'
}

function compactText(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function rdvStatusLabel(status: RdvResponse['status']) {
  return {
    planifie: 'Planifié',
    honore: 'Honoré',
    no_show: 'No-show',
    reporte: 'Reporté',
    annule: 'Annulé',
  }[status]
}

function rdvResultLabel(result: NonNullable<RdvResponse['result']>) {
  return {
    signe: 'Signé',
    reflexion: 'Réflexion',
    perdu: 'Perdu',
    no_show: 'No-show',
    reporte: 'Reporté',
  }[result]
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatCompactCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { notation: 'compact', style: 'currency', currency: 'EUR', maximumFractionDigits: 1 })
}

// ─── Kanban view ──────────────────────────────────────────

function KanbanView() {
  const { data, loading, error, refetch } = usePipelineDistribution()
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
      <BackfillPanel onSuccess={refetch} />
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

// ─── Backfill GHL ─────────────────────────────────────────
// Render free n'expose pas le Shell, donc on déclenche le backfill via
// l'endpoint admin. Idempotent : peut être relancé sans risque.

function BackfillPanel({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState<'dry' | 'run' | null>(null)
  const [summary, setSummary] = useState<PipelineBackfillSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const trigger = async (dryRun: boolean) => {
    if (busy) return
    setBusy(dryRun ? 'dry' : 'run')
    setError(null)
    try {
      const result = await runPipelineBackfill({ dryRun })
      setSummary(result)
      if (!dryRun) onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-[18px] border border-line-soft bg-white px-4 py-3 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-faint">Sync GHL → SaaS</p>
          <p className="text-sm font-bold mt-0.5">Backfill des opportunités</p>
          <p className="text-xs text-muted mt-1">
            Récupère les opportunités du pipeline <span className="font-bold">1. CRM Vente</span> côté GHL et remplit <code>ghl_stage_name</code> sur les leads SaaS. Idempotent.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => trigger(true)}
            className="px-3 py-1.5 rounded-full text-xs font-bold border border-line-soft hover:bg-cream/60 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {busy === 'dry' ? 'Dry-run en cours…' : 'Dry-run'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => trigger(false)}
            className="px-3 py-1.5 rounded-full text-xs font-bold bg-or-fonce text-white hover:bg-or-fonce/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {busy === 'run' ? 'Sync en cours… (≤ 3 min)' : 'Lancer le backfill'}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-xs text-rouille">⚠ {error}</p>
      )}
      {summary && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          <SummaryStat label="Pipeline" value={summary.pipelineName} />
          <SummaryStat label="Processed" value={summary.processed} />
          <SummaryStat label="Created" value={summary.created} highlight={summary.created > 0} />
          <SummaryStat label="Updated" value={summary.updated} highlight={summary.updated > 0} />
          <SummaryStat label="Skipped" value={summary.skipped} />
          <SummaryStat label="Failed" value={summary.failed} highlight={summary.failed > 0} negative />
          {summary.unknownStages.length > 0 && (
            <div className="col-span-full text-[11px] text-rouille">
              ⚠ Stages GHL inconnus : {summary.unknownStages.join(', ')}
            </div>
          )}
          <div className="col-span-full text-[10px] text-faint">
            Durée : {(summary.durationMs / 1000).toFixed(1)}s — {summary.stagesInPipeline} stages dans le pipeline
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  highlight,
  negative,
}: {
  label: string
  value: string | number
  highlight?: boolean
  negative?: boolean
}) {
  const color = negative
    ? 'text-rouille'
    : highlight
    ? 'text-or-fonce'
    : 'text-foreground'
  return (
    <div className="rounded-[12px] border border-line-soft bg-cream/40 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-faint">{label}</p>
      <p className={`font-black text-sm ${color} truncate`}>{value}</p>
    </div>
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
