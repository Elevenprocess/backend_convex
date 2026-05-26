import { useMemo, useState, type DragEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { moveGhlOpportunity, useGhlOpportunities, useLeads, useRdvList, useUsers, type GhlOpportunity, type GhlOpportunityStage } from '../lib/hooks'
import { type LeadResponse, type RdvResponse, type UserResponse } from '../lib/types'

type PipelineStageId =
  | 'rdv_planifie'
  | 'no_show_bis'
  | 'rdv_annule'
  | 'rdv_pas_qualifie'
  | 'rdv_reprogramme'
  | 'relance_long_terme'
  | 'devis_en_attente'
  | 'devis_signe'
  | 'devis_perdu'

type ProspectCard = {
  id: string
  rdv: RdvResponse
  lead?: LeadResponse
  commercial?: UserResponse
  stageId: PipelineStageId
}

export function Deliverability() {
  const me = useAuth((s) => s.user)

  const { data: rdvs, refetch: refetchRdvs } = useRdvList({ limit: 200 })
  const { data: leads, refetch: refetchLeads } = useLeads({ limit: 500 })
  const { data: users } = useUsers()
  const { data: ghlOpps, loading: ghlLoading, error: ghlError, refetch: refetchGhl } = useGhlOpportunities({ limit: 300 })

  // Drag-and-drop : `optimisticMoves[oppId] = targetStageId` permet à l'UI de
  // bouger la carte avant la réponse GHL. Cleared après refetch ou rollback.
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, string>>({})
  const [movingOppId, setMovingOppId] = useState<string | null>(null)
  const [draggedOppId, setDraggedOppId] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const lead of leads ?? []) m.set(lead.id, lead)
    return m
  }, [leads])

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const user of users ?? []) m.set(user.id, user)
    return m
  }, [users])

  const commercialUsers = useMemo(() => (users ?? []).filter((user) => user.role === 'commercial'), [users])
  const rdvList = rdvs ?? []

  const cards = useMemo<ProspectCard[]>(() => rdvList.map((rdv) => {
    const lead = leadMap.get(rdv.leadId)
    return {
      id: rdv.id,
      rdv,
      lead,
      commercial: rdv.commercialId ? userMap.get(rdv.commercialId) : undefined,
      stageId: resolveStageId(rdv, lead),
    }
  }), [leadMap, rdvList, userMap])

  const ghlCardsByStage = useMemo(() => {
    const grouped = new Map<string, GhlOpportunity[]>()
    for (const stage of ghlOpps?.stages ?? []) grouped.set(stage.id, [])
    for (const opportunity of ghlOpps?.opportunities ?? []) {
      const effectiveStage = optimisticMoves[opportunity.id] ?? opportunity.pipelineStageId
      if (!grouped.has(effectiveStage)) grouped.set(effectiveStage, [])
      grouped.get(effectiveStage)?.push(opportunity)
    }
    for (const rows of grouped.values()) rows.sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    return grouped
  }, [ghlOpps, optimisticMoves])

  const stageNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const stage of ghlOpps?.stages ?? []) m.set(stage.id, stage.name)
    return m
  }, [ghlOpps])

  const handleDropOnGhlStage = async (
    event: DragEvent<HTMLDivElement>,
    targetStageId: string,
  ) => {
    event.preventDefault()
    const oppId = event.dataTransfer.getData('text/ghl-opp-id') || draggedOppId
    setDraggedOppId(null)
    if (!oppId || movingOppId) return
    const opp = ghlOpps?.opportunities.find((o) => o.id === oppId)
    if (!opp) return
    const currentStage = optimisticMoves[oppId] ?? opp.pipelineStageId
    if (currentStage === targetStageId) return

    setMoveError(null)
    setMovingOppId(oppId)
    setOptimisticMoves((prev) => ({ ...prev, [oppId]: targetStageId }))
    try {
      await moveGhlOpportunity(oppId, {
        pipelineStageId: targetStageId,
        stageName: stageNameById.get(targetStageId),
      })
      // Refetch pour reprendre la source de vérité GHL (counts/amount par stage)
      refetchGhl()
      // Clear l'override une fois que les nouvelles données arrivent
      setOptimisticMoves((prev) => {
        const next = { ...prev }
        delete next[oppId]
        return next
      })
    } catch (err) {
      // Rollback de l'optimistic move
      setOptimisticMoves((prev) => {
        const next = { ...prev }
        delete next[oppId]
        return next
      })
      setMoveError(err instanceof Error ? err.message : 'Échec du déplacement GHL')
    } finally {
      setMovingOppId(null)
    }
  }

  const ghlTotals = useMemo(() => ({
    total: ghlOpps?.total ?? 0,
    amount: ghlOpps?.amount ?? 0,
    signed: (ghlCardsByStage.get(findGhlStageId(ghlOpps?.stages, 'Devis Signé')) ?? []).length,
    planned: (ghlCardsByStage.get(findGhlStageId(ghlOpps?.stages, 'RDV Planifié')) ?? []).length,
  }), [ghlCardsByStage, ghlOpps])

  const totals = useMemo(() => buildTotals(cards, commercialUsers.length), [cards, commercialUsers.length])
  const commercialRows = useMemo(() => buildCommercialRows(cards, commercialUsers), [cards, commercialUsers])

  // refetch hooks gardés pour rafraîchir si Mario rebranche un drag-and-drop
  // (les déplacements doivent maintenant être faits dans GHL et propagés via
  //  les webhooks Phase 3).
  void refetchRdvs
  void refetchLeads

  if (me?.role !== 'admin') return <Navigate to="/overview" replace />

  return (
    <AppShell flat>
      <Topbar eyebrow="ADMIN — DÉLIVRABILITÉ" title="Suivi pipeline" />

      <main className="commercial-prospect-page deliverability-jenkins-page px-4 sm:px-8 pt-4 pb-8 flex flex-col gap-3 overflow-y-auto flex-grow">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
          <Metric label="Total RDV" value={`${totals.total}`} hint={`${totals.planned} planifiés · ${totals.honored} honorés`} />
          <Metric label="Commerciaux" value={`${totals.commercials}`} hint={`${totals.withCommercial} RDV assignés`} />
          <Metric label="CA signé" value={formatCurrency(totals.ca)} hint={`${totals.signed} ventes signées`} />
          <Metric label="GHL" value={`${ghlDisplayTotal(ghlTotals.total, totals.ghl)}`} hint={`${ghlTotals.total ? 'opportunités live GHL' : `${formatPercent(totals.ghlRate)} des RDV chargés`}`} />
        </section>

        <section className="grid grid-cols-12 gap-3 flex-shrink-0">
          <div className="commercial-pipeline-board jenkins-panel col-span-12 xl:col-span-8 px-4 py-3 bg-white border border-line-soft">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <span className="eyebrow text-[10px]">DÉLIVRABILITÉ / COMMERCIAL</span>
                <h3 className="text-base font-black leading-tight">Vue globale de tous les commerciaux</h3>
              </div>
              <span className="rounded-full border border-line-soft bg-info-tint px-2.5 py-1 text-[11px] font-bold text-info whitespace-nowrap">{cards.length} RDV chargés</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <MiniStat label="À venir" value={`${totals.upcoming}`} />
              <MiniStat label="No-show" value={`${totals.noShow}`} />
              <MiniStat label="En attente" value={`${totals.pendingQuote}`} />
              <MiniStat label="Perdus" value={`${totals.lost}`} />
            </div>
          </div>

          <div className="commercial-pipeline-board jenkins-panel col-span-12 xl:col-span-4 px-4 py-3 bg-white border border-line-soft overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow text-[10px]">RÉPARTITION</span>
              <span className="text-[11px] text-faint">Top commerciaux</span>
            </div>
            <div className="space-y-1.5 max-h-[92px] overflow-y-auto pr-1">
              {commercialRows.slice(0, 5).map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold truncate">{row.name}</span>
                  <span className="text-muted whitespace-nowrap">{row.count} · {formatCurrency(row.amount)}</span>
                </div>
              ))}
              {commercialRows.length === 0 && <p className="text-xs text-faint">Aucun commercial avec RDV.</p>}
            </div>
          </div>
        </section>

        <section className="commercial-pipeline-board jenkins-pipeline-board px-4 py-3 flex flex-col h-[1000px] flex-shrink-0 bg-white border border-line-soft">
          <div className="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
            <div className="min-w-0">
              <span className="eyebrow text-[10px]">PIPELINE GHL CRM VENTE</span>
              <h3 className="text-base font-black leading-tight">Tous les processus RDV commerciaux</h3>
              <p className="text-[11px] text-muted mt-0.5">Scan direct des opportunités GHL — glisse une carte vers une colonne pour mettre à jour GHL en direct.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              {ghlLoading && <span>Scan GHL…</span>}
              {ghlError && <span className="text-rouille">{ghlError}</span>}
              {moveError && <span className="text-rouille">{moveError}</span>}
              {movingOppId && <span className="text-amber-600">Sync GHL…</span>}
              {ghlOpps?.truncated && <span className="text-amber-600">Limité à {ghlOpps.total} cartes</span>}
              <span className="jenkins-pill">{ghlTotals.total} opp. · {formatCurrency(ghlTotals.amount)}</span>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden flex-grow min-h-0 pb-1">
            <div className="flex gap-3 min-w-max h-full items-stretch">
              {(ghlOpps?.stages ?? []).map((stage) => (
                <GhlStageColumn
                  key={stage.id}
                  stage={stage}
                  rows={ghlCardsByStage.get(stage.id) ?? []}
                  movingOppId={movingOppId}
                  onDragStart={(oppId) => setDraggedOppId(oppId)}
                  onDrop={(event) => handleDropOnGhlStage(event, stage.id)}
                />
              ))}
              {!ghlLoading && !ghlError && (ghlOpps?.stages ?? []).length === 0 && (
                <div className="rounded-[18px] border border-dashed border-line-soft bg-white/70 p-8 text-center text-sm text-faint">Aucun contenu GHL scanné.</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  )
}

