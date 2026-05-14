import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { deleteUser, renewUser, updateUser } from '../lib/hooks'
import { notifyClipboardCopied } from '../lib/clipboardToast'
import type { InvitationResponse, Role, Team, UserResponse } from '../lib/types'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'setter', label: 'Setter' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'admin', label: 'Admin' },
  { value: 'delivrabilite', label: 'Délivrabilité' },
]

const TEAM_BY_ROLE: Record<Role, NonNullable<Team>> = {
  setter: 'setting',
  commercial: 'closing',
  admin: 'admin',
  delivrabilite: 'delivrabilite',
}

type Props = {
  user: UserResponse
  pendingInvitation: InvitationResponse | null
  onClose: () => void
  onChanged: () => void
}

export function UserEditModal({ user, pendingInvitation, onClose, onChanged }: Props) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [role, setRole] = useState<Role>(user.role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRenew, setConfirmRenew] = useState(false)
  const [renewedUrl, setRenewedUrl] = useState<string>('')
  const [renewedEmailSent, setRenewedEmailSent] = useState(false)

  const accountStatus = computeAccountStatus(user, pendingInvitation)

  async function submitEdit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const patch: Parameters<typeof updateUser>[1] = {}
      if (name.trim() !== user.name) patch.name = name.trim()
      if (phone !== (user.phone ?? '')) patch.phone = phone.trim() === '' ? null : phone.trim()
      if (role !== user.role) {
        patch.role = role
        patch.team = TEAM_BY_ROLE[role]
      }
      if (email.trim().toLowerCase() !== user.email) {
        throw new Error("Pour modifier l'email, utilise Renouveler le compte : ça régénère un lien de mot de passe.")
      }
      if (Object.keys(patch).length > 0) await updateUser(user.id, patch)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  async function doRenew() {
    setSaving(true)
    setError(null)
    try {
      const payload: Parameters<typeof renewUser>[1] = {}
      if (name.trim() !== user.name) payload.name = name.trim()
      if (email.trim().toLowerCase() !== user.email) payload.email = email.trim().toLowerCase()
      if (phone !== (user.phone ?? '')) payload.phone = phone.trim() === '' ? null : phone.trim()
      if (role !== user.role) {
        payload.role = role
        payload.team = TEAM_BY_ROLE[role]
      }
      const res = await renewUser(user.id, payload)
      setRenewedUrl(res.inviteUrl)
      setRenewedEmailSent(res.emailSent)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
      setConfirmRenew(false)
    }
  }

  async function doDelete() {
    setSaving(true)
    setError(null)
    try {
      await deleteUser(user.id)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  async function copyLink() {
    await copyText(renewedUrl)
    notifyClipboardCopied({ message: "Lien d'invitation copié" })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-noir/40 px-4">
      <div className="glass-card w-full max-w-xl max-h-[90vh] overflow-y-auto p-0 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <div className="eyebrow text-or">Utilisateur</div>
            <h3 className="text-xl font-bold">Modifier l'utilisateur</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text text-xl">×</button>
        </div>

        {renewedUrl ? (
          <div className="px-6 py-6 space-y-4">
            <div className="rounded-xl bg-success-tint px-3 py-2 text-sm text-success">
              Compte renouvelé. Le mot de passe précédent est invalidé.
            </div>
            <div>
              <div className="eyebrow text-faint mb-1">Lien de création de mot de passe</div>
              <div className="flex gap-2">
                <input readOnly value={renewedUrl} onClick={(e) => e.currentTarget.select()} className="min-w-0 flex-grow rounded-xl border border-line bg-white/70 px-3 py-2 text-xs font-mono outline-none" />
                <button type="button" onClick={copyLink} className="btn-primary rounded-xl px-3 py-2 text-xs inline-flex items-center gap-1">
                  <Icon name="edit" size={12} /> Copier
                </button>
              </div>
            </div>
            <div className={`rounded-xl px-3 py-2 text-sm ${renewedEmailSent ? 'bg-success-tint text-success' : 'bg-cuivre-tint text-cuivre'}`}>
              {renewedEmailSent ? `Email envoyé à ${email}.` : `Email non envoyé : copie le lien et envoie-le à ${email}.`}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="btn-primary px-4 py-2 rounded-xl text-sm">Fermer</button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-line-soft px-6 py-4">
              <div className="eyebrow text-faint mb-2">Statut compte</div>
              <AccountStatusBadge status={accountStatus} />
            </div>

            <form onSubmit={submitEdit} className="px-6 py-4 space-y-3">
              <LabeledInput label="Nom" value={name} onChange={setName} required />
              <LabeledInput label="Email" value={email} onChange={setEmail} type="email" required />
              <LabeledInput label="Téléphone" value={phone} onChange={setPhone} />
              <label className="block text-sm">
                <span className="eyebrow text-faint">Rôle</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="mt-1 w-full rounded-xl border border-line bg-white/70 px-3 py-2 outline-none focus:border-or">
                  {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>

              {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold text-muted hover:text-text disabled:opacity-50">Annuler</button>
                <button disabled={saving} className="btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-60 inline-flex items-center gap-2">
                  {saving && <Spinner size={14} stroke={2} />}
                  Enregistrer
                </button>
              </div>
            </form>

            <div className="border-t border-line bg-or-tint/30 px-6 py-4 space-y-3">
              <div className="eyebrow text-faint">Actions admin</div>
              {!confirmRenew ? (
                <button type="button" onClick={() => setConfirmRenew(true)} disabled={saving} className="w-full rounded-xl border border-cuivre bg-white/70 p-3 text-left hover:bg-cuivre-tint/30 disabled:opacity-50">
                  <div className="font-semibold text-sm flex items-center gap-2"><Icon name="edit" size={14} /> Renouveler / recréer le compte</div>
                  <div className="text-xs text-muted mt-1">Modifie aussi l'email si besoin et génère un lien de création de mot de passe sans perdre les leads/RDV.</div>
                </button>
              ) : (
                <ConfirmBox tone="cuivre" text="Le mot de passe actuel sera supprimé et un nouveau lien sera généré." saving={saving} onCancel={() => setConfirmRenew(false)} onConfirm={doRenew} />
              )}

              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className="w-full rounded-xl border border-rouille bg-white/70 p-3 text-left hover:bg-rouille-tint/30 disabled:opacity-50">
                  <div className="font-semibold text-sm text-rouille flex items-center gap-2"><Icon name="trash" size={14} /> Supprimer l'utilisateur</div>
                  <div className="text-xs text-muted mt-1">Désactive le compte. L'historique reste conservé.</div>
                </button>
              ) : (
                <ConfirmBox tone="rouille" text={`Supprimer ${user.name} ? Il ne pourra plus se connecter.`} saving={saving} onCancel={() => setConfirmDelete(false)} onConfirm={doDelete} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

type AccountStatus = 'complete' | 'pending' | 'imported'

function computeAccountStatus(user: UserResponse, invitation: InvitationResponse | null): AccountStatus {
  if (user.lastLoginAt) return 'complete'
  if (invitation && invitation.status === 'pending') return 'pending'
  return 'imported'
}

function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === 'complete') return <span className="status-badge bg-success-tint text-success">✓ Compte complet</span>
  if (status === 'pending') return <span className="status-badge bg-cuivre-tint text-cuivre">⏳ Invitation en attente</span>
  return <span className="status-badge bg-rouille-tint text-rouille">⚠ Importé Airtable / jamais activé</span>
}

function ConfirmBox({ tone, text, saving, onCancel, onConfirm }: { tone: 'cuivre' | 'rouille'; text: string; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  const buttonClass = tone === 'rouille' ? 'bg-rouille text-white' : 'btn-primary'
  return (
    <div className={`rounded-xl border ${tone === 'rouille' ? 'border-rouille' : 'border-cuivre'} bg-white/80 p-3`}>
      <div className="text-sm font-semibold mb-3">{text}</div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="text-xs text-faint disabled:opacity-50">Annuler</button>
        <button type="button" onClick={onConfirm} disabled={saving} className={`${buttonClass} px-3 py-1.5 rounded-lg text-xs disabled:opacity-60 inline-flex items-center gap-2`}>
          {saving && <Spinner size={12} stroke={2} />}
          Confirmer
        </button>
      </div>
    </div>
  )
}

function LabeledInput({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="eyebrow text-faint">{label}</span>
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white/70 px-3 py-2 outline-none focus:border-or" />
    </label>
  )
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}
