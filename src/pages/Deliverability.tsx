import { useMemo, useState, type DragEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { updateLead, updateRdv, useCallLogs, useGhlOpportunities, useLeads, useRdvList, useUsers, type GhlOpportunity, type GhlOpportunityStage } from '../lib/hooks'
import { CALL_RESULT_LABEL, STATUS_LABEL, fullName, type CallLogResponse, type LeadResponse, type LeadStatus, type RdvResponse, type RdvStatus, type UserResponse } from '../lib/types'

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

type PipelineStage = {
  id: PipelineStageId
  title: string
  hint: string
  rdvStatus?: RdvStatus
  rdvResult?: RdvResponse['result']
  leadStatus?: LeadStatus
}

type ProspectCard = {
  id: string
  rdv: RdvResponse
  lead?: LeadResponse
  commercial?: UserResponse
  stageId: PipelineStageId
}

type StageMetrics = { opportunities: number; amount: number }

const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'rdv_planifie', title: 'RDV Planifié', hint: 'RDV à venir avec heure précise', rdvStatus: 'planifie', leadStatus: 'rdv_pris' },
  { id: 'no_show_bis', title: '(BIS) No-Show', hint: 'Prospect absent au rendez-vous', rdvStatus: 'no_show', rdvResult: 'no_show', leadStatus: 'pas_de_reponse' },
  { id: 'rdv_annule', title: '6. RDV Annulé', hint: 'Rendez-vous annulé', rdvStatus: 'annule', leadStatus: 'perdu' },
  { id: 'rdv_pas_qualifie', title: '7. RDV Pas Qualifié', hint: 'Prospect hors critères', leadStatus: 'pas_qualifie' },
  { id: 'rdv_reprogramme', title: '8. RDV Reprogrammé', hint: 'À replacer sur un créneau', rdvStatus: 'reporte', rdvResult: 'reporte', leadStatus: 'a_rappeler' },
  { id: 'relance_long_terme', title: '9. Relance Long Terme', hint: 'Prospect à suivre plus tard', leadStatus: 'relance' },
  { id: 'devis_en_attente', title: '10. Devis En Attente', hint: 'Devis remis, décision en cours', rdvStatus: 'honore', rdvResult: 'reflexion', leadStatus: 'rdv_honore' },
  { id: 'devis_signe', title: '11. Devis Signé', hint: 'Vente signée', rdvStatus: 'honore', rdvResult: 'signe', leadStatus: 'signe' },
  { id: 'devis_perdu', title: '12. Devis Perdu', hint: 'Devis refusé / perdu', rdvStatus: 'honore', rdvResult: 'perdu', leadStatus: 'perdu' },
]

