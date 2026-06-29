import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingScreen, Spinner } from '../../components/Spinner'
import { DateRangePicker } from '../../components/analytics/DateRangePicker'
import { SetterCharts } from '../../components/profils/SetterCharts'
import { useUser, useSetterStats } from '../../lib/hooks'
import { buildPeriodRange, defaultPeriod, type PeriodState } from '../../lib/period'

export function ProfilSetter() {
  const { id } = useParams()
  const navigate = useNavigate()

  // Période par défaut : ce mois-ci (vue d'ensemble plus parlante qu'« aujourd'hui »).
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod('this_month'))
  const range = useMemo(() => buildPeriodRange(period), [period])

  const { data: member, loading, error } = useUser(id)
  const { data: stats, loading: statsLoading } = useSetterStats(id, { from: range.from, to: range.to })

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
                <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                  <span className="profile-chip profile-chip-dark">Setter</span>
                  <span className="profile-chip profile-chip-soft">{member.team ?? 'Sans équipe'}</span>
                  <span className="profile-chip profile-chip-success">Depuis {monthsSince(member.createdAt)}</span>
                  {member.phone && <span className="profile-chip profile-chip-info">{member.phone}</span>}
                </div>
              </div>
            </div>
          </section>

          {/* Sélecteur de période (calendrier dynamique : jour unique ou plage de dates) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="eyebrow text-or-dark">Période</span>
              <span className="font-bold text-text">{range.label}</span>
              {statsLoading && <Spinner size={14} />}
            </div>
            <DateRangePicker value={period} onChange={setPeriod} align="right" />
          </div>

          {/* KPIs minimalistes */}
          <KpiStrip stats={stats} loading={statsLoading} />

          {/* Statistiques & historique (graphiques + camemberts) */}
          {stats ? (
            <SetterCharts stats={stats} />
          ) : (
            <section className="profile-info-card glass-card border border-line-soft bg-white p-10 text-center">
              {statsLoading ? <Spinner /> : <p className="text-sm text-faint">Aucune donnée sur la période.</p>}
            </section>
          )}
        </div>
      </main>
    </AppShell>
  )
}

// ── KPIs minimalistes ─────────────────────────────────────────────────────────

type SetterStats = NonNullable<ReturnType<typeof useSetterStats>['data']>

function KpiStrip({ stats, loading }: { stats: SetterStats | null; loading: boolean }) {
  const items: { value: string; label: string }[] = stats
    ? [
        { value: String(stats.calls), label: 'Appels' },
        { value: String(stats.connected), label: 'Connexions' },
        { value: String(stats.qualified), label: 'Qualifiés' },
        { value: String(stats.rdvPris), label: 'RDV pris' },
        { value: `${stats.qualificationRate}%`, label: 'Taux qualif.' },
        { value: `${stats.connectionRate}%`, label: 'Taux connexion' },
      ]
    : []

  return (
    <section className="profile-info-card glass-card border border-line-soft bg-white p-1.5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {loading && !stats
          ? Array.from({ length: 6 }).map((_, i) => <KpiCell key={i} value="—" label="…" />)
          : items.map((it) => <KpiCell key={it.label} value={it.value} label={it.label} />)}
      </div>
    </section>
  )
}

function KpiCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-4 text-center sm:text-left">
      <div className="text-2xl font-black leading-none tracking-tight text-text md:text-[28px]">{value}</div>
      <div className="eyebrow mt-1.5 text-[10px] text-muted">{label}</div>
    </div>
  )
}

// ── utilitaires ────────────────────────────────────────────────────────────────

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
