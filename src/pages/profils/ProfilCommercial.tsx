import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingScreen, Spinner } from '../../components/Spinner'
import { useAuth } from '../../lib/auth'
import { moveGhlOpportunity, updateLead, updateRdv, useCallLogs, useCommercialAnalytics, useGhlCalendarConfig, useGhlCalendarEvents, useGhlOpportunities, useUser, useUsers, useRdvList, useLeads, type GhlOpportunity } from '../../lib/hooks'
import { CALL_RESULT_LABEL, STATUS_LABEL, fullName, type CallLogResponse, type LeadResponse, type LeadStatus, type RdvResponse, type RdvStatus, type UserResponse } from '../../lib/types'

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
  opportunities: number
  amount: number
  hint: string
  rdvStatus?: RdvStatus
  rdvResult?: RdvResponse['result']
  leadStatus?: LeadStatus
}

type ProspectCard = {
  id: string
  rdv: RdvResponse
  lead?: LeadResponse
  stageId: PipelineStageId
}

type PeriodMode = 'today' | 'week' | 'month' | 'all'

type StageMetrics = { opportunities: number; amount: number }

type GhlOpportunityRow = {
  id: string
  opportunity: GhlOpportunity
  stageId: PipelineStageId
  stageName: string
  changedAt: string | null
}

const PERIOD_LABEL: Record<PeriodMode, string> = {
  today: "Aujourd'hui",
  week: 'Semaine',
  month: 'Mois',
  all: 'Tout',
}

const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'rdv_planifie', title: 'RDV Planifié', opportunities: 164, amount: 72053, hint: 'RDV à venir avec heure précise', rdvStatus: 'planifie', leadStatus: 'qualifie' },
  { id: 'no_show_bis', title: '(BIS) No-Show', opportunities: 55, amount: 11700, hint: 'Prospect absent au rendez-vous', rdvStatus: 'no_show', rdvResult: 'no_show', leadStatus: 'pas_de_reponse' },
  { id: 'rdv_annule', title: '6. RDV Annulé', opportunities: 59, amount: 33499, hint: 'Rendez-vous annulé', rdvStatus: 'annule', leadStatus: 'perdu' },
  { id: 'rdv_pas_qualifie', title: '7. RDV Pas Qualifié', opportunities: 12, amount: 0, hint: 'Prospect hors critères', leadStatus: 'pas_qualifie' },
  { id: 'rdv_reprogramme', title: '8. RDV Reprogrammé', opportunities: 52, amount: 40200, hint: 'À replacer sur un créneau', rdvStatus: 'reporte', rdvResult: 'reporte', leadStatus: 'a_rappeler' },
  { id: 'relance_long_terme', title: '9. Relance Long Terme', opportunities: 118, amount: 388181.28, hint: 'Prospect à suivre plus tard', leadStatus: 'relance' },
  { id: 'devis_en_attente', title: '10. Devis En Attente', opportunities: 186, amount: 2025730.04, hint: 'Devis remis, décision en cours', rdvStatus: 'honore', rdvResult: 'reflexion', leadStatus: 'rdv_honore' },
  { id: 'devis_signe', title: '11. Devis Signé', opportunities: 8, amount: 119590.09, hint: 'Vente signée', rdvStatus: 'honore', rdvResult: 'signe', leadStatus: 'signe' },
  { id: 'devis_perdu', title: '12. Devis Perdu', opportunities: 48, amount: 230549, hint: 'Devis refusé / perdu', rdvStatus: 'honore', rdvResult: 'perdu', leadStatus: 'perdu' },
]

