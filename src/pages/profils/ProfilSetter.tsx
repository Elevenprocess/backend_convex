import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingScreen } from '../../components/Spinner'
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
        <LoadingScreen label="Chargement du profil…" />
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
    <AppShell flat>
      <Topbar eyebrow="PROFIL SETTER" title={member.name} />
      <div className="px-6 pt-4 md:px-8 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="text-muted hover:text-text flex items-center gap-1 text-sm font-bold">
          <Icon name="arrow-left" size={16} />
          Retour
        </button>
        <button onClick={() => navigate('/leads')} className="btn-secondary px-4 py-2 rounded-xl text-sm ml-auto">Voir leads</button>
      </div>

      <main className="profile-page flex-grow overflow-auto px-6 pt-4 pb-8 md:px-8">
        <div className="mx-auto max-w-6xl space-y-5">
          <section className="profile-hero-card glass-card border border-line-soft bg-white p-5 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <div className="profile-avatar-shell shrink-0 self-center md:self-auto">
                <div className="profile-avatar-ring">
                  <div className="profile-avatar-photo">
                    {member.image ? (
                      <img src={member.image} alt="Photo de profil" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-5xl font-black text-or-dark uppercase">{userInitials(member.name)}</span>
                    )}
                  </div>
                </div>
                <span className="profile-avatar-badge">SETTER</span>
              </div>

              <div className="min-w-0 flex-1 text-center md:text-left">
                <p className="eyebrow text-or-dark">Profil setter</p>
                <h1 className="mt-1 truncate text-3xl font-black tracking-tight md:text-4xl">{member.name}</h1>
                <p className="mt-1 truncate text-sm font-semibold text-muted">{member.email}</p>
                <div className="profile-stat-strip mt-5">
                  <div className="profile-stat-pill"><div className="text-sm font-black">{callStats.total}</div><div className="eyebrow text-[9px]">Appels</div></div>
                  <div className="profile-stat-pill"><div className="text-sm font-black">{leadsCount}</div><div className="eyebrow text-[9px]">Leads</div></div>
                  <div className="profile-stat-pill"><div className="text-sm font-black">{rdvPris}</div><div className="eyebrow text-[9px]">RDV pris</div></div>
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                  <span className="profile-chip profile-chip-dark">Setter</span>
                  <span className="profile-chip profile-chip-soft">{member.team ?? 'Sans équipe'}</span>
                  <span className="profile-chip profile-chip-success">Depuis {monthsSince(member.createdAt)}</span>
                  {member.phone && <span className="profile-chip profile-chip-info">{member.phone}</span>}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
            <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
              <p className="eyebrow text-or-dark">Performance</p>
              <h2 className="mt-1 text-lg font-black">Résumé setter</h2>
              <div className="mt-5 space-y-3 text-sm">
                <Row label="Appels passés" value={String(callStats.total)} />
                <Row label="Connexions" value={`${callStats.joints} (${pct(callStats.joints, callStats.total)})`} />
                <Row label="Leads assignés" value={String(leadsCount)} />
                <Row label="Leads qualifiés" value={String(leadsQualif)} />
                <Row label="RDV pris" value={String(rdvPris)} />
                <Row label="RDV honorés" value={`${rdvHonore} (${pct(rdvHonore, rdvPris)})`} highlight />
              </div>
            </section>

            <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
              <div className="mb-5">
                <p className="eyebrow text-or-dark">Issue des appels</p>
                <h2 className="text-lg font-black">Qualité des conversations</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <BigStat color="#3DA86A" bg="bg-success-tint" value={String(callStats.joints)} label="JOINTS" />
                <BigStat color="#6B7C8C" bg="bg-info-tint" value={String(callStats.injoignable + callStats.nonJoint)} label="INJOIGNABLES" />
                <BigStat color="#3E9A6F" bg="bg-cuivre-tint" value={String(callStats.rdvPris)} label="RDV PRIS" />
                <BigStat color="#145A41" bg="bg-rouille-tint" value={String(callStats.refus)} label="REFUS" />
              </div>
            </section>
          </div>

          <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
            <h3 className="font-black mb-4">Activité (7 derniers jours)</h3>
            {days.length === 0 ? (
              <p className="text-sm text-faint">Aucun appel sur les 7 derniers jours.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
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
              </div>
            )}
          </section>
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
    <div className={`profile-call-stat p-4 rounded-[18px] ${bg}`}>
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
