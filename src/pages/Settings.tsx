import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import { UserEditModal } from '../components/UserEditModal'
import { LoadingBlock, Spinner } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { inviteUser, updateUser, useGhlUsers, useInvitations, useUsers } from '../lib/hooks'
import { useTheme } from '../lib/theme'
import type { InvitationResponse, Role, Team, UserResponse } from '../lib/types'

const ROLE_BADGE: Record<Role, string> = {
  setter: 'bg-cuivre-tint text-cuivre',
  commercial: 'bg-info-tint text-info',
  admin: 'bg-rouille-tint text-rouille',
  delivrabilite: 'bg-info-tint text-info',
}

const ROLE_LABEL: Record<Role, string> = {
  setter: 'Setter',
  commercial: 'Commercial',
  admin: 'Admin',
  delivrabilite: 'Délivrabilité',
}

const ROLE_TINT: Record<Role, string> = {
  setter: 'bg-cuivre-tint',
  commercial: 'bg-info-tint',
  admin: 'bg-rouille-tint',
  delivrabilite: 'bg-info-tint',
}

const TEAM_BY_ROLE: Record<Role, NonNullable<Team>> = {
  setter: 'setting',
  commercial: 'closing',
  admin: 'admin',
  delivrabilite: 'delivrabilite',
}

