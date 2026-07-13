import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingScreen } from '../../components/Spinner'
import { SetterStatsSection } from '../../components/profils/SetterStatsSection'
import { useUser } from '../../lib/hooks'

export function ProfilSetter() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { data: member, loading, error } = useUser(id)

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

          {/* Statistiques & historique (calendrier dynamique + KPIs + graphiques) */}
          <SetterStatsSection setterId={id} />
        </div>
      </main>
    </AppShell>
  )
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
