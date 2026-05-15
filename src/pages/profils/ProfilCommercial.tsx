import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../lib/auth'
import { updateRdv, useCommercialAnalytics, useUser, useRdvList, useLeads } from '../../lib/hooks'
import { fullName, type LeadResponse, type RdvResponse, type RdvStatus } from '../../lib/types'

const PIPELINE_STAGES: Array<{
  status: RdvStatus
  title: string
  hint: string
  accent: string
}> = [
  { status: 'planifie', title: 'À préparer', hint: 'RDV à venir / en attente', accent: 'border-or/40 bg-or-tint/40' },
  { status: 'reporte', title: 'À replanifier', hint: 'Prospect à replacer', accent: 'border-cuivre/40 bg-cuivre-tint/40' },
  { status: 'honore', title: 'Honoré', hint: 'Débrief / vente à saisir', accent: 'border-success/40 bg-success-tint/40' },
  { status: 'no_show', title: 'No-show', hint: 'Absent au RDV', accent: 'border-rouille/40 bg-rouille-tint/40' },
  { status: 'annule', title: 'Annulé', hint: 'RDV annulé', accent: 'border-line-soft bg-white/50' },
]

export function ProfilCommercial() {
  const { id } = useParams()
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const profileId = me?.role === 'commercial' ? me.id : id

  const { data: member, loading, error } = useUser(profileId)
  const { data: rdvs, refetch: refetchRdvs } = useRdvList(profileId ? { commercialId: profileId, limit: 200 } : undefined)
  const { data: leads } = useLeads(profileId ? { assignedToId: profileId, limit: 500 } : { limit: 500 })
  const { data: commercialAnalytics } = useCommercialAnalytics(profileId, { days: 30 })
  const [draggedRdvId, setDraggedRdvId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const rdvList = rdvs ?? []
  const stats = useMemo(() => computeStats(rdvList, commercialAnalytics), [rdvList, commercialAnalytics])
  const recentHonored = useMemo(() => {
    const list = rdvList.filter((r) => r.status === 'honore')
    list.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    return list.slice(0, 8)
  }, [rdvList])

  const rdvsByStage = useMemo(() => {
    const grouped = new Map<RdvStatus, RdvResponse[]>()
    for (const stage of PIPELINE_STAGES) grouped.set(stage.status, [])
    for (const rdv of rdvList) grouped.get(rdv.status)?.push(rdv)
    for (const rows of grouped.values()) rows.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    return grouped
  }, [rdvList])

  const handleDropOnStage = async (event: DragEvent<HTMLDivElement>, status: RdvStatus) => {
    event.preventDefault()
    const rdvId = event.dataTransfer.getData('text/rdv-id') || draggedRdvId
    const current = rdvList.find((r) => r.id === rdvId)
    setDraggedRdvId(null)
    if (!current || current.status === status || movingId) return

    setMovingId(current.id)
    try {
      await updateRdv(current.id, { status })
      refetchRdvs()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Impossible de déplacer ce RDV')
    } finally {
      setMovingId(null)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <Topbar eyebrow="PROFIL COMMERCIAL" title="Chargement…" />
        <main className="flex-grow flex items-center justify-center text-faint text-sm">Chargement…</main>
      </AppShell>
    )
  }

  if (error || !member) {
    return (
      <AppShell>
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
    <AppShell>
      <Topbar
        eyebrow="PROFIL COMMERCIAL"
        title={member.name}
      />
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

      <main className="p-8 pt-4 grid grid-cols-3 gap-6 overflow-y-auto flex-grow">
        <div className="col-span-1 space-y-6">
          <div className="glass-card p-6 text-center">
            <div className="w-24 h-24 rounded-full bg-or-tint flex items-center justify-center text-3xl font-bold mx-auto mb-3">{userInitials(member.name)}</div>
            <h3 className="text-xl font-bold">{member.name}</h3>
            <span className="status-badge bg-success-tint text-success mt-2 inline-block">{member.role}</span>
            <div className="mt-4 text-xs text-muted space-y-1">
              <div>{member.email}</div>
              {member.phone && <div>{member.phone}</div>}
              <div>{member.team ?? 'Sans équipe'} — depuis {monthsSince(member.createdAt)}</div>
              <div>{rdvList.filter((r) => r.externalId).length} RDV liés GHL dans ce tableau</div>
            </div>
          </div>

          <div className="glass-card p-6">
            <span className="eyebrow block mb-3">STATS RDV</span>
            <div className="space-y-3 text-sm">
              <Row label="RDV assignés" value={`${stats.total}`} />
              <Row label="Leads assignés" value={`${leads?.length ?? 0}`} />
              <Row label="RDV honorés" value={`${stats.honored} / ${stats.total}`} />
              <Row label="No-shows" value={`${stats.noShow} (${pct(stats.noShow, stats.total)})`} />
              <Row label="Reportés" value={String(stats.reported)} />
              <Row label="Ventes signées" value={String(stats.signed)} />
              <Row label="Closing rate" value={pct(stats.signed, stats.honored)} className="text-success font-bold" />
              <Row label="CA généré" value={formatCA(stats.ca)} highlight />
            </div>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          <section className="glass-card p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <span className="eyebrow">PIPELINE PROSPECTS</span>
                <h3 className="text-xl font-black mt-1">Kanban RDV commercial</h3>
                <p className="text-sm text-muted">Glisse une carte prospect vers la prochaine étape. Chaque carte garde l’heure du RDV et le lien GHL quand il existe.</p>
              </div>
              <span className="status-badge bg-info-tint text-info">{rdvList.length} RDV</span>
            </div>

            <div className="grid grid-cols-5 gap-3 min-h-[440px] overflow-x-auto pb-1">
              {PIPELINE_STAGES.map((stage) => {
                const rows = rdvsByStage.get(stage.status) ?? []
                return (
                  <div
                    key={stage.status}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDropOnStage(event, stage.status)}
                    className={`min-w-[190px] rounded-[22px] border ${stage.accent} p-3 flex flex-col`}
                  >
                    <div className="mb-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-black text-sm">{stage.title}</h4>
                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-muted">{rows.length}</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1 leading-snug">{stage.hint}</p>
                    </div>
                    <div className="space-y-2 flex-1">
                      {rows.length === 0 ? (
                        <div className="rounded-[18px] border border-dashed border-line-soft bg-white/35 p-4 text-center text-[11px] text-faint">Dépose ici</div>
                      ) : rows.map((rdv) => (
                        <RdvKanbanCard
                          key={rdv.id}
                          rdv={rdv}
                          lead={leadMap.get(rdv.leadId)}
                          moving={movingId === rdv.id}
                          onDragStart={(event) => {
                            setDraggedRdvId(rdv.id)
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/rdv-id', rdv.id)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Derniers RDV honorés</h3>
            {recentHonored.length === 0 ? (
              <p className="text-sm text-faint">Aucun RDV honoré pour ce commercial.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-or-tint">
                  <tr className="text-left eyebrow">
                    <Th>DATE</Th>
                    <Th>CLIENT</Th>
                    <Th>RÉSULTAT</Th>
                    <Th>PAIEMENT</Th>
                    <Th className="text-right">CA</Th>
                  </tr>
                </thead>
                <tbody>
                  {recentHonored.map((r) => {
                    const lead = leadMap.get(r.leadId)
                    return <RdvRow key={r.id} rdv={r} lead={lead} />
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function computeStats(rdvs: RdvResponse[], analytics?: { total: number; honored: number; signed: number; ca: number; closing: number } | null) {
  if (analytics) {
    const noShow = rdvs.filter((r) => r.status === 'no_show').length
    const reported = rdvs.filter((r) => r.status === 'reporte').length
    return { total: analytics.total, honored: analytics.honored, noShow, reported, signed: analytics.signed, ca: analytics.ca }
  }
  let honored = 0
  let noShow = 0
  let reported = 0
  let signed = 0
  let ca = 0
  for (const r of rdvs) {
    if (r.status === 'honore') honored++
    if (r.status === 'no_show') noShow++
    if (r.status === 'reporte') reported++
    if (r.result === 'signe') signed++
    if (r.montantTotal) ca += Number(r.montantTotal)
  }
  return { total: rdvs.length, honored, noShow, reported, signed, ca }
}

function pct(part: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

function formatCA(ca: number): string {
  if (ca === 0) return '—'
  if (ca >= 1000) return `${(ca / 1000).toFixed(1)}k€`
  return `${ca.toFixed(0)}€`
}

function userInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
}

function monthsSince(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  if (months <= 0) return 'ce mois'
  if (months === 1) return '1 mois'
  return `${months} mois`
}

function Row({ label, value, highlight = false, className = '' }: { label: string; value: string; highlight?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between ${highlight ? 'pt-2 border-t border-line-soft' : ''} ${className}`}>
      <span className={highlight ? 'font-semibold' : ''}>{label}</span>
      <span className={`font-bold ${highlight ? 'text-or' : ''}`}>{value}</span>
    </div>
  )
}

function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 ${className}`}>{children}</th>
}

function RdvKanbanCard({ rdv, lead, moving, onDragStart }: { rdv: RdvResponse; lead?: LeadResponse; moving: boolean; onDragStart: (event: DragEvent<HTMLDivElement>) => void }) {
  const name = lead ? fullName(lead) || lead.email || lead.phone || 'Prospect' : 'Prospect lié'
  return (
    <div
      draggable={!moving}
      onDragStart={onDragStart}
      className={`rounded-[18px] bg-white/85 border border-white/70 p-3 shadow-sm cursor-grab active:cursor-grabbing transition ${moving ? 'opacity-50 scale-[0.98]' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
      title="Glisser vers une autre étape"
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
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rdv.externalId && <span className="rounded-full bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success">GHL</span>}
        {rdv.result && <span className="rounded-full bg-info-tint px-2 py-0.5 text-[10px] font-bold text-info">{resultLabel(rdv.result)}</span>}
      </div>
    </div>
  )
}

function MiniLine({ icon, text }: { icon: 'calendar' | 'phone' | 'map-pin'; text: string }) {
  return <div className="flex items-center gap-1.5 min-w-0"><Icon name={icon} size={12} className="text-faint flex-shrink-0" /><span className="truncate">{text}</span></div>
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' · ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function resultLabel(result: NonNullable<RdvResponse['result']>): string {
  if (result === 'signe') return 'Vente'
  if (result === 'reflexion') return 'Réflexion'
  if (result === 'perdu') return 'Perdu'
  if (result === 'no_show') return 'No-show'
  return 'Reporté'
}

function RdvRow({ rdv, lead }: { rdv: RdvResponse; lead?: LeadResponse }) {
  const date = new Date(rdv.scheduledAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  const outcomeLabel = rdv.result === 'signe' ? 'Vente'
    : rdv.result === 'reflexion' ? 'À relancer'
    : rdv.result === 'perdu' ? 'Perdu'
    : rdv.result === 'no_show' ? 'No-show'
    : rdv.result === 'reporte' ? 'Reporté'
    : '—'
  const outcomeClass = rdv.result === 'signe' ? 'bg-success-tint text-success'
    : rdv.result === 'reflexion' ? 'bg-cuivre-tint text-cuivre'
    : rdv.result === 'perdu' || rdv.result === 'no_show' ? 'bg-rouille-tint text-rouille'
    : 'bg-info-tint text-info'
  const ca = rdv.montantTotal ? `${(Number(rdv.montantTotal) / 1000).toFixed(1)}k€` : '—'
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-3 py-2.5">{date}</td>
      <td className="px-3 py-2.5">
        <span className="font-semibold">{lead ? fullName(lead) : '—'}</span>
      </td>
      <td className="px-3 py-2.5"><span className={`status-badge ${outcomeClass}`}>{outcomeLabel}</span></td>
      <td className="px-3 py-2.5">{rdv.financingType ?? '—'}</td>
      <td className={`px-3 py-2.5 text-right font-bold ${ca === '—' ? 'text-faint' : 'text-or'}`}>{ca}</td>
    </tr>
  )
}