export function Settings() {
  const role = useAuth((s) => s.user?.role)

  if (role !== 'admin') return <Navigate to="/overview" replace />

  return <SettingsAdmin />
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
    setters: team.filter((m) => m.role === 'setter').length,
    commerciaux: team.filter((m) => m.role === 'commercial').length,
    admins: team.filter((m) => m.role === 'admin').length,
  }), [team])

  return (
    <AppShell blobsKey="admin">
      <Topbar eyebrow="PARAMÈTRES" title="Gestion de l'équipe" />
      <div className="px-8 pt-4 flex items-center justify-end flex-shrink-0">
        <button onClick={() => setInviteOpen(true)} className="btn-primary px-4 py-2 rounded-xl text-sm flex items-center gap-2">
          <Icon name="plus" size={14} />
          Inviter un membre
        </button>
      </div>

      <main className="p-8 pt-4 overflow-y-auto space-y-6 flex-grow">
        <div className="grid grid-cols-4 gap-6">
          <CountCard value={counts.total.toString()} label="UTILISATEURS" highlight />
          <CountCard value={counts.setters.toString()} label="SETTERS" />
          <CountCard value={counts.commerciaux.toString()} label="COMMERCIAUX" />
          <CountCard value={counts.admins.toString()} label="ADMIN" />
        </div>

        <div className="glass-card p-6">
          <h3 className="font-bold mb-4">Membres de l'équipe</h3>
          {loading ? (
            <LoadingBlock label="Chargement des membres…" />
          ) : error ? (
            <div className="py-8 text-center text-rouille text-sm">Erreur : {error}</div>
          ) : team.length === 0 ? (
            <div className="py-8 text-center text-faint text-sm">Aucun utilisateur.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-or-tint">
                <tr className="text-left eyebrow">
                  <Th>NOM</Th>
                  <Th>EMAIL</Th>
                  <Th>RÔLE</Th>
                  <Th>STATUT</Th>
                  <Th>GHL</Th>
                  <Th className="text-right">ACTIONS</Th>
                </tr>
              </thead>
              <tbody>{team.map((m) => <UserRow key={m.id} user={m} ghlUsers={ghlUsers ?? []} onMapped={refetchUsers} onEdit={setEditingUser} />)}</tbody>
            </table>
          )}
        </div>

        {pendingInvitations.length > 0 && (
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Invitations en attente</h3>
            <div className="space-y-2 text-sm">
              {pendingInvitations.map((invitation) => <InvitationRow key={invitation.id} invitation={invitation} />)}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          <div className="glass-card p-6 relative">
            <MockSubBanner />
            <h3 className="font-bold mb-4">Intégrations</h3>
            <div className="space-y-3">
              {ghlUsersError && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs text-rouille">Users GHL indisponibles : {ghlUsersError}</div>}
              <IntegrationRow name="GoHighLevel" desc="Webhooks leads, agendas et mapping commerciaux" status="active" />
              <IntegrationRow name="Airtable" desc="Migration one-shot" status="done" />
              <IntegrationRow name="Twilio" desc="SMS de rappel" status="todo" />
            </div>
          </div>

          <div className="glass-card p-6 relative">
            <MockSubBanner />
            <h3 className="font-bold mb-4">Préférences</h3>
            <div className="space-y-4 text-sm">
              <PrefRow label="Notifications email" enabled />
              <PrefRow label="Notifications in-app" enabled />
              <PrefRow label="Mode sombre" enabled={isDark} onClick={toggleTheme} />
              <PrefRow label="Débrief obligatoire post-RDV" enabled />
            </div>
          </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-noir/30 px-4">
      <form onSubmit={submit} className="glass-card w-full max-w-lg p-6 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-or">Nouveau membre</div>
            <h3 className="text-xl font-bold">Inviter un membre</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text text-xl">×</button>
        </div>

        <Field label="Nom complet" value={name} onChange={setName} required />
        <Field label="Email" value={email} onChange={setEmail} type="email" required />
        <Field label="Téléphone" value={phone} onChange={setPhone} />

        <label className="block text-sm">
          <span className="eyebrow text-faint">Rôle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="mt-1 w-full rounded-xl border border-line bg-white/70 px-3 py-2 outline-none focus:border-or">
            <option value="setter">Setter</option>
            <option value="commercial">Commercial</option>
            <option value="delivrabilite">Délivrabilité</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
        {message && <div className="rounded-xl bg-success-tint px-3 py-2 text-sm text-success break-words">{message}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-muted hover:text-text">Fermer</button>
          <button disabled={saving} className="btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
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
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white/70 px-3 py-2 outline-none focus:border-or" />
    </label>
  )
}

function UserRow({ user, ghlUsers, onMapped, onEdit }: { user: UserResponse; ghlUsers: Array<{ id: string; name: string; email: string | null }>; onMapped: () => void; onEdit: (user: UserResponse) => void }) {
  const inits = userInitials(user.name)
  const [savingGhl, setSavingGhl] = useState(false)

  async function saveGhlUser(ghlUserId: string) {
    setSavingGhl(true)
    try {
      await updateUser(user.id, { ghlUserId: ghlUserId || null })
      onMapped()
    } finally {
      setSavingGhl(false)
    }
  }

  return (
    <tr className="border-b border-line-soft last:border-0 hover:bg-white/40">
      <td className="px-3 py-3"><div className="flex items-center gap-3"><div className={`w-7 h-7 rounded-full ${ROLE_TINT[user.role]} flex items-center justify-center text-[10px] font-bold`}>{inits}</div><span className="font-semibold">{user.name}</span></div></td>
      <td className="px-3 py-3 text-muted">{user.email}</td>
      <td className="px-3 py-3"><span className={`status-badge ${ROLE_BADGE[user.role]}`}>{ROLE_LABEL[user.role]}</span></td>
      <td className="px-3 py-3"><span className={`status-badge ${user.active ? 'bg-success-tint text-success' : 'bg-rouille-tint text-rouille'}`}>{user.active ? 'Actif' : 'Inactif'}</span></td>
      <td className="px-3 py-3">
        {user.role === 'commercial' ? (
          <div className="flex items-center gap-2">
            <select
              value={user.ghlUserId ?? ''}
              disabled={savingGhl}
              onChange={(e) => void saveGhlUser(e.target.value)}
              className="max-w-[220px] rounded-xl border border-line bg-white/70 px-3 py-2 text-xs outline-none focus:border-or disabled:opacity-60"
            >
              <option value="">Non relié</option>
              {ghlUsers.map((g) => <option key={g.id} value={g.id}>{g.name}{g.email ? ` · ${g.email}` : ''}</option>)}
            </select>
            <span className={`status-badge ${user.ghlUserId ? 'bg-success-tint text-success' : 'bg-muted/10 text-muted'}`}>{user.ghlUserId ? 'Relié' : 'À relier'}</span>
          </div>
        ) : <span className="text-xs text-faint">—</span>}
      </td>
      <td className="px-3 py-3 text-right"><button onClick={() => onEdit(user)} className="text-xs text-muted hover:text-text font-semibold">Modifier</button></td>
    </tr>
  )
}

function InvitationRow({ invitation }: { invitation: InvitationResponse }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white/40 p-3">
      <div>
        <div className="font-semibold">{invitation.name} · {invitation.email}</div>
        <div className="text-xs text-faint">{ROLE_LABEL[invitation.role]} · expire le {new Date(invitation.expiresAt).toLocaleString('fr-FR')}</div>
      </div>
      <span className="status-badge bg-or-tint text-or-dark">En attente</span>
    </div>
  )
}

function userInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
}

function CountCard({ value, label, highlight = false }: { value: string; label: string; highlight?: boolean }) {
  return <div className="glass-card p-6 flex flex-col items-center text-center"><div className={`text-[32px] font-bold ${highlight ? 'text-or' : ''}`}>{value}</div><div className="eyebrow mt-1">{label}</div></div>
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 ${className}`}>{children}</th>
}

function MockSubBanner() {
  return <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest text-cuivre bg-cuivre-tint px-2 py-0.5 rounded-full">Mock</span>
}

function IntegrationRow({ name, desc, status }: { name: string; desc: string; status: 'active' | 'done' | 'todo' }) {
  const dot = status === 'active' ? 'bg-success' : status === 'done' ? 'bg-info' : 'bg-faint'
  const label = status === 'active' ? 'Actif' : status === 'done' ? 'Terminé' : 'À configurer'
  return <div className="flex items-center gap-3 p-3 bg-white/40 rounded-xl border border-line"><div className={`w-2 h-2 rounded-full ${dot}`} /><div className="flex-grow"><div className="text-sm font-semibold">{name}</div><div className="text-xs text-faint">{desc}</div></div><span className="text-xs text-muted">{label}</span></div>
}

function PrefRow({ label, enabled, onClick }: { label: string; enabled: boolean; onClick?: () => void }) {
  const content = <><span>{label}</span><div className={`theme-switch ${enabled ? 'active' : ''}`}><span /></div></>
  if (onClick) {
    return <button type="button" onClick={onClick} className="w-full flex items-center justify-between text-left rounded-xl p-1 -m-1 hover:bg-white/40 transition-colors">{content}</button>
  }
  return <div className="flex items-center justify-between">{content}</div>
}
