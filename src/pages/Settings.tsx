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
import { copyText, inviteUser, regenerateInvitation, revokeInvitation, syncGhlCommercialUsers, updateUser, useGhlCalendarConfig, useGhlUsers, useInvitations, useUsers } from '../lib/hooks'
import { notifyClipboardCopied } from '../lib/clipboardToast'
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

type TeamFilter = 'all' | 'setters' | 'commerciaux' | 'ops' | 'admins'

const FILTER_ROLES: Record<Exclude<TeamFilter, 'all'>, Role[]> = {
  setters: ['setter', 'setter_lead'],
  commerciaux: ['commercial', 'commercial_lead'],
  ops: ['delivrabilite', 'responsable_technique', 'back_office', 'technicien'],
  admins: ['admin', 'finances'],
}

const FILTER_LABEL: Record<TeamFilter, string> = {
  all: 'Tous les membres',
  setters: 'Setters',
  commerciaux: 'Commerciaux',
  ops: 'Ops / Déliv.',
  admins: 'Admin / Fin.',
}

function matchesFilter(role: Role, filter: TeamFilter): boolean {
  if (filter === 'all') return true
  return FILTER_ROLES[filter].includes(role)
}

// Rôles acquisition (setting + closing) : seuls visibles pour un commercial_lead.
const ACQUISITION_ROLES: Role[] = ['setter', 'setter_lead', 'commercial', 'commercial_lead']

