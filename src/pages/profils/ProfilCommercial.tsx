import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingBlock } from '../../components/Spinner'
import { useUser, useRdvList, useLeads } from '../../lib/hooks'
import { fullName, type LeadResponse, type RdvResponse } from '../../lib/types'

export function ProfilCommercial() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: member, loading, error } = useUser(id)
  const { data: rdvs } = useRdvList(id ? { commercialId: id, limit: 200 } : undefined)
  const { data: leads } = useLeads({ limit: 500 })

  const leadMap = useMemo(() => {
    const m = new Map<string, LeadResponse>()
    for (const l of leads ?? []) m.set(l.id, l)
    return m
  }, [leads])

  const stats = useMemo(() => computeStats(rdvs ?? []), [rdvs])
  const recentHonored = useMemo(() => {
    const list = (rdvs ?? []).filter((r) => r.status === 'honore')
    list.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    return list.slice(0, 8)
  }, [rdvs])

  if (loading) {
    return (
      <AppShell>
        <Topbar eyebrow="PROFIL COMMERCIAL" title="Chargement…" />
        <main className="flex-grow flex items-center justify-center"><LoadingBlock /></main>
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
        <button onClick={() => navigate('/rdv')} className="btn-secondary px-4 py-2 rounded-xl text-sm ml-auto">Voir RDV</button>
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
            </div>
          </div>

          <div className="glass-card p-6">
            <span className="eyebrow block mb-3">STATS RDV</span>
            <div className="space-y-3 text-sm">
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

function computeStats(rdvs: RdvResponse[]) {
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

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 ${className}`}>{children}</th>
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