export function ProfilCommercial() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const profileId = me?.role === 'commercial' ? me.id : id

  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const periodRange = useMemo(() => buildPeriodRange(periodMode), [periodMode])
  const { data: member, loading, error } = useUser(profileId)
  const { data: rdvs, refetch: refetchRdvs } = useRdvList(profileId ? { commercialId: profileId, fromDate: periodRange.from, toDate: periodRange.to, limit: 200 } : undefined)
  const { data: leads, refetch: refetchLeads } = useLeads(profileId ? { assignedToId: profileId, limit: 500 } : { limit: 500 })
  const { data: commercialAnalytics } = useCommercialAnalytics(profileId, { from: periodRange.from, to: periodRange.to })
  const { data: ghlConfig } = useGhlCalendarConfig()
  const { data: ghlEventsData } = useGhlCalendarEvents(member?.ghlUserId ? { from: periodRange.from, to: periodRange.to } : undefined)
  const { data: ghlOpps, refetch: refetchGhlOpps } = useGhlOpportunities(member?.ghlUserId ? { limit: 200 } : undefined)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [selectedCard, setSelectedCard] = useState<ProspectCard | null>(null)
  const { data: users } = useUsers()
  const { data: selectedCallLogs } = useCallLogs(selectedCard ? { leadId: selectedCard.rdv.leadId, limit: 50 } : null)

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  const rdvList = rdvs ?? []
  const leadsWithReporteHistory = useMemo(() => {
    const set = new Set<string>()
    for (const r of rdvList) {
      if (r.status === 'reporte' || r.result === 'reporte') set.add(r.leadId)
    }
    return set
  }, [rdvList])
  const liveGhlEvents = useMemo(() => (ghlEventsData?.events ?? []).filter((event) => event.commercialId === profileId || event.assignedUserId === member?.ghlUserId), [ghlEventsData?.events, member?.ghlUserId, profileId])
  const ghlStageNames = useMemo(() => new Map((ghlOpps?.stages ?? []).map((stage) => [stage.id, stage.name])), [ghlOpps?.stages])
  const localRdvContactIds = useMemo(() => {
    const ids = new Set<string>()
    for (const rdv of rdvList) {
      const leadExternalId = leadMap.get(rdv.leadId)?.externalId
      if (leadExternalId) ids.add(leadExternalId)
    }
    return ids
  }, [rdvList, leadMap])
  const liveGhlOpportunityRows = useMemo<GhlOpportunityRow[]>(() => {
    if (!profileId && !member?.ghlUserId) return []
    return (ghlOpps?.opportunities ?? [])
      .filter((opportunity) => opportunity.mappedCommercialId === profileId || opportunity.assignedTo === member?.ghlUserId)
      .filter((opportunity) => !opportunity.contactId || !localRdvContactIds.has(opportunity.contactId))
      .map((opportunity) => {
        const stageName = ghlStageNames.get(opportunity.pipelineStageId) ?? ''
        return {
          id: `ghl-${opportunity.id}`,
          opportunity,
          stageId: resolveGhlStageId(stageName),
          stageName,
          changedAt: opportunity.lastStageChangeAt ?? opportunity.updatedAt ?? opportunity.createdAt ?? null,
        }
      })
      .filter((row) => isDateInPeriod(row.changedAt, periodRange.from, periodRange.to))
  }, [ghlOpps?.opportunities, ghlStageNames, localRdvContactIds, member?.ghlUserId, periodRange.from, periodRange.to, profileId])
  const sectorInfo = useMemo(() => deriveSectorInfo(member, ghlConfig?.sectors ?? [], liveGhlEvents), [ghlConfig?.sectors, liveGhlEvents, member])
  const stats = useMemo(() => addGhlRowsToStats(computeStats(rdvList, commercialAnalytics), liveGhlOpportunityRows), [rdvList, commercialAnalytics, liveGhlOpportunityRows])
  const cards = useMemo<ProspectCard[]>(() => rdvList.map((rdv) => ({ id: rdv.id, rdv, lead: leadMap.get(rdv.leadId), stageId: resolveStageId(rdv, leadMap.get(rdv.leadId)) })), [rdvList, leadMap])
  const cardsByStage = useMemo(() => {
    const grouped = new Map<PipelineStageId, ProspectCard[]>()
    for (const stage of PIPELINE_STAGES) grouped.set(stage.id, [])
    for (const card of cards) grouped.get(card.stageId)?.push(card)
    for (const rows of grouped.values()) rows.sort((a, b) => new Date(a.rdv.scheduledAt).getTime() - new Date(b.rdv.scheduledAt).getTime())
    return grouped
  }, [cards])
  const stageMetrics = useMemo(() => buildStageMetrics(cardsByStage, liveGhlOpportunityRows), [cardsByStage, liveGhlOpportunityRows])
  const sortedCards = useMemo(() => [...cards].sort((a, b) => new Date(a.rdv.scheduledAt).getTime() - new Date(b.rdv.scheduledAt).getTime()), [cards])
  const sortedGhlRows = useMemo(() => [...liveGhlOpportunityRows].sort((a, b) => new Date(b.changedAt ?? 0).getTime() - new Date(a.changedAt ?? 0).getTime()), [liveGhlOpportunityRows])
  const totalRows = sortedGhlRows.length + sortedCards.length

  const handleStageChange = async (card: ProspectCard, stageId: PipelineStageId) => {
    const stage = PIPELINE_STAGES.find((item) => item.id === stageId)
    if (!stage || card.stageId === stage.id || movingId) return

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
      alert(err instanceof Error ? err.message : 'Impossible de modifier l’évolution')
    } finally {
      setMovingId(null)
    }
  }

  const handleGhlStageChange = async (row: GhlOpportunityRow, stageId: PipelineStageId) => {
    const stage = PIPELINE_STAGES.find((item) => item.id === stageId)
    const ghlStage = findGhlStageForPipelineStage(ghlOpps?.stages ?? [], stageId)
    if (!stage || !ghlStage || row.stageId === stageId || movingId) return

    setMovingId(row.id)
    try {
      await moveGhlOpportunity(row.opportunity.id, { pipelineStageId: ghlStage.id, stageName: ghlStage.name })
      refetchGhlOpps()
      refetchLeads()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible de modifier l’évolution GHL')
    } finally {
      setMovingId(null)
    }
  }

  const handleAddDebrief = async (card: ProspectCard, text: string) => {
    const content = text.trim()
    if (!content) return
    const now = new Date().toISOString()
    const nextNotes = appendDebriefToNotes(card.rdv.notes, content, me?.name ?? member?.name ?? 'Commercial', now)
    try {
      const updated = await updateRdv(card.rdv.id, { notes: nextNotes, debriefFilledAt: now })
      const updatedCard = { ...card, rdv: updated, stageId: resolveStageId(updated, card.lead) }
      setSelectedCard(updatedCard)
      refetchRdvs()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible d’ajouter le débriefing')
      throw err
    }
  }

  if (loading) {
    return (
      <AppShell flat>
        <Topbar eyebrow="PROFIL COMMERCIAL" title="Chargement…" />
        <LoadingScreen label="Chargement du profil commercial…" />
      </AppShell>
    )
  }

  if (error || !member) {
    return (
      <AppShell flat>
        <Topbar eyebrow="PROFIL COMMERCIAL" title="Introuvable" />
        <main className="flex-grow flex items-center justify-center">
          <div className="glass-card p-12 text-center">
            <p className="text-muted mb-4">{error ?? 'Commercial introuvable'}</p>
            <button onClick={() => navigate(-1)} className="btn-primary px-4 py-2 rounded-xl text-sm">Retour</button>
          </div>
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell flat>
      <Topbar eyebrow="COMPTE COMMERCIAL" title={member.name} />

      <div className="px-8 pt-2 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-muted hover:text-text flex items-center gap-1 text-sm">
          <Icon name="arrow-left" size={16} />
          Retour
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span className={`status-badge ${member.ghlUserId ? 'bg-success-tint text-success' : 'bg-rouille-tint text-rouille'}`}>GHL : {member.ghlUserId ? 'relié' : 'non relié'}</span>
          <span className="status-badge bg-info-tint text-info">Secteur : {sectorInfo.label}</span>
          <button onClick={() => navigate('/rdv')} className="btn-secondary px-3 py-1.5 rounded-xl text-xs">Voir RDV</button>
        </div>
      </div>

      <main className="commercial-prospect-page px-8 pt-2 pb-6 flex flex-col gap-3 overflow-hidden flex-grow">
        <section className="grid grid-cols-4 gap-3 flex-shrink-0">
          <div className="commercial-summary-card profile-info-card glass-card px-4 py-3 border border-line-soft bg-white">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full overflow-hidden bg-cream-darker border border-line-soft flex items-center justify-center text-sm font-black shrink-0">
                {member.image ? <img src={member.image} alt="Photo de profil" className="w-full h-full object-cover" /> : userInitials(member.name)}
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm truncate">{member.name}</h3>
                <p className="text-[11px] text-muted truncate">{member.email}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-or-dark">Commercial</p>
              </div>
            </div>
          </div>
          <Metric label={`RDV ${PERIOD_LABEL[periodMode].toLowerCase()}`} value={`${stats.total}`} hint={`${stats.honored} honorés · ${stats.signed} signés`} />
          <Metric label="Secteur GHL" value={sectorInfo.label} hint={`${sectorInfo.count} RDV GHL live`} />
          <Metric label="CA période" value={formatCurrency(stats.ca)} hint={`${formatPercent(stats.closing)} closing`} />
        </section>

        <section className="commercial-pipeline-board glass-card px-4 py-3 flex flex-col min-h-0 flex-grow bg-white border border-line-soft">
          <div className="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
            <div className="min-w-0">
              <span className="eyebrow text-[10px]">PIPELINE PROSPECTS</span>
              <h3 className="text-base font-black leading-tight">Tableaux commerciaux</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <div className="commercial-period-tabs hidden md:flex rounded-full border border-line-soft bg-white p-1">
                {(['today', 'week', 'month', 'all'] as const).map((mode) => (
                  <button key={mode} onClick={() => setPeriodMode(mode)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${periodMode === mode ? 'bg-noir text-white' : 'text-muted hover:text-text'}`}>{PERIOD_LABEL[mode]}</button>
                ))}
              </div>
              <span className="hidden xl:inline">Liste RDV + pipeline GHL live du commercial · sélectionne l’évolution du prospect.</span>
              <span className="rounded-full border border-line-soft bg-info-tint px-2.5 py-1 text-[11px] font-bold text-info whitespace-nowrap">{totalRows} cartes</span>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-3 flex-shrink-0">
            {PIPELINE_STAGES.map((stage) => {
              const metrics = stageMetrics.get(stage.id) ?? { opportunities: 0, amount: 0 }
              return <MiniStageStat key={stage.id} stage={stage} metrics={metrics} />
            })}
          </div>

          <div className="overflow-y-auto flex-grow min-h-0 pr-1">
            <div className="space-y-2">
              {totalRows === 0 ? (
                <div className="commercial-pipeline-empty rounded-[18px] border border-dashed border-line-soft bg-white/70 p-8 text-center text-sm text-faint">Aucun RDV ou prospect GHL pour ce commercial sur la période.</div>
              ) : (
                <>
                  {sortedGhlRows.map((row) => (
                    <GhlOpportunityRowCard
                      key={row.id}
                      row={row}
                      moving={movingId === row.id}
                      onStageChange={(stageId) => handleGhlStageChange(row, stageId)}
                    />
                  ))}
                  {sortedCards.map((card) => (
                    <ProspectRdvRow
                      key={card.id}
                      card={card}
                      hasReporteHistory={leadsWithReporteHistory.has(card.rdv.leadId)}
                      moving={movingId === card.id}
                      onOpen={() => setSelectedCard(card)}
                      onStageChange={(stageId) => handleStageChange(card, stageId)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </section>
      </main>
      {selectedCard && (
        <ProspectDetailModal
          card={selectedCard}
          callLogs={selectedCallLogs ?? []}
          userMap={userMap}
          onAddDebrief={(text) => handleAddDebrief(selectedCard, text)}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </AppShell>
  )
}

function resolveStageId(rdv: RdvResponse, lead?: LeadResponse): PipelineStageId {
  if (rdv.result === 'signe' || lead?.status === 'signe') return 'devis_signe'
  if (rdv.result === 'perdu' || lead?.status === 'perdu') return 'devis_perdu'
  if (lead?.status === 'pas_qualifie') return 'rdv_pas_qualifie'
  if (rdv.status === 'annule') return 'rdv_annule'
  if (rdv.status === 'no_show' || rdv.result === 'no_show') return 'no_show_bis'
  if (rdv.status === 'reporte') return 'rdv_reprogramme'
  if (rdv.result === 'reporte' && rdv.status !== 'honore') return 'rdv_reprogramme'
  if (lead?.status === 'relance') return 'relance_long_terme'
  if (rdv.result === 'reflexion') return 'devis_en_attente'
  if (rdv.status === 'honore' || lead?.status === 'rdv_honore') return 'devis_en_attente'
  return 'rdv_planifie'
}

function computeStats(rdvs: RdvResponse[], analytics?: { total: number; honored: number; signed: number; ca: number; closing: number } | null) {
  if (analytics) return { total: analytics.total, honored: analytics.honored, signed: analytics.signed, ca: analytics.ca, closing: analytics.closing }
  let honored = 0
  let signed = 0
  let ca = 0
  for (const r of rdvs) {
    if (r.status === 'honore') honored++
    if (r.result === 'signe') signed++
    if (r.montantTotal) ca += Number(r.montantTotal)
  }
  return { total: rdvs.length, honored, signed, ca, closing: honored ? Math.round((signed / honored) * 100) : 0 }
}

function addGhlRowsToStats(stats: { total: number; honored: number; signed: number; ca: number; closing: number }, ghlRows: GhlOpportunityRow[]) {
  const ca = stats.ca + ghlRows.reduce((sum, row) => sum + (Number.isFinite(row.opportunity.monetaryValue) ? row.opportunity.monetaryValue : 0), 0)
  const signed = stats.signed + ghlRows.filter((row) => row.stageId === 'devis_signe' || row.opportunity.status === 'won').length
  const total = stats.total + ghlRows.length
  const honored = stats.honored + ghlRows.filter((row) => ['devis_en_attente', 'devis_signe', 'devis_perdu'].includes(row.stageId)).length
  return { total, honored, signed, ca, closing: honored ? Math.round((signed / honored) * 100) : stats.closing }
}

function buildStageMetrics(cardsByStage: Map<PipelineStageId, ProspectCard[]>, ghlRows: GhlOpportunityRow[]): Map<PipelineStageId, StageMetrics> {
  const metrics = new Map<PipelineStageId, StageMetrics>()
  for (const stage of PIPELINE_STAGES) {
    const rows = cardsByStage.get(stage.id) ?? []
    const stageGhlRows = ghlRows.filter((row) => row.stageId === stage.id)
    metrics.set(stage.id, {
      opportunities: rows.length + stageGhlRows.length,
      amount: rows.reduce((sum, card) => {
        const raw = card.rdv.montantTotal ?? card.lead?.monetaryValue ?? null
        return sum + (raw ? Number(raw) : 0)
      }, stageGhlRows.reduce((sum, row) => sum + (Number.isFinite(row.opportunity.monetaryValue) ? row.opportunity.monetaryValue : 0), 0)),
    })
  }
  return metrics
}

function appendDebriefToNotes(currentNotes: string | null, text: string, author: string, iso: string): string {
  const entry = `Débriefing — ${formatDateTime(iso)} — ${author}\n${text}`
  return [currentNotes?.trim(), entry].filter(Boolean).join('\n\n')
}

function buildPeriodRange(mode: PeriodMode): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now)
  const to = new Date(now)
  if (mode === 'today') {
    from.setHours(0, 0, 0, 0)
    to.setHours(23, 59, 59, 999)
  } else if (mode === 'week') {
    const day = (from.getDay() + 6) % 7
    from.setDate(from.getDate() - day)
    from.setHours(0, 0, 0, 0)
    to.setDate(from.getDate() + 6)
    to.setHours(23, 59, 59, 999)
  } else if (mode === 'month') {
    from.setDate(1)
    from.setHours(0, 0, 0, 0)
    to.setMonth(from.getMonth() + 1, 0)
    to.setHours(23, 59, 59, 999)
  } else {
    from.setFullYear(from.getFullYear() - 2)
    from.setHours(0, 0, 0, 0)
    to.setFullYear(to.getFullYear() + 2)
    to.setHours(23, 59, 59, 999)
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

function deriveSectorInfo(member: { ghlUserId: string | null; ghlCalendarId: string | null } | null | undefined, sectors: Array<{ sector: string; calendarId: string; label: string }>, events: Array<{ sector?: string | null; calendarId: string }>): { label: string; count: number } {
  const counts = new Map<string, number>()
  for (const event of events) {
    const label = event.sector || sectors.find((sector) => sector.calendarId === event.calendarId)?.label || event.calendarId
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const [bestLabel, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  if (bestLabel) return { label: bestLabel, count: count ?? 0 }
  const mapped = member?.ghlCalendarId ? sectors.find((sector) => sector.calendarId === member.ghlCalendarId) : undefined
  if (mapped) return { label: mapped.label || mapped.sector, count: 0 }
  return { label: member?.ghlUserId ? 'À détecter' : 'Non relié', count: 0 }
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}


function userInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
}

function formatCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card px-4 py-3 border border-line-soft bg-white">
      <p className="eyebrow mb-1 text-[10px]">{label}</p>
      <p className="text-lg font-black leading-tight truncate">{value}</p>
      {hint && <p className="text-[11px] text-muted mt-0.5 truncate">{hint}</p>}
    </div>
  )
}

function MiniStageStat({ stage, metrics }: { stage: PipelineStage; metrics: StageMetrics }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-cream/45 px-3 py-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="font-black text-[11px] leading-tight truncate">{stage.title}</p>
        <span className="rounded-full border border-line-soft bg-white px-1.5 py-0.5 text-[10px] font-bold text-muted">{metrics.opportunities}</span>
      </div>
      <p className="text-[10px] text-muted mt-1 truncate">{formatCurrency(metrics.amount)}</p>
    </div>
  )
}

function GhlOpportunityRowCard({ row, moving, onStageChange }: { row: GhlOpportunityRow; moving: boolean; onStageChange: (stageId: PipelineStageId) => void }) {
  const opportunity = row.opportunity
  const name = opportunity.contactName || cleanGhlName(opportunity.name) || opportunity.contactEmail || opportunity.contactPhone || 'Prospect GHL'
  const location = [opportunity.contactPostalCode, opportunity.contactCity].filter(Boolean).join(' ')
  const value = Number.isFinite(opportunity.monetaryValue) ? opportunity.monetaryValue : 0
  return (
    <div className={`commercial-prospect-card commercial-prospect-card-${row.stageId} rounded-[18px] border p-3 shadow-sm transition ${stageCardTone(row.stageId)} ${moving ? 'opacity-50 scale-[0.98]' : ''}`}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_220px] gap-3 items-center">
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{name}</p>
          <p className="text-[11px] text-muted mt-0.5">GHL live · {row.changedAt ? formatDateTime(row.changedAt) : 'date GHL indisponible'}</p>
        </div>
        <div className="space-y-1 text-[11px] text-muted min-w-0">
          {opportunity.contactPhone && <MiniLine icon="phone" text={opportunity.contactPhone} />}
          {location && <MiniLine icon="map-pin" text={location} />}
          <MiniLine icon="calendar" text={row.stageName || 'Pipeline GHL'} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success">GHL live</span>
          {opportunity.status && <span className="rounded-full bg-cream-darker px-2 py-0.5 text-[10px] font-bold text-muted">{opportunity.status}</span>}
          <span className={`text-xs font-black ${value ? 'text-text' : 'text-faint'}`}>{value ? formatCurrency(value) : '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={row.stageId}
            disabled={moving}
            onChange={(event) => onStageChange(event.target.value as PipelineStageId)}
            className="w-full rounded-xl border border-line-soft bg-white px-3 py-2 text-xs font-bold text-text outline-none focus:border-noir"
            title="Évolution GHL du prospect"
          >
            {PIPELINE_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
          </select>
          <Icon name="more" size={14} className="text-faint flex-shrink-0" />
        </div>
      </div>
    </div>
  )
}

function resolveGhlStageId(stageName: string): PipelineStageId {
  const normalized = normalizeText(stageName)
  if (normalized.includes('no-show')) return 'no_show_bis'
  if (normalized.includes('annule')) return 'rdv_annule'
  if (normalized.includes('pas qualifie')) return 'rdv_pas_qualifie'
  if (normalized.includes('reprogramme')) return 'rdv_reprogramme'
  if (normalized.includes('relance long terme')) return 'relance_long_terme'
  if (normalized.includes('devis en attente')) return 'devis_en_attente'
  if (normalized.includes('devis signe')) return 'devis_signe'
  if (normalized.includes('devis perdu')) return 'devis_perdu'
  return 'rdv_planifie'
}

function findGhlStageForPipelineStage(stages: Array<{ id: string; name: string }>, stageId: PipelineStageId) {
  const needles: Record<PipelineStageId, string[]> = {
    rdv_planifie: ['rdv planifie'],
    no_show_bis: ['no-show'],
    rdv_annule: ['rdv annule'],
    rdv_pas_qualifie: ['rdv pas qualifie'],
    rdv_reprogramme: ['rdv reprogramme'],
    relance_long_terme: ['relance long terme'],
    devis_en_attente: ['devis en attente'],
    devis_signe: ['devis signe'],
    devis_perdu: ['devis perdu'],
  }
  return stages.find((stage) => needles[stageId].some((needle) => normalizeText(stage.name).includes(needle)))
}

function isDateInPeriod(iso: string | null, from: string, to: string): boolean {
  if (!iso) return true
  const ts = new Date(iso).getTime()
  return ts >= new Date(from).getTime() && ts <= new Date(to).getTime()
}

function cleanGhlName(value: string): string {
  return value.replace(/^opportunity\s*/i, '').trim()
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

function ProspectRdvRow({ card, hasReporteHistory, moving, onOpen, onStageChange }: { card: ProspectCard; hasReporteHistory: boolean; moving: boolean; onOpen: () => void; onStageChange: (stageId: PipelineStageId) => void }) {
  const { rdv, lead } = card
  const name = lead ? fullName(lead) || lead.email || lead.phone || 'Prospect' : 'Prospect lié'
  const value = rdv.montantTotal ? Number(rdv.montantTotal) : null
  const debriefCount = countDebriefs(rdv.notes)
  const showReporteBadge = card.stageId === 'devis_en_attente' && hasReporteHistory
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen() }}
      className={`commercial-prospect-card commercial-prospect-card-${card.stageId} rounded-[18px] border p-3 shadow-sm cursor-pointer transition ${stageCardTone(card.stageId)} ${moving ? 'opacity-50 scale-[0.98]' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
      title="Cliquer pour voir la fiche complète."
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_220px] gap-3 items-center">
        <div className="min-w-0">
          <p className="font-black text-sm truncate">{name}</p>
          <p className="text-[11px] text-muted mt-0.5">{formatDateTime(rdv.scheduledAt)}</p>
        </div>
        <div className="space-y-1 text-[11px] text-muted min-w-0">
          {lead?.phone && <MiniLine icon="phone" text={lead.phone} />}
          {lead?.city && <MiniLine icon="map-pin" text={lead.city} />}
          <MiniLine icon="calendar" text={rdv.locationType} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {rdv.externalId && <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success">GHL</span>}
          {lead?.status && <span className="rounded-full bg-cream-darker px-2 py-0.5 text-[10px] font-bold text-muted">{lead.status}</span>}
          {showReporteBadge && (
            <span className="rounded-full bg-rouille-tint px-2 py-0.5 text-[10px] font-bold text-rouille inline-flex items-center gap-1" title="RDV initialement reporté avant d'être honoré">
              <Icon name="clock" size={10} />
              RDV reporté
            </span>
          )}
          <span className="rounded-full bg-white border border-line-soft px-2 py-0.5 text-[10px] font-bold text-muted">{debriefCount} débrief.</span>
          <span className={`text-xs font-black ${value ? 'text-text' : 'text-faint'}`}>{value ? formatCurrency(value) : '—'}</span>
        </div>
        <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <select
            value={card.stageId}
            disabled={moving}
            onChange={(event) => onStageChange(event.target.value as PipelineStageId)}
            className="w-full rounded-xl border border-line-soft bg-white px-3 py-2 text-xs font-bold text-text outline-none focus:border-noir"
            title="Évolution du prospect"
          >
            {PIPELINE_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
          </select>
          <Icon name="more" size={14} className="text-faint flex-shrink-0" />
        </div>
      </div>
    </div>
  )
}


function ProspectDetailModal({ card, callLogs, userMap, onAddDebrief, onClose }: { card: ProspectCard; callLogs: CallLogResponse[]; userMap: Map<string, UserResponse>; onAddDebrief: (text: string) => Promise<void>; onClose: () => void }) {
  const { lead, rdv, stageId } = card
  const [debriefText, setDebriefText] = useState('')
  const [savingDebrief, setSavingDebrief] = useState(false)
  const setterIds = Array.from(new Set([
    lead?.setterId,
    ...(lead?.assignedSetterIds ?? []),
    ...callLogs.map((log) => log.setterId),
  ].filter(Boolean) as string[]))
  const setters = setterIds.map((id) => userMap.get(id)?.name ?? id)
  const commercial = rdv.commercialId ? userMap.get(rdv.commercialId)?.name ?? rdv.commercialId : '—'
  const latestComments = [
    lead?.latestCallComment ? { label: 'Dernier commentaire setter', value: lead.latestCallComment } : null,
    rdv.notes ? { label: 'Note RDV', value: rdv.notes } : null,
    rdv.objections ? { label: 'Objections', value: rdv.objections } : null,
    rdv.nonSaleReason ? { label: 'Raison de non-vente', value: rdv.nonSaleReason } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>


  const saveDebrief = async () => {
    const value = debriefText.trim()
    if (!value || savingDebrief) return
    setSavingDebrief(true)
    try {
      await onAddDebrief(value)
      setDebriefText('')
    } finally {
      setSavingDebrief(false)
    }
  }

  return (
    <div className="commercial-prospect-modal-backdrop fixed inset-0 z-[300] flex items-center justify-center bg-noir/35 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="commercial-prospect-modal w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-[28px] border border-white/70 bg-white/95 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className={`commercial-prospect-modal-head commercial-prospect-modal-head-${stageId} px-6 py-5 border-b border-line-soft ${stageModalTone(stageId)}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow text-[10px]">FICHE PROSPECT</p>
              <h3 className="text-2xl font-black truncate">{lead ? fullName(lead) : 'Prospect lié'}</h3>
              <p className="text-sm text-muted mt-1">{STATUS_LABEL[lead?.status ?? 'nouveau']} · {formatDateTime(rdv.scheduledAt)}</p>
            </div>
            <button onClick={onClose} className="commercial-prospect-modal-close w-10 h-10 rounded-full bg-white/80 border border-line-soft flex items-center justify-center text-muted hover:text-text" title="Fermer">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="commercial-prospect-modal-body p-6 overflow-y-auto max-h-[calc(88vh-116px)] space-y-5">
          <div className="grid md:grid-cols-3 gap-3">
            <InfoTile label="Téléphone" value={lead?.phone} />
            <InfoTile label="Email" value={lead?.email} />
            <InfoTile label="Ville" value={[lead?.postalCode, lead?.city].filter(Boolean).join(' ') || null} />
            <InfoTile label="Adresse" value={lead?.addressLine} />
            <InfoTile label="Logement" value={lead?.typeLogement} />
            <InfoTile label="Revenu fiscal" value={lead?.revenuFiscal != null ? String(lead.revenuFiscal) : null} />
            <InfoTile label="Source" value={lead?.source} />
            <InfoTile label="Campagne" value={lead?.campaign ?? lead?.utmCampaign} />
            <InfoTile label="Canal" value={lead?.canalAcquisition ?? lead?.utmSource} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="commercial-prospect-section rounded-[22px] border border-line-soft bg-cream/45 p-4">
              <h4 className="font-black text-sm mb-3">Attribution & RDV</h4>
              <DetailRow label="Setter envoyé par" value={setters.length ? setters.join(', ') : '—'} />
              <DetailRow label="Commercial" value={commercial} />
              <DetailRow label="RDV" value={formatDateTime(rdv.scheduledAt)} />
              <DetailRow label="Lieu" value={rdv.locationType} />
              <DetailRow label="Statut RDV" value={rdv.status} />
              <DetailRow label="Résultat" value={rdv.result ?? '—'} />
              <DetailRow label="Montant" value={rdv.montantTotal ? formatCurrency(Number(rdv.montantTotal)) : '—'} />
              <DetailRow label="Financement" value={rdv.financingType ?? '—'} />
            </section>

            <section className="commercial-prospect-section rounded-[22px] border border-line-soft bg-cream/45 p-4">
              <h4 className="font-black text-sm mb-3">Historique rapide</h4>
              <DetailRow label="Créé le" value={formatDateTime(lead?.createdAt ?? rdv.createdAt)} />
              <DetailRow label="Dernier contact" value={lead?.lastContactAt ? formatDateTime(lead.lastContactAt) : '—'} />
              <DetailRow label="Dernier appel" value={lead?.latestCallAt ? formatDateTime(lead.latestCallAt) : '—'} />
              <DetailRow label="Nb appels" value={`${lead?.callCount ?? callLogs.length}`} />
              <DetailRow label="Prochain rappel" value={lead?.nextCallbackAt ? formatDateTime(lead.nextCallbackAt) : '—'} />
              <DetailRow label="Jauge 11 jours" value={lead?.jauge11Jours ?? '—'} />
            </section>
          </div>

          <section className="commercial-prospect-section rounded-[22px] border border-line-soft bg-white p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h4 className="font-black text-sm">Commentaires & débriefings</h4>
              <span className="rounded-full bg-info-tint px-2 py-0.5 text-[10px] font-bold text-info">{countDebriefs(rdv.notes)} débriefings</span>
            </div>
            <div className="rounded-[18px] border border-line-soft bg-cream/45 p-3 mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-faint">Ajouter un débriefing</label>
              <textarea
                value={debriefText}
                onChange={(event) => setDebriefText(event.target.value)}
                placeholder="Résumé du RDV, objections, prochaines actions…"
                className="mt-2 w-full min-h-[92px] rounded-2xl border border-line-soft bg-white px-3 py-2 text-sm outline-none focus:border-noir"
              />
              <div className="mt-2 flex justify-end">
                <button onClick={saveDebrief} disabled={!debriefText.trim() || savingDebrief} className="btn-primary px-4 py-2 rounded-xl text-xs disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">{savingDebrief ? <Spinner size={14} stroke={3} label="Enregistrement…" /> : 'Ajouter le débriefing'}</button>
              </div>
            </div>
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

function countDebriefs(notes: string | null): number {
  if (!notes) return 0
  return (notes.match(/Débriefing —/g) ?? []).length
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

function MiniLine({ icon, text }: { icon: 'calendar' | 'phone' | 'map-pin'; text: string }) {
  return <div className="flex items-center gap-1.5 min-w-0"><Icon name={icon} size={12} className="text-faint flex-shrink-0" /><span className="truncate">{text}</span></div>
}