export function Settings() {
  const role = useAuth((s) => s.user?.role)

  if (role === 'admin') return <SettingsAdmin />
  // commercial_lead = responsable d'équipe : ne gère que les setters et commerciaux.
  if (role === 'commercial_lead') return <SettingsAdmin restricted />
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
      <main className="settings-page flex-grow min-h-0 overflow-auto">
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

function SectorChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12px] font-bold transition ${
        active ? 'border-or bg-or-tint text-or-dark shadow-sm' : 'border-line bg-white text-muted hover:border-or/50'
      }`}
    >
      {label}
    </button>
  )
}

function SettingsAdmin({ restricted = false }: { restricted?: boolean }) {
  const { data: users, loading, error, refetch: refetchUsers } = useUsers()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [filter, setFilter] = useState<TeamFilter>('all')
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null)
  const { data: invitations, refetch: refetchInvitations } = useInvitations()
  const { data: ghlUsers, error: ghlUsersError } = useGhlUsers()
  const { data: ghlConfig } = useGhlCalendarConfig()
  // Secteur d'un commercial = mapping de son ghlCalendarId via les calendriers
  // sectoriels GHL (Ouest/Est/Sud/Nord). Filtre dispo quand on liste les commerciaux.
  const [sectorFilter, setSectorFilter] = useState<string>('all')
  const sectorByCalendar = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of ghlConfig?.sectors ?? []) if (s.calendarId) m.set(s.calendarId, s.sector)
    return m
  }, [ghlConfig])
  const sectorOptions = useMemo(
    () => (ghlConfig?.sectors ?? []).map((s) => s.sector).filter((s, i, a) => a.indexOf(s) === i),
    [ghlConfig],
  )
  const userSector = (u: UserResponse): string | null =>
    u.ghlCalendarId ? sectorByCalendar.get(u.ghlCalendarId) ?? null : null
  const [ghlSyncing, setGhlSyncing] = useState(false)
  const [ghlSyncMsg, setGhlSyncMsg] = useState<string | null>(null)
  // Commerciaux non reliés à un user GHL (email SaaS ≠ email GHL) : listés pour
  // que l'admin corrige l'email du compte → tant qu'ils sont là, leurs RDV et
  // leurs clients restent « sans commercial » dans le CRM.
  const [ghlUnmatched, setGhlUnmatched] = useState<{ id: string; name: string; email: string | null }[]>([])

  async function handleSyncGhl() {
    setGhlSyncing(true)
    setGhlSyncMsg(null)
    setGhlUnmatched([])
    try {
      const r = await syncGhlCommercialUsers()
      const parts = [`${r.matched.length} relié${r.matched.length > 1 ? 's' : ''}`]
      if (r.unmatched.length) parts.push(`${r.unmatched.length} non résolu${r.unmatched.length > 1 ? 's' : ''}`)
      if (r.alreadyMapped.length) parts.push(`${r.alreadyMapped.length} déjà lié${r.alreadyMapped.length > 1 ? 's' : ''}`)
      setGhlSyncMsg(`${parts.join(' · ')} (${r.ghlUserCount} users GHL)`)
      setGhlUnmatched(r.unmatched)
      refetchUsers()
    } catch (e) {
      setGhlSyncMsg(e instanceof Error ? e.message : 'Synchronisation GHL impossible')
    } finally {
      setGhlSyncing(false)
    }
  }
  const isDark = useTheme((s) => s.isDark)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  // commercial_lead : restreint la base aux setters et commerciaux uniquement.
  const team = useMemo(
    () => (users ?? []).filter((u) => !restricted || ACQUISITION_ROLES.includes(u.role)),
    [users, restricted],
  )
  const pendingInvitations = (invitations ?? []).filter(
    (i) => i.status === 'pending' && (!restricted || ACQUISITION_ROLES.includes(i.role)),
  )
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

  const visibleTeam = useMemo(() => {
    let list = team.filter((m) => matchesFilter(m.role, filter))
    if (filter === 'commerciaux' && sectorFilter !== 'all') {
      list = list.filter((m) =>
        sectorFilter === 'none' ? userSector(m) === null : userSector(m) === sectorFilter,
      )
    }
    return list
  }, [team, filter, sectorFilter, sectorByCalendar])
  const selectFilter = (next: TeamFilter) => setFilter((prev) => (prev === next && next !== 'all' ? 'all' : next))

  return (
    <AppShell flat>
      <Topbar />
      <main className="settings-page flex-grow min-h-0 overflow-auto">
        <header className="settings-header settings-reveal">
          <div>
            <span className="shot-eyebrow">Paramètres</span>
            <h1>Gestion de l'équipe</h1>
            <p>{counts.total} utilisateur{counts.total > 1 ? 's' : ''} · {counts.active} actif{counts.active > 1 ? 's' : ''}</p>
          </div>
          <div className="settings-header-actions">
            {!restricted && (
              <button onClick={handleSyncGhl} disabled={ghlSyncing} className="settings-invite" style={{ opacity: ghlSyncing ? 0.6 : 1 }} title="Relie automatiquement les commerciaux à leurs comptes GHL (par email)">
                <Icon name="sparkles" size={15} />
                {ghlSyncing ? 'Synchronisation…' : 'Synchroniser avec GHL'}
              </button>
            )}
            <button onClick={() => setInviteOpen(true)} className="settings-invite">
              <Icon name="plus" size={15} />
              Inviter un membre
            </button>
          </div>
        </header>
        {ghlSyncMsg && (
          <div className="settings-reveal" style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700 }}>
            <span className="status-badge bg-success-tint text-success">GHL : {ghlSyncMsg}</span>
          </div>
        )}
        {ghlUnmatched.length > 0 && (
          <div className="settings-reveal rounded-lg bg-rouille-tint px-3 py-2.5" style={{ margin: '0 0 8px' }}>
            <p className="text-xs font-bold text-rouille mb-1.5">
              {ghlUnmatched.length} commercial{ghlUnmatched.length > 1 ? 'aux' : ''} non relié{ghlUnmatched.length > 1 ? 's' : ''} à GHL — leurs RDV et clients resteront « sans commercial » tant que l'email du compte ne correspond pas à celui de GHL.
            </p>
            <ul className="space-y-0.5">
              {ghlUnmatched.map((u) => (
                <li key={u.id} className="text-[11px] font-semibold text-rouille/90">
                  {u.name}{u.email ? ` · ${u.email}` : ' · (aucun email)'}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="settings-stats settings-reveal" style={{ animationDelay: '60ms' }} aria-label="Filtrer les membres par type">
          <StatCard icon="users" value={counts.total} label="Utilisateurs" primary active={filter === 'all'} onClick={() => selectFilter('all')} />
          <StatCard icon="phone" value={counts.setters} label="Setters" active={filter === 'setters'} onClick={() => selectFilter('setters')} />
          <StatCard icon="target" value={counts.commerciaux} label="Commerciaux" active={filter === 'commerciaux'} onClick={() => selectFilter('commerciaux')} />
          {!restricted && <StatCard icon="grid" value={counts.ops} label="Ops / Déliv." active={filter === 'ops'} onClick={() => selectFilter('ops')} />}
          {!restricted && <StatCard icon="shield" value={counts.admins} label="Admin / Fin." active={filter === 'admins'} onClick={() => selectFilter('admins')} />}
        </section>

        <section className="overview-air-card settings-reveal" style={{ animationDelay: '120ms', padding: 18 }}>
          <div className="shot-card-head">
            <h3>
              {filter === 'all' ? 'Membres de l\'équipe' : `Membres · ${FILTER_LABEL[filter]}`}
              {!loading && !error && <span className="settings-count-pill">{visibleTeam.length}</span>}
            </h3>
            {filter === 'all'
              ? <span><Icon name="users" size={16} /></span>
              : <button type="button" onClick={() => setFilter('all')} className="settings-filter-reset"><Icon name="x" size={12} /> Tout afficher</button>}
          </div>
          {filter === 'commerciaux' && sectorOptions.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-black uppercase tracking-[0.12em] text-faint">Secteur</span>
              <SectorChip label="Tous" active={sectorFilter === 'all'} onClick={() => setSectorFilter('all')} />
              {sectorOptions.map((s) => (
                <SectorChip key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} active={sectorFilter === s} onClick={() => setSectorFilter(s)} />
              ))}
              <SectorChip label="Sans secteur" active={sectorFilter === 'none'} onClick={() => setSectorFilter('none')} />
            </div>
          )}
          {loading ? (
            <LoadingBlock label="Chargement des membres…" />
          ) : error ? (
            <div className="py-8 text-center text-rouille text-sm">Erreur : {error}</div>
          ) : team.length === 0 ? (
            <EmptyState label="Aucun utilisateur." />
          ) : visibleTeam.length === 0 ? (
            <EmptyState label={`Aucun membre dans « ${FILTER_LABEL[filter]} ».`} />
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
                <tbody>{visibleTeam.map((m) => <UserRow key={m.id} user={m} ghlUsers={ghlUsers ?? []} onMapped={refetchUsers} onEdit={setEditingUser} sector={userSector(m)} />)}</tbody>
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
              {pendingInvitations.map((invitation) => <InvitationRow key={invitation.id} invitation={invitation} onChanged={refetchInvitations} />)}
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
  const [result, setResult] = useState<InvitationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const invitation = await inviteUser({
        name,
        email,
        phone: phone || null,
        role,
        team: TEAM_BY_ROLE[role],
      })
      onInvited()
      setResult(invitation)
      setName('')
      setEmail('')
      setPhone('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation impossible')
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    if (!result?.inviteUrl) return
    await copyText(result.inviteUrl)
    notifyClipboardCopied({ message: "Lien d'invitation copié" })
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-noir/40 px-4">
        <div className="settings-modal w-full max-w-lg p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="shot-eyebrow">Invitation créée</span>
              <h3 className="text-xl font-bold mt-1">{result.name}</h3>
            </div>
            <button type="button" onClick={onClose} className="text-muted hover:text-text text-2xl leading-none -mt-1">×</button>
          </div>

          <div>
            <div className="eyebrow text-faint mb-1">Lien d'invitation à copier</div>
            <div className="flex gap-2">
              <input readOnly value={result.inviteUrl ?? ''} onClick={(e) => e.currentTarget.select()} className="min-w-0 flex-grow rounded-xl border border-line bg-white/70 px-3 py-2 text-xs font-mono outline-none" />
              <button type="button" onClick={copyLink} className="btn-primary rounded-xl px-3 py-2 text-xs inline-flex items-center gap-1">
                <Icon name="edit" size={12} /> Copier
              </button>
            </div>
          </div>

          <div className={`rounded-xl px-3 py-2 text-sm ${result.emailSent ? 'bg-success-tint text-success' : 'bg-cuivre-tint text-cuivre'}`}>
            {result.emailSent ? `Invitation aussi envoyée par email à ${result.email}.` : `Email non envoyé : copie le lien et envoie-le à ${result.email}.`}
          </div>

          <div className="flex justify-between gap-3 pt-2">
            <button type="button" onClick={() => setResult(null)} className="px-4 py-2 rounded-lg text-sm font-semibold text-muted hover:text-text">Inviter un autre</button>
            <button type="button" onClick={onClose} className="settings-invite justify-center min-w-[120px]">Fermer</button>
          </div>
        </div>
      </div>
    )
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

function UserRow({ user, ghlUsers, onMapped, onEdit, compact = false, sector = null }: { user: UserResponse; ghlUsers: Array<{ id: string; name: string; email: string | null }>; onMapped: () => void; onEdit: (user: UserResponse) => void; compact?: boolean; sector?: string | null }) {
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
        : <td className="px-3 py-3"><span className={`status-badge ${ROLE_BADGE[user.role]}`}>{ROLE_LABEL[user.role]}</span>{sector && <span className="status-badge bg-or-tint text-or-dark" style={{ marginLeft: 6 }}>{sector.charAt(0).toUpperCase() + sector.slice(1)}</span>}</td>}
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

function InvitationRow({ invitation, onChanged }: { invitation: InvitationResponse; onChanged: () => void }) {
  const [busy, setBusy] = useState<'copy' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function copyLink() {
    if (busy) return
    setBusy('copy')
    try {
      const refreshed = await regenerateInvitation(invitation.id)
      await copyText(refreshed.inviteUrl)
      notifyClipboardCopied({ message: "Lien d'invitation copié" })
      onChanged()
    } catch (err) {
      console.error('regenerateInvitation a échoué', err)
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (busy) return
    setBusy('delete')
    try {
      await revokeInvitation(invitation.id)
      onChanged()
    } catch {
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="settings-invite-row">
      <div className="min-w-0">
        <div className="font-semibold text-sm truncate">{invitation.name} · {invitation.email}</div>
        <div className="text-xs text-faint mt-0.5">{ROLE_LABEL[invitation.role]} · expire le {new Date(invitation.expiresAt).toLocaleString('fr-FR')}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="status-badge bg-or-tint text-or-dark">En attente</span>
        <button
          type="button"
          onClick={copyLink}
          disabled={busy !== null}
          title="Régénérer et copier le lien d'invitation"
          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-line text-muted hover:text-text hover:border-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'copy' ? <Spinner size={14} stroke={3} /> : <Icon name="edit" size={14} />}
        </button>
        {confirmDelete ? (
          <>
            <button type="button" onClick={remove} disabled={busy !== null} className="inline-flex items-center justify-center min-w-[78px] h-8 px-2 rounded-lg border border-rouille text-xs font-semibold text-rouille hover:bg-rouille-tint transition-colors disabled:opacity-50">
              {busy === 'delete' ? <Spinner size={14} stroke={3} /> : 'Confirmer'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy !== null} className="text-xs font-semibold text-muted px-2 py-1 rounded-lg hover:text-text transition-colors disabled:opacity-50">Annuler</button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
            title="Supprimer l'invitation"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-line text-muted hover:text-rouille hover:border-rouille transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function userInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
}

function StatCard({ icon, value, label, primary = false, active = false, onClick }: { icon: IconName; value: number | string; label: string; primary?: boolean; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`settings-stat${primary ? ' is-primary' : ''}${active ? ' is-active' : ''}`}
    >
      <span className="settings-stat-icon"><Icon name={icon} size={18} /></span>
      <div className="settings-stat-body">
        <div className="settings-stat-value">{value}</div>
        <span className="settings-stat-label">{label}</span>
      </div>
    </button>
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
