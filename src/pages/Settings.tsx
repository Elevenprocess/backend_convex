import { useMemo, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { UserEditModal } from '../components/UserEditModal'
import { LoadingBlock, Spinner } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { inviteUser, updateUser, useGhlUsers, useInvitations, useUsers } from '../lib/hooks'
import { useTheme } from '../lib/theme'
import type { InvitationResponse, Role, Team, UserResponse } from '../lib/types'

const ROLE_BADGE: Record<Role, string> = {
  setter: 'bg-cuivre-tint text-cuivre',
  setter_lead: 'bg-cuivre-tint text-cuivre',
  commercial: 'bg-info-tint text-info',
  commercial_lead: 'bg-or-tint text-or-dark',
  admin: 'bg-rouille-tint text-rouille',
  delivrabilite: 'bg-info-tint text-info',
  responsable_technique: 'bg-info-tint text-info',
  back_office: 'bg-info-tint text-info',
  technicien: 'bg-info-tint text-info',
  finances: 'bg-rouille-tint text-rouille',
}

const ROLE_LABEL: Record<Role, string> = {
  setter: 'Setter',
  setter_lead: 'Setter Lead',
  commercial: 'Commercial',
  commercial_lead: 'Commercial Lead',
  admin: 'Admin',
  delivrabilite: 'Délivrabilité',
  responsable_technique: 'Responsable technique',
  back_office: 'Back office',
  technicien: 'Technicien',
  finances: 'Finances',
}

const ROLE_TINT: Record<Role, string> = {
  setter: 'bg-cuivre-tint',
  setter_lead: 'bg-cuivre-tint',
  commercial: 'bg-info-tint',
  commercial_lead: 'bg-or-tint',
  admin: 'bg-rouille-tint',
  delivrabilite: 'bg-info-tint',
  responsable_technique: 'bg-info-tint',
  back_office: 'bg-info-tint',
  technicien: 'bg-info-tint',
  finances: 'bg-rouille-tint',
}

// Mapping source de vérité côté backend : src/scripts/airtable/mappings.ts → mapTeam().
// 'delivrabilite' (deprecated) conservé pour les users existants — pas proposé à la création.
const TEAM_BY_ROLE: Record<Role, NonNullable<Team>> = {
  setter: 'setting',
  setter_lead: 'setting',
  commercial: 'closing',
  commercial_lead: 'closing',
  admin: 'admin',
  finances: 'admin',
  delivrabilite: 'delivrabilite',
  responsable_technique: 'delivrabilite',
  back_office: 'delivrabilite',
  technicien: 'delivrabilite',
}

export function Settings() {
  const role = useAuth((s) => s.user?.role)

  if (role === 'admin' || role === 'commercial_lead') return <SettingsAdmin />
  if (role === 'commercial') return <SettingsCommercial />
  return <Navigate to="/overview" replace />
}

function SettingsCommercial() {
  const { data: users, loading, error, refetch: refetchUsers } = useUsers()
  const setters = (users ?? []).filter((u) => u.role === 'setter')
  const activeCount = setters.filter((s) => s.active).length

  return (
    <AppShell flat>
      <Topbar />
      <main className="settings-page flex-grow overflow-auto">
        <header className="settings-header settings-reveal">
          <div>
            <span className="shot-eyebrow">Équipe</span>
            <h1>Setters de l'équipe</h1>
            <p>{setters.length} setter{setters.length > 1 ? 's' : ''} · {activeCount} actif{activeCount > 1 ? 's' : ''}</p>
          </div>
        </header>

        <section className="overview-air-card settings-reveal" style={{ animationDelay: '60ms', padding: 18 }}>
          <div className="shot-card-head">
            <h3>Setters</h3>
            <span><Icon name="phone" size={16} /></span>
          </div>
          {loading ? (
            <LoadingBlock label="Chargement…" />
          ) : error ? (
            <div className="py-8 text-center text-rouille text-sm">Erreur : {error}</div>
          ) : setters.length === 0 ? (
            <EmptyState label="Aucun setter." />
          ) : (
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead>
                  <tr>
                    <Th>Nom</Th>
                    <Th>Email</Th>
                    <Th>Statut</Th>
                    <Th right>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {setters.map((m) => (
                    <UserRow
                      key={m.id}
                      user={m}
                      ghlUsers={[]}
                      onMapped={refetchUsers}
                      onEdit={() => {}}
                      compact
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  )
}

function SettingsAdmin() {
  const { data: users, loading, error, refetch: refetchUsers } = useUsers()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null)
  const { data: invitations, refetch: refetchInvitations } = useInvitations()
  const { data: ghlUsers, error: ghlUsersError } = useGhlUsers()
  const isDark = useTheme((s) => s.isDark)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const team = users ?? []
  const pendingInvitations = (invitations ?? []).filter((i) => i.status === 'pending')
  const pendingInvitationByUserId = useMemo(() => {
    const map = new Map<string, InvitationResponse>()
    for (const invitation of invitations ?? []) {
      if (invitation.status === 'pending' && invitation.targetUserId) map.set(invitation.targetUserId, invitation)
    }
    return map
  }, [invitations])

  const counts = useMemo(() => ({
    total: team.length,
    active: team.filter((m) => m.active).length,
    setters: team.filter((m) => m.role === 'setter' || m.role === 'setter_lead').length,
    commerciaux: team.filter((m) => m.role === 'commercial' || m.role === 'commercial_lead').length,
    ops: team.filter((m) =>
      m.role === 'delivrabilite'
      || m.role === 'responsable_technique'
      || m.role === 'back_office'
      || m.role === 'technicien'
    ).length,
    admins: team.filter((m) => m.role === 'admin' || m.role === 'finances').length,
  }), [team])

  return (
    <AppShell flat>
      <Topbar />
      <main className="settings-page flex-grow overflow-auto">
        <header className="settings-header settings-reveal">
          <div>
            <span className="shot-eyebrow">Paramètres</span>
            <h1>Gestion de l'équipe</h1>
            <p>{counts.total} utilisateur{counts.total > 1 ? 's' : ''} · {counts.active} actif{counts.active > 1 ? 's' : ''}</p>
          </div>
          <div className="settings-header-actions">
            <button onClick={() => setInviteOpen(true)} className="settings-invite">
              <Icon name="plus" size={15} />
              Inviter un membre
            </button>
          </div>
        </header>

        <section className="settings-stats settings-reveal" style={{ animationDelay: '60ms' }}>
          <StatCard icon="users" value={counts.total} label="Utilisateurs" primary />
          <StatCard icon="phone" value={counts.setters} label="Setters" />
          <StatCard icon="target" value={counts.commerciaux} label="Commerciaux" />
          <StatCard icon="grid" value={counts.ops} label="Ops / Déliv." />
          <StatCard icon="shield" value={counts.admins} label="Admin / Fin." />
        </section>

        <section className="overview-air-card settings-reveal" style={{ animationDelay: '120ms', padding: 18 }}>
          <div className="shot-card-head">
            <h3>Membres de l'équipe</h3>
            <span><Icon name="users" size={16} /></span>
          </div>
          {loading ? (
            <LoadingBlock label="Chargement des membres…" />
          ) : error ? (
            <div className="py-8 text-center text-rouille text-sm">Erreur : {error}</div>
          ) : team.length === 0 ? (
            <EmptyState label="Aucun utilisateur." />
          ) : (
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead>
                  <tr>
                    <Th>Nom</Th>
                    <Th>Rôle</Th>
                    <Th>Statut</Th>
                    <Th>GHL</Th>
                    <Th right>Actions</Th>
                  </tr>
                </thead>
                <tbody>{team.map((m) => <UserRow key={m.id} user={m} ghlUsers={ghlUsers ?? []} onMapped={refetchUsers} onEdit={setEditingUser} />)}</tbody>
              </table>
            </div>
          )}
        </section>

        {pendingInvitations.length > 0 && (
          <section className="overview-air-card settings-reveal" style={{ animationDelay: '180ms', padding: 18 }}>
            <div className="shot-card-head">
              <h3>Invitations en attente</h3>
              <span><Icon name="mail" size={16} /></span>
            </div>
            <div className="space-y-2">
              {pendingInvitations.map((invitation) => <InvitationRow key={invitation.id} invitation={invitation} />)}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 settings-reveal" style={{ animationDelay: '240ms' }}>
          <section className="overview-air-card" style={{ padding: 18 }}>
            <div className="shot-card-head">
              <h3>Intégrations</h3>
              <span className="settings-mock-tag">Mock</span>
            </div>
            <div className="space-y-2.5">
              {ghlUsersError && <div className="rounded-lg bg-rouille-tint px-3 py-2 text-xs text-rouille">Users GHL indisponibles : {ghlUsersError}</div>}
              <IntegrationRow name="GoHighLevel" desc="Webhooks leads, agendas et mapping commerciaux" status="active" />
              <IntegrationRow name="Airtable" desc="Migration one-shot" status="done" />
              <IntegrationRow name="Twilio" desc="SMS de rappel" status="todo" />
            </div>
          </section>

          <section className="overview-air-card" style={{ padding: 18 }}>
            <div className="shot-card-head">
              <h3>Préférences</h3>
              <span className="settings-mock-tag">Mock</span>
            </div>
            <div className="space-y-2.5">
              <PrefRow label="Notifications email" enabled />
              <PrefRow label="Notifications in-app" enabled />
              <PrefRow label="Mode sombre" enabled={isDark} onClick={toggleTheme} />
              <PrefRow label="Débrief obligatoire post-RDV" enabled />
            </div>
          </section>
        </div>
      </main>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            refetchUsers()
            refetchInvitations()
          }}
        />
      )}
      {editingUser && (
        <UserEditModal
          user={editingUser}
          pendingInvitation={pendingInvitationByUserId.get(editingUser.id) ?? null}
          onClose={() => setEditingUser(null)}
          onChanged={() => {
            refetchUsers()
            refetchInvitations()
          }}
        />
      )}
    </AppShell>
  )
}

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const actorRole = useAuth((s) => s.user?.role)
  const isCommercialLead = actorRole === 'commercial_lead'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('setter')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const invitation = await inviteUser({
        name,
        email,
        phone: phone || null,
        role,
        team: TEAM_BY_ROLE[role],
      })
      onInvited()
      setMessage(invitation.emailSent ? 'Invitation envoyée par email.' : `SMTP non configuré. Lien à copier : ${invitation.inviteUrl}`)
      if (invitation.emailSent) {
        setName('')
        setEmail('')
        setPhone('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation impossible')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-noir/40 px-4">
      <form onSubmit={submit} className="settings-modal w-full max-w-lg p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="shot-eyebrow">Nouveau membre</span>
            <h3 className="text-xl font-bold mt-1">Inviter un membre</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text text-2xl leading-none -mt-1">×</button>
        </div>

        <Field label="Nom complet" value={name} onChange={setName} required />
        <Field label="Email" value={email} onChange={setEmail} type="email" required />
        <Field label="Téléphone" value={phone} onChange={setPhone} />

        <label className="block text-sm">
          <span className="eyebrow text-faint">Rôle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="settings-field-select">
            <optgroup label="Setting">
              <option value="setter">Setter</option>
              <option value="setter_lead">Setter Lead</option>
            </optgroup>
            <optgroup label="Closing">
              <option value="commercial">Commercial</option>
              <option value="commercial_lead">Commercial Lead</option>
            </optgroup>
            {!isCommercialLead && (
              <>
                <optgroup label="Délivrabilité">
                  <option value="responsable_technique">Responsable technique</option>
                  <option value="back_office">Back office</option>
                  <option value="technicien">Technicien</option>
                </optgroup>
                <optgroup label="Administration">
                  <option value="finances">Finances</option>
                  <option value="admin">Admin</option>
                </optgroup>
              </>
            )}
          </select>
        </label>

        {error && <div className="rounded-lg bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
        {message && <div className="rounded-lg bg-success-tint px-3 py-2 text-sm text-success break-words">{message}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-muted hover:text-text">Fermer</button>
          <button disabled={saving} className="settings-invite disabled:opacity-60 disabled:cursor-not-allowed justify-center min-w-[160px]">
            {saving ? <Spinner size={16} stroke={3} label="Envoi…" /> : 'Envoyer invitation'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="eyebrow text-faint">{label}</span>
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="settings-field-input" />
    </label>
  )
}

function UserRow({ user, ghlUsers, onMapped, onEdit, compact = false }: { user: UserResponse; ghlUsers: Array<{ id: string; name: string; email: string | null }>; onMapped: () => void; onEdit: (user: UserResponse) => void; compact?: boolean }) {
  const inits = userInitials(user.name)
  const [savingGhl, setSavingGhl] = useState(false)
  const navigate = useNavigate()
  const realUser = useAuth((s) => s.realUser)
  const viewAs = useAuth((s) => s.viewAs)

  const profileHref = user.role === 'commercial'
    ? `/team/commerciaux/${user.id}`
    : user.role === 'setter'
      ? `/team/setters/${user.id}`
      : null

  // Impersonation : admin → tout user ; commercial_lead → équipe commercial/setter ;
  // commercial → setter (en lecture seule).
  // Le back rejette les écritures (POST/PATCH/DELETE) en mode commercial→setter
  // via l'AuthGuard, donc même si l'UI affichait un bouton edit par erreur,
  // l'écriture serait bloquée 403 côté serveur.
  const canImpersonate = !!realUser
    && realUser.id !== user.id
    && user.active
    && (
      realUser.role === 'admin'
      || (realUser.role === 'commercial_lead' && (user.role === 'commercial' || user.role === 'commercial_lead' || user.role === 'setter' || user.role === 'setter_lead'))
      || (realUser.role === 'commercial' && user.role === 'setter')
    )

  async function saveGhlUser(ghlUserId: string) {
    setSavingGhl(true)
    try {
      await updateUser(user.id, { ghlUserId: ghlUserId || null })
      onMapped()
    } finally {
      setSavingGhl(false)
    }
  }

  function stop(e: MouseEvent) {
    e.stopPropagation()
  }

  function openProfile() {
    if (profileHref) navigate(profileHref)
  }

  return (
    <tr
      className={profileHref ? 'is-clickable' : ''}
      onClick={profileHref ? openProfile : undefined}
    >
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          {user.image ? (
            <img src={user.image} alt={user.name} className="w-7 h-7 rounded-full object-cover border border-line-soft" />
          ) : (
            <div className={`w-7 h-7 rounded-full ${ROLE_TINT[user.role]} flex items-center justify-center text-[10px] font-bold`}>{inits}</div>
          )}
          <span className="font-semibold">{user.name}</span>
        </div>
      </td>
      {compact
        ? <td className="px-3 py-3 text-muted">{user.email}</td>
        : <td className="px-3 py-3"><span className={`status-badge ${ROLE_BADGE[user.role]}`}>{ROLE_LABEL[user.role]}</span></td>}
      <td className="px-3 py-3"><span className={`status-badge ${user.active ? 'bg-success-tint text-success' : 'bg-rouille-tint text-rouille'}`}>{user.active ? 'Actif' : 'Inactif'}</span></td>
      {!compact && (
        <td className="px-3 py-3" onClick={stop}>
          {user.role === 'commercial' ? (
            <div className="flex items-center gap-2">
              <select
                value={user.ghlUserId ?? ''}
                disabled={savingGhl}
                onChange={(e) => void saveGhlUser(e.target.value)}
                className="max-w-[220px] rounded-lg border border-line bg-cream px-3 py-1.5 text-xs text-text outline-none focus:border-or disabled:opacity-60"
              >
                <option value="">Non relié</option>
                {ghlUsers.map((g) => <option key={g.id} value={g.id}>{g.name}{g.email ? ` · ${g.email}` : ''}</option>)}
              </select>
              <span className={`status-badge ${user.ghlUserId ? 'bg-success-tint text-success' : 'bg-muted/10 text-muted'}`}>{user.ghlUserId ? 'Relié' : 'À relier'}</span>
            </div>
          ) : <span className="text-xs text-faint">—</span>}
        </td>
      )}
      <td className="px-3 py-3" onClick={stop}>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={canImpersonate ? () => { viewAs(user); navigate('/overview') } : undefined}
            disabled={!canImpersonate}
            className="inline-flex items-center justify-center w-[88px] h-8 rounded-lg border border-or/30 text-xs font-semibold text-or hover:bg-or-tint hover:border-or transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Explorer
          </button>
          <button
            onClick={profileHref ? openProfile : undefined}
            disabled={!profileHref}
            className="inline-flex items-center justify-center w-[88px] h-8 rounded-lg border border-line text-xs font-semibold text-muted hover:text-text hover:border-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted disabled:hover:border-line"
          >
            Voir profil
          </button>
          {!compact && (
            <button
              onClick={() => onEdit(user)}
              className="inline-flex items-center justify-center w-[88px] h-8 rounded-lg border border-line text-xs font-semibold text-muted hover:text-text hover:border-muted transition-colors"
            >
              Modifier
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function InvitationRow({ invitation }: { invitation: InvitationResponse }) {
  return (
    <div className="settings-invite-row">
      <div className="min-w-0">
        <div className="font-semibold text-sm truncate">{invitation.name} · {invitation.email}</div>
        <div className="text-xs text-faint mt-0.5">{ROLE_LABEL[invitation.role]} · expire le {new Date(invitation.expiresAt).toLocaleString('fr-FR')}</div>
      </div>
      <span className="status-badge bg-or-tint text-or-dark flex-shrink-0">En attente</span>
    </div>
  )
}

function userInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
}

function StatCard({ icon, value, label, primary = false }: { icon: IconName; value: number | string; label: string; primary?: boolean }) {
  return (
    <div className={`settings-stat${primary ? ' is-primary' : ''}`}>
      <span className="settings-stat-icon"><Icon name={icon} size={18} /></span>
      <div className="settings-stat-body">
        <div className="settings-stat-value">{value}</div>
        <span className="settings-stat-label">{label}</span>
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="py-10 text-center text-faint text-sm">{label}</div>
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={right ? 'is-right' : ''}>{children}</th>
}

function IntegrationRow({ name, desc, status }: { name: string; desc: string; status: 'active' | 'done' | 'todo' }) {
  const dot = status === 'active' ? 'bg-success' : status === 'done' ? 'bg-info' : 'bg-faint'
  const label = status === 'active' ? 'Actif' : status === 'done' ? 'Terminé' : 'À configurer'
  return (
    <div className="settings-line">
      <div className={`settings-line-dot ${dot}`} />
      <div className="flex-grow min-w-0">
        <div className="text-sm font-semibold truncate">{name}</div>
        <div className="text-xs text-faint truncate">{desc}</div>
      </div>
      <span className="text-xs text-muted flex-shrink-0">{label}</span>
    </div>
  )
}

function PrefRow({ label, enabled, onClick }: { label: string; enabled: boolean; onClick?: () => void }) {
  const content = (
    <>
      <span className="text-sm">{label}</span>
      <div className={`theme-switch ${enabled ? 'active' : ''}`}><span /></div>
    </>
  )
  if (onClick) {
    return <button type="button" onClick={onClick} className="settings-pref-btn">{content}</button>
  }
  return <div className="settings-line justify-between">{content}</div>
}
