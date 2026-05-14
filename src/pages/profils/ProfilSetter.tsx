import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { useUser, useCallLogs, useLeads, useRdvList } from '../../lib/hooks'
import type { CallLogResponse, CallResult } from '../../lib/types'

export function ProfilSetter() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: member, loading, error } = useUser(id)
  const { data: calls } = useCallLogs(id ? { setterId: id, limit: 200 } : undefined)
  const { data: rdvs } = useRdvList(id ? { setterId: id, limit: 200 } : undefined)
  const { data: leads } = useLeads(id ? { setterId: id, limit: 500 } : undefined)

  const callStats = useMemo(() => computeCallStats(calls ?? []), [calls])
  const days = useMemo(() => buildDailyActivity(calls ?? []), [calls])

  if (loading) {
    return (
      <AppShell>
        <Topbar eyebrow="PROFIL SETTER" title="Chargement…" />
        <main className="flex-grow flex items-center justify-center text-faint text-sm">Chargement…</main>
      </AppShell>
    )
  }

  if (error || !member) {
    return (
      <AppShell>
        <Topbar eyebrow="PROFIL SETTER" title="Introuvable" />
        <main className="flex-grow flex items-center justify-center">
          <div className="glass-card p-12 text-center">
            <p className="text-muted mb-4">{error ?? 'Setter introuvable'}</p>
            <button onClick={() => navigate(-1)} className="btn-primary px-4 py-2 rounded-xl text-sm">Retour</button>
          </div>
        </main>
      </AppShell>
    )
  }

  const rdvPris = rdvs?.length ?? 0
  const rdvHonore = (rdvs ?? []).filter((r) => r.status === 'honore').length
  const leadsCount = leads?.length ?? 0
  const leadsQualif = (leads ?? []).filter((l) => l.status === 'qualifie' || l.status === 'rdv_pris' || l.status === 'rdv_honore' || l.status === 'signe').length

  return (
    <AppShell>
      <Topbar
        eyebrow="PROFIL SETTER"
        title={member.name}
      />
      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-muted hover:text-text flex items-center gap-1 text-sm">
          <Icon name="arrow-left" size={16} />
          Retour
        </button>
        <button onClick={() => navigate('/leads')} className="btn-secondary px-4 py-2 rounded-xl text-sm ml-auto">Voir leads</button>
      </div>

      <main className="p-8 pt-4 grid grid-cols-3 gap-6 overflow-y-auto flex-grow">
        <div className="col-span-1 space-y-6">
          <div className="glass-card p-6 text-center">
            <div className="w-24 h-24 rounded-full bg-cuivre-tint flex items-center justify-center text-3xl font-bold mx-auto mb-3">{userInitials(member.name)}</div>
            <h3 className="text-xl font-bold">{member.name}</h3>
            <span className="status-badge bg-cuivre-tint text-cuivre mt-2 inline-block">{member.role}</span>
            <div className="mt-4 text-xs text-muted space-y-1">
              <div>{member.email}</div>
              {member.phone && <div>{member.phone}</div>}
              <div>{member.team ?? 'Sans équipe'} — depuis {monthsSince(member.createdAt)}</div>
            </div>
          </div>

          <div className="glass-card p-6">
            <span className="eyebrow block mb-3">STATS</span>
            <div className="space-y-3 text-sm">
              <Row label="Appels passés" value={String(callStats.total)} />
              <Row label="Connexions" value={`${callStats.joints} (${pct(callStats.joints, callStats.total)})`} />
              <Row label="Leads assignés" value={String(leadsCount)} />
              <Row label="Leads qualifiés" value={String(leadsQualif)} />
              <Row label="RDV pris" value={String(rdvPris)} />
              <Row label="RDV honorés" value={`${rdvHonore} (${pct(rdvHonore, rdvPris)})`} highlight />
            </div>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Issue des appels</h3>
            <div className="grid grid-cols-4 gap-4 text-center">
              <BigStat color="#3DA86A" bg="bg-success-tint" value={String(callStats.joints)} label="JOINTS" />
              <BigStat color="#6B7C8C" bg="bg-info-tint" value={String(callStats.injoignable + callStats.nonJoint)} label="INJOIGNABLES" />
              <BigStat color="#B87333" bg="bg-cuivre-tint" value={String(callStats.rdvPris)} label="RDV PRIS" />
              <BigStat color="#B7410E" bg="bg-rouille-tint" value={String(callStats.refus)} label="REFUS" />
            </div>
          </div>

          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Activité (7 derniers jours)</h3>
            {days.length === 0 ? (
              <p className="text-sm text-faint">Aucun appel sur les 7 derniers jours.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-or-tint">
                  <tr className="text-left eyebrow">
                    <Th>JOUR</Th>
                    <Th>APPELS</Th>
                    <Th>JOINTS</Th>
                    <Th>RDV PRIS</Th>
                    <Th className="text-right">EFFICACITÉ</Th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <DayRow key={d.label} {...d} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

type CallStats = {
  total: number
  joints: number
  nonJoint: number
  injoignable: number
  rdvPris: number
  refus: number
  rappel: number
  messagerie: number
}

function computeCallStats(calls: CallLogResponse[]): CallStats {
  const counts: Record<CallResult, number> = {
    joint: 0, non_joint: 0, rappel_planifie: 0, rdv_pris: 0, refus: 0, injoignable: 0, messagerie: 0,
  }
  for (const c of calls) counts[c.result]++
  return {
    total: calls.length,
    joints: counts.joint,
    nonJoint: counts.non_joint,
    injoignable: counts.injoignable,
    rdvPris: counts.rdv_pris,
    refus: counts.refus,
    rappel: counts.rappel_planifie,
    messagerie: counts.messagerie,
  }
}

type DayRowData = { label: string; appels: number; joints: number; rdvPris: number; eff: string; effClass: string }

function buildDailyActivity(calls: CallLogResponse[]): DayRowData[] {
  const buckets = new Map<string, { total: number; joints: number; rdvPris: number; date: Date }>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Init 7 derniers jours
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    buckets.set(isoDay(d), { total: 0, joints: 0, rdvPris: 0, date: d })
  }
  for (const c of calls) {
    const d = new Date(c.calledAt)
    d.setHours(0, 0, 0, 0)
    const k = isoDay(d)
    const b = buckets.get(k)
    if (!b) continue
    b.total++
    if (c.result === 'joint') b.joints++
    if (c.result === 'rdv_pris') b.rdvPris++
  }
  const rows: DayRowData[] = []
  for (const [, b] of buckets) {
    if (b.total === 0) continue
    const effPct = b.total ? Math.round(((b.joints + b.rdvPris) / b.total) * 100) : 0
    rows.push({
      label: b.date.toDateString() === today.toDateString() ? "Aujourd'hui"
        : b.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      appels: b.total,
      joints: b.joints,
      rdvPris: b.rdvPris,
      eff: `${effPct}%`,
      effClass: effPct >= 85 ? 'text-success' : '',
    })
  }
  rows.sort((a, b) => (a.label === "Aujourd'hui" ? -1 : b.label === "Aujourd'hui" ? 1 : 0))
  return rows
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pct(part: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
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

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between ${highlight ? 'text-success pt-2 border-t border-line-soft font-bold' : ''}`}>
      <span className={highlight ? 'font-semibold' : ''}>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

function BigStat({ color, bg, value, label }: { color: string; bg: string; value: string; label: string }) {
  return (
    <div className={`p-4 rounded-[14px] ${bg}`}>
      <div className="text-[28px] font-bold" style={{ color }}>{value}</div>
      <div className="text-xs eyebrow mt-1">{label}</div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 ${className}`}>{children}</th>
}

function DayRow({ label, appels, joints, rdvPris, eff, effClass }: DayRowData) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-3 py-2.5 font-semibold">{label}</td>
      <td className="px-3 py-2.5">{appels}</td>
      <td className="px-3 py-2.5">{joints}</td>
      <td className="px-3 py-2.5">{rdvPris}</td>
      <td className={`px-3 py-2.5 text-right font-bold ${effClass}`}>{eff}</td>
    </tr>
  )
}
