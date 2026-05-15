import { useMemo, useState, type DragEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../lib/auth'
import { updateLead, updateRdv, useCommercialAnalytics, useUser, useRdvList, useLeads } from '../../lib/hooks'
import { fullName, type LeadResponse, type LeadStatus, type RdvResponse, type RdvStatus } from '../../lib/types'

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

const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'rdv_planifie', title: 'RDV Planifié', opportunities: 164, amount: 72053, hint: 'RDV à venir avec heure précise', rdvStatus: 'planifie', leadStatus: 'rdv_pris' },
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

  const { data: member, loading, error } = useUser(profileId)
  const { data: rdvs, refetch: refetchRdvs } = useRdvList(profileId ? { commercialId: profileId, limit: 200 } : undefined)
  const { data: leads, refetch: refetchLeads } = useLeads(profileId ? { assignedToId: profileId, limit: 2000 } : { limit: 2000 })
  const { data: commercialAnalytics } = useCommercialAnalytics(profileId, { days: 30 })
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const rdvList = rdvs ?? []
  const stats = useMemo(() => computeStats(rdvList, commercialAnalytics), [rdvList, commercialAnalytics])
  const cards = useMemo<ProspectCard[]>(() => rdvList.map((rdv) => ({ id: rdv.id, rdv, lead: leadMap.get(rdv.leadId), stageId: resolveStageId(rdv, leadMap.get(rdv.leadId)) })), [rdvList, leadMap])
  const cardsByStage = useMemo(() => {
    const grouped = new Map<PipelineStageId, ProspectCard[]>()
    for (const stage of PIPELINE_STAGES) grouped.set(stage.id, [])
    for (const card of cards) grouped.get(card.stageId)?.push(card)
    for (const rows of grouped.values()) rows.sort((a, b) => new Date(a.rdv.scheduledAt).getTime() - new Date(b.rdv.scheduledAt).getTime())
    return grouped
  }, [cards])

  const handleDropOnStage = async (event: DragEvent<HTMLDivElement>, stage: PipelineStage) => {
    event.preventDefault()
    const cardId = event.dataTransfer.getData('text/rdv-id') || draggedCardId
    const card = cards.find((c) => c.id === cardId)
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
      alert(err instanceof Error ? err.message : 'Impossible de déplacer ce prospect')
    } finally {
      setMovingId(null)
    }
  }

  if (loading) {
    return (
      <AppShell flat>
        <Topbar eyebrow="PROFIL COMMERCIAL" title="Chargement…" />
        <main className="flex-grow flex items-center justify-center text-faint text-sm">Chargement…</main>
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

      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-muted hover:text-text flex items-center gap-1 text-sm">
          <Icon name="arrow-left" size={16} />
          Retour
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          <span className={`status-badge ${member.ghlUserId ? 'bg-success-tint text-success' : 'bg-rouille-tint text-rouille'}`}>GHL : {member.ghlUserId ? 'relié' : 'non relié'}</span>
          <button onClick={() => navigate('/rdv')} className="btn-secondary px-4 py-2 rounded-xl text-sm">Voir RDV</button>
        </div>
      </div>

      <main className="p-8 pt-4 flex flex-col gap-5 overflow-hidden flex-grow">
        <section className="grid grid-cols-4 gap-4 flex-shrink-0">
          <div className="glass-card p-5 border border-line-soft bg-white">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-cream-darker flex items-center justify-center text-lg font-black">{userInitials(member.name)}</div>
              <div className="min-w-0">
                <h3 className="font-black truncate">{member.name}</h3>
                <p className="text-xs text-muted truncate">{member.email}</p>
              </div>
            </div>
          </div>
          <Metric label="RDV assignés" value={`${stats.total}`} />
          <Metric label="Prospects assignés" value={`${leads?.length ?? 0}`} />
          <Metric label="CA généré" value={formatCurrency(stats.ca)} />
        </section>

        <section className="glass-card p-5 flex flex-col min-h-0 flex-grow bg-white border border-line-soft">
          <div className="flex items-start justify-between gap-4 mb-4 flex-shrink-0">
            <div>
              <span className="eyebrow">PIPELINE PROSPECTS</span>
              <h3 className="text-xl font-black mt-1">Tableaux commerciaux</h3>
              <p className="text-sm text-muted">Les prospects s’affichent en cartes. Glisse une carte dans la colonne qui correspond à son évolution.</p>
            </div>
            <span className="status-badge bg-info-tint text-info">{cards.length} cartes chargées</span>
          </div>

          <div className="overflow-x-auto overflow-y-hidden flex-grow min-h-0 pb-2">
            <div className="flex gap-4 min-w-max h-full">
              {PIPELINE_STAGES.map((stage) => {
                const rows = cardsByStage.get(stage.id) ?? []
                return (
                  <div
                    key={stage.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDropOnStage(event, stage)}
                    className="w-[280px] rounded-[22px] border border-line-soft bg-cream/45 p-3 flex flex-col min-h-0"
                  >
                    <div className="bg-white rounded-[18px] border border-line-soft p-3 mb-3 flex-shrink-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-black text-sm leading-snug">{stage.title}</h4>
                          <p className="text-[11px] text-muted mt-1">{stage.hint}</p>
                        </div>
                        <span className="rounded-full border border-line-soft px-2 py-0.5 text-[11px] font-bold text-muted">{rows.length}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                        <div>
                          <p className="text-faint uppercase tracking-wide text-[10px]">Opportunités</p>
                          <p className="font-black">{stage.opportunities}</p>
                        </div>
                        <div>
                          <p className="text-faint uppercase tracking-wide text-[10px]">Valeur</p>
                          <p className="font-black truncate">{formatCurrency(stage.amount)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 overflow-y-auto pr-1 flex-grow min-h-0">
                      {rows.length === 0 ? (
                        <div className="rounded-[18px] border border-dashed border-line-soft bg-white/70 p-5 text-center text-[11px] text-faint">Dépose un prospect ici</div>
                      ) : rows.map((card) => (
                        <ProspectKanbanCard
                          key={card.id}
                          card={card}
                          moving={movingId === card.id}
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
    </AppShell>
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

function computeStats(rdvs: RdvResponse[], analytics?: { total: number; honored: number; signed: number; ca: number; closing: number } | null) {
  if (analytics) return { total: analytics.total, honored: analytics.honored, signed: analytics.signed, ca: analytics.ca }
  let honored = 0
  let signed = 0
  let ca = 0
  for (const r of rdvs) {
    if (r.status === 'honore') honored++
    if (r.result === 'signe') signed++
    if (r.montantTotal) ca += Number(r.montantTotal)
  }
  return { total: rdvs.length, honored, signed, ca }
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card p-5 border border-line-soft bg-white">
      <p className="eyebrow mb-2">{label}</p>
      <p className="text-2xl font-black">{value}</p>
    </div>
  )
}

function ProspectKanbanCard({ card, moving, onDragStart }: { card: ProspectCard; moving: boolean; onDragStart: (event: DragEvent<HTMLDivElement>) => void }) {
  const { rdv, lead } = card
  const name = lead ? fullName(lead) || lead.email || lead.phone || 'Prospect' : 'Prospect lié'
  const value = rdv.montantTotal ? Number(rdv.montantTotal) : null
  return (
    <div
      draggable={!moving}
      onDragStart={onDragStart}
      className={`rounded-[18px] bg-white border border-line-soft p-3 shadow-sm cursor-grab active:cursor-grabbing transition ${moving ? 'opacity-50 scale-[0.98]' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
      title="Glisser vers une autre colonne"
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
        {lead?.phone && <MiniLine icon="phone" text={lead.phone} />}
        {lead?.city && <MiniLine icon="map-pin" text={lead.city} />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {rdv.externalId && <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success">GHL</span>}
          {lead?.status && <span className="rounded-full bg-cream-darker px-2 py-0.5 text-[10px] font-bold text-muted">{lead.status}</span>}
        </div>
        <span className={`text-xs font-black ${value ? 'text-text' : 'text-faint'}`}>{value ? formatCurrency(value) : '—'}</span>
      </div>
    </div>
  )
}

function MiniLine({ icon, text }: { icon: 'calendar' | 'phone' | 'map-pin'; text: string }) {
  return <div className="flex items-center gap-1.5 min-w-0"><Icon name={icon} size={12} className="text-faint flex-shrink-0" /><span className="truncate">{text}</span></div>
}