function GhlStageColumn({
  stage,
  rows,
  movingOppId,
  onDragStart,
  onDrop,
}: {
  stage: GhlOpportunityStage
  rows: GhlOpportunity[]
  movingOppId: string | null
  onDragStart: (oppId: string) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}) {
  // Compteur + valeur en temps réel (basés sur rows pour refléter l'optimistic
  // update). On retombe sur stage.opportunities / stage.amount si vide pour
  // les éventuels stages dont la liste ne serait pas hydratée.
  const liveCount = rows.length
  const liveAmount = rows.reduce(
    (sum, o) => sum + (Number.isFinite(o.monetaryValue) ? o.monetaryValue : 0),
    0,
  )
  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="commercial-pipeline-column jenkins-stage-column w-[252px] rounded-[18px] border border-line-soft bg-cream/45 p-2.5 flex flex-col min-h-0"
    >
      <div className="commercial-pipeline-column-head jenkins-stage-head bg-white rounded-[14px] border border-line-soft p-2.5 mb-2 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-black text-xs leading-snug">{cleanGhlStageName(stage.name)}</h4>
            <p className="text-[10px] text-muted mt-0.5 truncate">Position GHL {stage.position + 1}</p>
          </div>
          <span className="rounded-full border border-line-soft px-1.5 py-0.5 text-[10px] font-bold text-muted">{liveCount}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
          <div>
            <p className="text-faint uppercase tracking-wide text-[9px]">Opp.</p>
            <p className="font-black">{liveCount}</p>
          </div>
          <div>
            <p className="text-faint uppercase tracking-wide text-[9px]">Valeur</p>
            <p className="font-black truncate">{formatCurrency(liveAmount || stage.amount)}</p>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 overflow-y-auto pr-1 flex-grow min-h-0">
        {rows.length === 0 ? (
          <div className="commercial-pipeline-empty rounded-[18px] border border-dashed border-line-soft bg-white/70 p-5 text-center text-[11px] text-faint">Aucune opportunité</div>
        ) : rows.map((opportunity) => (
          <GhlOpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            moving={movingOppId === opportunity.id}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/ghl-opp-id', opportunity.id)
              onDragStart(opportunity.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function GhlOpportunityCard({
  opportunity,
  moving,
  onDragStart,
}: {
  opportunity: GhlOpportunity
  moving: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
}) {
  const name = opportunity.contactName || cleanGhlOpportunityName(opportunity.name) || opportunity.contactEmail || opportunity.contactPhone || 'Prospect GHL'
  const place = [opportunity.contactPostalCode, opportunity.contactCity].filter(Boolean).join(' ')
  return (
    <div
      draggable={!moving}
      onDragStart={onDragStart}
      className={`commercial-prospect-card jenkins-opportunity-card rounded-[18px] border border-emerald-100 bg-emerald-50/60 p-3 shadow-sm transition cursor-grab active:cursor-grabbing ${moving ? 'opacity-50 scale-[0.98]' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
      title={moving ? 'Sync GHL en cours…' : 'Glisser pour déplacer'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{name}</p>
          <p className="text-[11px] text-muted mt-0.5 truncate">{opportunity.source || 'GHL'} · {opportunity.status || 'open'}</p>
        </div>
        <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success flex-shrink-0">GHL</span>
      </div>
      <div className="mt-3 space-y-1.5 text-[11px] text-muted">
        {opportunity.assignedToName && <MiniLine icon="users" text={opportunity.assignedToName} />}
        {opportunity.contactPhone && <MiniLine icon="phone" text={opportunity.contactPhone} />}
        {place && <MiniLine icon="map-pin" text={place} />}
        {opportunity.contactAddress && <MiniLine icon="map-pin" text={opportunity.contactAddress} />}
        {(opportunity.updatedAt || opportunity.createdAt) && <MiniLine icon="calendar" text={formatDateTime(opportunity.updatedAt || opportunity.createdAt || '')} />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-faint truncate">{opportunity.contactEmail || opportunity.contactId || '—'}</span>
        <span className={`text-xs font-black ${opportunity.monetaryValue ? 'text-text' : 'text-faint'}`}>{opportunity.monetaryValue ? formatCurrency(opportunity.monetaryValue) : '—'}</span>
      </div>
    </div>
  )
}


function resolveStageId(rdv: RdvResponse, lead?: LeadResponse): PipelineStageId {
  if (rdv.result === 'signe' || lead?.status === 'signe') return 'devis_signe'
  if (rdv.result === 'perdu' || lead?.status === 'perdu') return 'devis_perdu'
  if (lead?.status === 'pas_qualifie') return 'rdv_pas_qualifie'
  if (rdv.status === 'annule') return 'rdv_annule'
  if (rdv.status === 'no_show' || rdv.result === 'no_show') return 'no_show_bis'
  if (rdv.status === 'reporte' || rdv.result === 'reporte') return 'rdv_reprogramme'
  if (lead?.status === 'relance') return 'relance_long_terme'
  if (rdv.result === 'reflexion') return 'devis_en_attente'
  if (rdv.status === 'honore' || lead?.status === 'rdv_honore') return 'devis_en_attente'
  return 'rdv_planifie'
}

function buildTotals(cards: ProspectCard[], commercials: number) {
  const total = cards.length
  const signedCards = cards.filter((card) => card.stageId === 'devis_signe')
  const ca = signedCards.reduce((sum, card) => sum + (card.rdv.montantTotal ? Number(card.rdv.montantTotal) : 0), 0)
  const withCommercial = cards.filter((card) => card.rdv.commercialId).length
  const now = Date.now()
  const ghl = cards.filter((card) => card.rdv.externalId).length
  return {
    total,
    commercials,
    withCommercial,
    ca,
    signed: signedCards.length,
    planned: cards.filter((card) => card.rdv.status === 'planifie').length,
    honored: cards.filter((card) => card.rdv.status === 'honore').length,
    upcoming: cards.filter((card) => new Date(card.rdv.scheduledAt).getTime() >= now).length,
    noShow: cards.filter((card) => card.stageId === 'no_show_bis').length,
    pendingQuote: cards.filter((card) => card.stageId === 'devis_en_attente').length,
    lost: cards.filter((card) => card.stageId === 'devis_perdu' || card.stageId === 'rdv_annule' || card.stageId === 'rdv_pas_qualifie').length,
    ghl,
    ghlRate: total ? Math.round((ghl / total) * 100) : 0,
  }
}

function buildCommercialRows(cards: ProspectCard[], commercialUsers: UserResponse[]) {
  const rows = new Map<string, { id: string; name: string; count: number; amount: number }>()
  for (const user of commercialUsers) rows.set(user.id, { id: user.id, name: user.name, count: 0, amount: 0 })
  for (const card of cards) {
    const id = card.rdv.commercialId ?? 'unassigned'
    const row = rows.get(id) ?? { id, name: card.commercial?.name ?? 'Non assigné', count: 0, amount: 0 }
    row.count += 1
    row.amount += card.rdv.montantTotal ? Number(card.rdv.montantTotal) : 0
    rows.set(id, row)
  }
  return [...rows.values()].filter((row) => row.count > 0).sort((a, b) => b.count - a.count)
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="commercial-summary-card glass-card px-4 py-3 border border-line-soft bg-white">
      <p className="eyebrow mb-1 text-[10px]">{label}</p>
      <p className="text-lg font-black leading-tight truncate">{value}</p>
      {hint && <p className="text-[11px] text-muted mt-0.5 truncate">{hint}</p>}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="commercial-info-tile rounded-2xl border border-line-soft bg-cream/50 px-3 py-2 min-w-0">
      <p className="text-[9px] font-black uppercase tracking-widest text-faint truncate">{label}</p>
      <p className="mt-0.5 text-sm font-black truncate">{value}</p>
    </div>
  )
}






function MiniLine({ icon, text }: { icon: 'calendar' | 'phone' | 'map-pin' | 'users'; text: string }) {
  return <div className="flex items-center gap-1.5 min-w-0"><Icon name={icon} size={12} className="text-faint flex-shrink-0" /><span className="truncate">{text}</span></div>
}

function findGhlStageId(stages: GhlOpportunityStage[] | undefined, needle: string): string {
  const normalizedNeedle = normalizeGhlLabel(needle)
  return stages?.find((stage) => normalizeGhlLabel(stage.name).includes(normalizedNeedle))?.id ?? ''
}

function cleanGhlStageName(value: string): string {
  return value.trim().replace(/^\d+\.\s*/, '')
}

function cleanGhlOpportunityName(value: string): string {
  const clean = value.trim()
  return normalizeGhlLabel(clean) === 'opportunite ghl' ? '' : clean
}


function normalizeGhlLabel(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase()
}

function ghlDisplayTotal(ghlTotal: number, fallbackTotal: number): number {
  return ghlTotal || fallbackTotal
}

function formatCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