export function Deliverability() {
  const me = useAuth((s) => s.user)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [selectedCard, setSelectedCard] = useState<ProspectCard | null>(null)

  const { data: rdvs, loading: rdvLoading, error: rdvError, refetch: refetchRdvs } = useRdvList({ limit: 200 })
  const { data: leads, refetch: refetchLeads } = useLeads({ limit: 2000 })
  const { data: users } = useUsers()
  const { data: ghlOpps, loading: ghlLoading, error: ghlError } = useGhlOpportunities({ limit: 5000 })
  const { data: selectedCallLogs } = useCallLogs(selectedCard ? { leadId: selectedCard.rdv.leadId, limit: 50 } : null)

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
      if (!grouped.has(opportunity.pipelineStageId)) grouped.set(opportunity.pipelineStageId, [])
      grouped.get(opportunity.pipelineStageId)?.push(opportunity)
    }
    for (const rows of grouped.values()) rows.sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    return grouped
  }, [ghlOpps])

  const ghlTotals = useMemo(() => ({
    total: ghlOpps?.total ?? 0,
    amount: ghlOpps?.amount ?? 0,
    signed: (ghlCardsByStage.get(findGhlStageId(ghlOpps?.stages, 'Devis Signé')) ?? []).length,
    planned: (ghlCardsByStage.get(findGhlStageId(ghlOpps?.stages, 'RDV Planifié')) ?? []).length,
  }), [ghlCardsByStage, ghlOpps])

  const cardsByStage = useMemo(() => {
    const grouped = new Map<PipelineStageId, ProspectCard[]>()
    for (const stage of PIPELINE_STAGES) grouped.set(stage.id, [])
    for (const card of cards) grouped.get(card.stageId)?.push(card)
    for (const rows of grouped.values()) rows.sort((a, b) => new Date(a.rdv.scheduledAt).getTime() - new Date(b.rdv.scheduledAt).getTime())
    return grouped
  }, [cards])

  const stageMetrics = useMemo(() => buildStageMetrics(cardsByStage), [cardsByStage])
  const totals = useMemo(() => buildTotals(cards, commercialUsers.length), [cards, commercialUsers.length])
  const commercialRows = useMemo(() => buildCommercialRows(cards, commercialUsers), [cards, commercialUsers])

  const handleDropOnStage = async (event: DragEvent<HTMLDivElement>, stage: PipelineStage) => {
    event.preventDefault()
    const cardId = event.dataTransfer.getData('text/rdv-id') || draggedCardId
    const card = cards.find((item) => item.id === cardId)
    setDraggedCardId(null)
    if (!card || card.stageId === stage.id || movingId) return

    setMovingId(card.id)
    try {
      const rdvPatch: Parameters<typeof updateRdv>[1] = {}
      if (stage.rdvStatus) rdvPatch.status = stage.rdvStatus
      if (stage.rdvResult !== undefined) rdvPatch.result = stage.rdvResult
      if (Object.keys(rdvPatch).length > 0) await updateRdv(card.rdv.id, rdvPatch)
      if (stage.leadStatus && card.lead) await updateLead(card.lead.id, { status: stage.leadStatus })
      refetchRdvs()
      refetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible de déplacer ce RDV')
    } finally {
      setMovingId(null)
    }
  }

  if (me?.role !== 'admin') return <Navigate to="/overview" replace />

  return (
    <AppShell flat>
      <Topbar eyebrow="ADMIN — DEIVRABILITÉ" title="Processus commerciaux" />

      <main className="commercial-prospect-page px-8 pt-4 pb-8 flex flex-col gap-3 overflow-y-auto flex-grow">
        <section className="grid grid-cols-4 gap-3 flex-shrink-0">
          <Metric label="Total RDV" value={`${totals.total}`} hint={`${totals.planned} planifiés · ${totals.honored} honorés`} />
          <Metric label="Commerciaux" value={`${totals.commercials}`} hint={`${totals.withCommercial} RDV assignés`} />
          <Metric label="CA signé" value={formatCurrency(totals.ca)} hint={`${totals.signed} ventes signées`} />
          <Metric label="GHL" value={`${ghlDisplayTotal(ghlTotals.total, totals.ghl)}`} hint={`${ghlTotals.total ? 'opportunités live GHL' : `${formatPercent(totals.ghlRate)} des RDV chargés`}`} />
        </section>

        <section className="commercial-pipeline-board glass-card px-4 py-3 flex flex-col h-[760px] flex-shrink-0 bg-white border border-line-soft">
          <div className="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
            <div className="min-w-0">
              <span className="eyebrow text-[10px]">GHL LIVE / ADMIN</span>
              <h3 className="text-base font-black leading-tight">Pipeline {ghlOpps?.pipeline?.name ?? 'CRM Vente'}</h3>
              <p className="text-[11px] text-muted mt-0.5">Scan direct des opportunités GHL, toutes les colonnes et cartes.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              {ghlLoading && <span>Scan GHL…</span>}
              {ghlError && <span className="text-rouille">{ghlError}</span>}
              {ghlOpps?.truncated && <span className="text-amber-600">Limité à {ghlOpps.total} cartes</span>}
              <span className="rounded-full border border-line-soft bg-success-tint px-2.5 py-1 text-[11px] font-bold text-success whitespace-nowrap">{ghlTotals.total} opp. · {formatCurrency(ghlTotals.amount)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs mb-3 flex-shrink-0">
            <MiniStat label="Opp. GHL" value={`${ghlTotals.total}`} />
            <MiniStat label="RDV planifiés" value={`${ghlTotals.planned}`} />
            <MiniStat label="Devis signés" value={`${ghlTotals.signed}`} />
            <MiniStat label="Valeur GHL" value={formatCurrency(ghlTotals.amount)} />
          </div>
          <div className="overflow-x-auto overflow-y-hidden flex-grow min-h-0 pb-1">
            <div className="flex gap-3 min-w-max h-full">
              {(ghlOpps?.stages ?? []).map((stage) => (
                <GhlStageColumn key={stage.id} stage={stage} rows={ghlCardsByStage.get(stage.id) ?? []} />
              ))}
              {!ghlLoading && !ghlError && (ghlOpps?.stages ?? []).length === 0 && (
                <div className="rounded-[18px] border border-dashed border-line-soft bg-white/70 p-8 text-center text-sm text-faint">Aucun contenu GHL scanné.</div>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-12 gap-3 flex-shrink-0">
          <div className="commercial-pipeline-board glass-card col-span-8 px-4 py-3 bg-white border border-line-soft">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <span className="eyebrow text-[10px]">DÉLIVRABILITÉ / COMMERCIAL</span>
                <h3 className="text-base font-black leading-tight">Vue globale de tous les commerciaux</h3>
              </div>
              <span className="rounded-full border border-line-soft bg-info-tint px-2.5 py-1 text-[11px] font-bold text-info whitespace-nowrap">{cards.length} RDV chargés</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <MiniStat label="À venir" value={`${totals.upcoming}`} />
              <MiniStat label="No-show" value={`${totals.noShow}`} />
              <MiniStat label="En attente" value={`${totals.pendingQuote}`} />
              <MiniStat label="Perdus" value={`${totals.lost}`} />
            </div>
          </div>

          <div className="commercial-pipeline-board glass-card col-span-4 px-4 py-3 bg-white border border-line-soft overflow-hidden">
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

        <section className="commercial-pipeline-board glass-card px-4 py-3 flex flex-col h-[1000px] flex-shrink-0 bg-white border border-line-soft">
          <div className="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
            <div className="min-w-0">
              <span className="eyebrow text-[10px]">PIPELINE DEIVRABILITÉ</span>
              <h3 className="text-base font-black leading-tight">Tous les processus RDV commerciaux</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              {rdvLoading && <span>Actualisation…</span>}
              {rdvError && <span className="text-rouille">{rdvError}</span>}
              <span className="hidden xl:inline">Glisse une carte vers une colonne pour mettre à jour le processus.</span>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden flex-grow min-h-0 pb-1">
            <div className="flex gap-3 min-w-max h-full">
              {PIPELINE_STAGES.map((stage) => {
                const rows = cardsByStage.get(stage.id) ?? []
                const metrics = stageMetrics.get(stage.id) ?? { opportunities: 0, amount: 0 }
                return (
                  <div
                    key={stage.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDropOnStage(event, stage)}
                    className="commercial-pipeline-column w-[236px] rounded-[18px] border border-line-soft bg-cream/45 p-2.5 flex flex-col min-h-0"
                  >
                    <div className="commercial-pipeline-column-head bg-white rounded-[14px] border border-line-soft p-2.5 mb-2 flex-shrink-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-black text-xs leading-snug">{stage.title}</h4>
                          <p className="text-[10px] text-muted mt-0.5 truncate">{stage.hint}</p>
                        </div>
                        <span className="rounded-full border border-line-soft px-1.5 py-0.5 text-[10px] font-bold text-muted">{rows.length}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
                        <div>
                          <p className="text-faint uppercase tracking-wide text-[9px]">Opp.</p>
                          <p className="font-black">{metrics.opportunities}</p>
                        </div>
                        <div>
                          <p className="text-faint uppercase tracking-wide text-[9px]">Valeur</p>
                          <p className="font-black truncate">{formatCurrency(metrics.amount)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 overflow-y-auto pr-1 flex-grow min-h-0">
                      {rows.length === 0 ? (
                        <div className="commercial-pipeline-empty rounded-[18px] border border-dashed border-line-soft bg-white/70 p-5 text-center text-[11px] text-faint">Aucun RDV</div>
                      ) : rows.map((card) => (
                        <DeliverabilityCard
                          key={card.id}
                          card={card}
                          moving={movingId === card.id}
                          onOpen={() => setSelectedCard(card)}
                          onDragStart={(event) => {
                            setDraggedCardId(card.id)
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/rdv-id', card.id)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      {selectedCard && (
        <DeliverabilityModal
          card={selectedCard}
          callLogs={selectedCallLogs ?? []}
          userMap={userMap}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </AppShell>
  )
}

function GhlStageColumn({ stage, rows }: { stage: GhlOpportunityStage; rows: GhlOpportunity[] }) {
  return (
    <div className="commercial-pipeline-column w-[252px] rounded-[18px] border border-line-soft bg-cream/45 p-2.5 flex flex-col min-h-0">
      <div className="commercial-pipeline-column-head bg-white rounded-[14px] border border-line-soft p-2.5 mb-2 flex-shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-black text-xs leading-snug">{cleanGhlStageName(stage.name)}</h4>
            <p className="text-[10px] text-muted mt-0.5 truncate">Position GHL {stage.position + 1}</p>
          </div>
          <span className="rounded-full border border-line-soft px-1.5 py-0.5 text-[10px] font-bold text-muted">{rows.length}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-2 text-[11px]">
          <div>
            <p className="text-faint uppercase tracking-wide text-[9px]">Opp.</p>
            <p className="font-black">{stage.opportunities}</p>
          </div>
          <div>
            <p className="text-faint uppercase tracking-wide text-[9px]">Valeur</p>
            <p className="font-black truncate">{formatCurrency(stage.amount)}</p>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 overflow-y-auto pr-1 flex-grow min-h-0">
        {rows.length === 0 ? (
          <div className="commercial-pipeline-empty rounded-[18px] border border-dashed border-line-soft bg-white/70 p-5 text-center text-[11px] text-faint">Aucune opportunité</div>
        ) : rows.map((opportunity) => <GhlOpportunityCard key={opportunity.id} opportunity={opportunity} />)}
      </div>
    </div>
  )
}

function GhlOpportunityCard({ opportunity }: { opportunity: GhlOpportunity }) {
  const name = opportunity.contactName || opportunity.name || opportunity.contactEmail || opportunity.contactPhone || 'Opportunité GHL'
  return (
    <div className="commercial-prospect-card rounded-[18px] border border-emerald-100 bg-emerald-50/60 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" title={opportunity.id}>
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
        {opportunity.contactCity && <MiniLine icon="map-pin" text={opportunity.contactCity} />}
        {(opportunity.updatedAt || opportunity.createdAt) && <MiniLine icon="calendar" text={formatDateTime(opportunity.updatedAt || opportunity.createdAt || '')} />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] text-faint truncate">{opportunity.contactEmail || opportunity.contactId || '—'}</span>
        <span className={`text-xs font-black ${opportunity.monetaryValue ? 'text-text' : 'text-faint'}`}>{opportunity.monetaryValue ? formatCurrency(opportunity.monetaryValue) : '—'}</span>
      </div>
    </div>
  )
}

function DeliverabilityCard({ card, moving, onOpen, onDragStart }: { card: ProspectCard; moving: boolean; onOpen: () => void; onDragStart: (event: DragEvent<HTMLDivElement>) => void }) {
  const { rdv, lead, commercial } = card
  const name = lead ? fullName(lead) || lead.email || lead.phone || 'Prospect' : 'Prospect lié'
  const value = rdv.montantTotal ? Number(rdv.montantTotal) : null
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!moving}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen() }}
      onDragStart={onDragStart}
      className={`commercial-prospect-card commercial-prospect-card-${card.stageId} rounded-[18px] border p-3 shadow-sm cursor-pointer active:cursor-grabbing transition ${stageCardTone(card.stageId)} ${moving ? 'opacity-50 scale-[0.98]' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
      title="Cliquer pour voir la fiche complète. Glisser pour déplacer."
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{name}</p>
          <p className="text-[11px] text-muted mt-0.5">{formatDateTime(rdv.scheduledAt)}</p>
        </div>
        <Icon name="more" size={14} className="text-faint flex-shrink-0" />
      </div>
      <div className="mt-3 space-y-1.5 text-[11px] text-muted">
        <MiniLine icon="calendar" text={rdv.locationType} />
        {commercial?.name && <MiniLine icon="users" text={commercial.name} />}
        {lead?.phone && <MiniLine icon="phone" text={lead.phone} />}
        {lead?.city && <MiniLine icon="map-pin" text={lead.city} />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {rdv.externalId && <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success">GHL</span>}
          {lead?.status && <span className="rounded-full bg-cream-darker px-2 py-0.5 text-[10px] font-bold text-muted">{STATUS_LABEL[lead.status]}</span>}
        </div>
        <span className={`text-xs font-black ${value ? 'text-text' : 'text-faint'}`}>{value ? formatCurrency(value) : '—'}</span>
      </div>
    </div>
  )
}

function DeliverabilityModal({ card, callLogs, userMap, onClose }: { card: ProspectCard; callLogs: CallLogResponse[]; userMap: Map<string, UserResponse>; onClose: () => void }) {
  const { lead, rdv, stageId, commercial: cardCommercial } = card
  const setterIds = Array.from(new Set([
    lead?.setterId,
    ...(lead?.assignedSetterIds ?? []),
    ...callLogs.map((log) => log.setterId),
  ].filter(Boolean) as string[]))
  const setters = setterIds.map((id) => userMap.get(id)?.name ?? id)
  const commercial = rdv.commercialId ? userMap.get(rdv.commercialId)?.name ?? cardCommercial?.name ?? rdv.commercialId : 'Non assigné'
  const latestComments = [
    lead?.latestCallComment ? { label: 'Dernier commentaire setter', value: lead.latestCallComment } : null,
    rdv.notes ? { label: 'Note RDV', value: rdv.notes } : null,
    rdv.objections ? { label: 'Objections', value: rdv.objections } : null,
    rdv.nonSaleReason ? { label: 'Raison de non-vente', value: rdv.nonSaleReason } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>

  return (
    <div className="commercial-prospect-modal-backdrop fixed inset-0 z-[300] flex items-center justify-center bg-noir/35 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="commercial-prospect-modal w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-[28px] border border-white/70 bg-white/95 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className={`commercial-prospect-modal-head commercial-prospect-modal-head-${stageId} px-6 py-5 border-b border-line-soft ${stageModalTone(stageId)}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow text-[10px]">FICHE DEIVRABILITÉ</p>
              <h3 className="text-2xl font-black truncate">{lead ? fullName(lead) : 'Prospect lié'}</h3>
              <p className="text-sm text-muted mt-1">{commercial} · {formatDateTime(rdv.scheduledAt)}</p>
            </div>
            <button onClick={onClose} className="commercial-prospect-modal-close w-10 h-10 rounded-full bg-white/80 border border-line-soft flex items-center justify-center text-muted hover:text-text" title="Fermer">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="commercial-prospect-modal-body p-6 overflow-y-auto max-h-[calc(88vh-116px)] space-y-5">
          <div className="grid md:grid-cols-3 gap-3">
            <InfoTile label="Commercial" value={commercial} />
            <InfoTile label="Téléphone" value={lead?.phone} />
            <InfoTile label="Email" value={lead?.email} />
            <InfoTile label="Ville" value={[lead?.postalCode, lead?.city].filter(Boolean).join(' ') || null} />
            <InfoTile label="Adresse" value={lead?.addressLine} />
            <InfoTile label="Logement" value={lead?.typeLogement} />
            <InfoTile label="Source" value={lead?.source} />
            <InfoTile label="Campagne" value={lead?.campaign ?? lead?.utmCampaign} />
            <InfoTile label="Canal" value={lead?.canalAcquisition ?? lead?.utmSource} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="commercial-prospect-section rounded-[22px] border border-line-soft bg-cream/45 p-4">
              <h4 className="font-black text-sm mb-3">Processus RDV</h4>
              <DetailRow label="Étape" value={PIPELINE_STAGES.find((stage) => stage.id === stageId)?.title ?? '—'} />
              <DetailRow label="Setter envoyé par" value={setters.length ? setters.join(', ') : '—'} />
              <DetailRow label="RDV" value={formatDateTime(rdv.scheduledAt)} />
              <DetailRow label="Lieu" value={rdv.locationType} />
              <DetailRow label="Statut RDV" value={rdv.status} />
              <DetailRow label="Résultat" value={rdv.result ?? '—'} />
              <DetailRow label="Montant" value={rdv.montantTotal ? formatCurrency(Number(rdv.montantTotal)) : '—'} />
              <DetailRow label="Financement" value={rdv.financingType ?? '—'} />
            </section>

            <section className="commercial-prospect-section rounded-[22px] border border-line-soft bg-cream/45 p-4">
              <h4 className="font-black text-sm mb-3">Historique</h4>
              <DetailRow label="Créé le" value={formatDateTime(lead?.createdAt ?? rdv.createdAt)} />
              <DetailRow label="Dernier contact" value={lead?.lastContactAt ? formatDateTime(lead.lastContactAt) : '—'} />
              <DetailRow label="Dernier appel" value={lead?.latestCallAt ? formatDateTime(lead.latestCallAt) : '—'} />
              <DetailRow label="Nb appels" value={`${lead?.callCount ?? callLogs.length}`} />
              <DetailRow label="Prochain rappel" value={lead?.nextCallbackAt ? formatDateTime(lead.nextCallbackAt) : '—'} />
              <DetailRow label="GHL" value={rdv.externalId ? 'Importé / synchronisé' : 'Local'} />
            </section>
          </div>

          <section className="commercial-prospect-section rounded-[22px] border border-line-soft bg-white p-4">
            <h4 className="font-black text-sm mb-3">Commentaires</h4>
            {latestComments.length === 0 && callLogs.every((log) => !log.notes) ? (
              <p className="text-sm text-faint">Aucun commentaire enregistré.</p>
            ) : (
              <div className="space-y-3">
                {latestComments.map((comment) => <CommentBlock key={comment.label} label={comment.label} value={comment.value} />)}
                {callLogs.filter((log) => log.notes).map((log) => (
                  <CommentBlock
                    key={log.id}
                    label={`${CALL_RESULT_LABEL[log.result]} · ${formatDateTime(log.calledAt)} · ${userMap.get(log.setterId)?.name ?? 'Setter'}`}
                    value={log.notes ?? ''}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
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

function buildStageMetrics(cardsByStage: Map<PipelineStageId, ProspectCard[]>): Map<PipelineStageId, StageMetrics> {
  const metrics = new Map<PipelineStageId, StageMetrics>()
  for (const stage of PIPELINE_STAGES) {
    const rows = cardsByStage.get(stage.id) ?? []
    metrics.set(stage.id, {
      opportunities: rows.length,
      amount: rows.reduce((sum, card) => sum + (card.rdv.montantTotal ? Number(card.rdv.montantTotal) : 0), 0),
    })
  }
  return metrics
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

function InfoTile({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="commercial-info-tile rounded-2xl border border-line-soft bg-cream/50 px-4 py-3 min-w-0">
      <p className="text-[10px] font-black uppercase tracking-widest text-faint">{label}</p>
      <p className="mt-1 text-sm font-bold truncate" title={value == null ? '—' : String(value)}>{value == null || value === '' ? '—' : value}</p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3 py-1.5 text-sm"><span className="text-muted">{label}</span><span className="font-bold text-right break-words">{value}</span></div>
}

function CommentBlock({ label, value }: { label: string; value: string }) {
  return <div className="commercial-comment-block rounded-2xl bg-cream/55 border border-line-soft p-3"><p className="text-[10px] font-black uppercase tracking-widest text-faint mb-1">{label}</p><p className="text-sm whitespace-pre-wrap">{value}</p></div>
}

function stageCardTone(stageId: PipelineStageId): string {
  return {
    rdv_planifie: 'bg-sky-50/70 border-sky-100',
    no_show_bis: 'bg-slate-50/80 border-slate-200',
    rdv_annule: 'bg-rose-50/70 border-rose-100',
    rdv_pas_qualifie: 'bg-red-50/60 border-red-100',
    rdv_reprogramme: 'bg-amber-50/70 border-amber-100',
    relance_long_terme: 'bg-orange-50/60 border-orange-100',
    devis_en_attente: 'bg-violet-50/60 border-violet-100',
    devis_signe: 'bg-emerald-50/70 border-emerald-100',
    devis_perdu: 'bg-stone-50/80 border-stone-200',
  }[stageId]
}

function stageModalTone(stageId: PipelineStageId): string {
  return {
    rdv_planifie: 'bg-sky-50/80',
    no_show_bis: 'bg-slate-50/90',
    rdv_annule: 'bg-rose-50/80',
    rdv_pas_qualifie: 'bg-red-50/70',
    rdv_reprogramme: 'bg-amber-50/80',
    relance_long_terme: 'bg-orange-50/70',
    devis_en_attente: 'bg-violet-50/70',
    devis_signe: 'bg-emerald-50/80',
    devis_perdu: 'bg-stone-50/90',
  }[stageId]
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
