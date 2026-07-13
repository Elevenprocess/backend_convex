import { useMemo, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { createLead, type CreateLeadInput } from '../../lib/hooks'
import { type LeadResponse, type Role, type UserResponse } from '../../lib/types'
import { Icon } from '../Icon'

type Mode = 'client' | 'lead'

type Props = {
  mode: Mode
  role: Role | undefined
  commerciaux?: UserResponse[]
  onClose: () => void
  onCreated?: (lead: LeadResponse) => void
}

type Draft = {
  firstName: string
  lastName: string
  phone: string
  email: string
  addressLine: string
  city: string
  postalCode: string
  revenuFiscal: string
  typeLogement: string
  canalAcquisition: string
  assignedToId: string
}

const EMPTY_DRAFT: Draft = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  addressLine: '',
  city: '',
  postalCode: '',
  revenuFiscal: '',
  typeLogement: '',
  canalAcquisition: 'Saisie manuelle',
  assignedToId: '',
}

function clean(value: string): string | null {
  const v = value.trim()
  return v === '' ? null : v
}

function cleanNumber(value: string): number | null {
  const v = value.trim()
  if (!v) return null
  const parsed = Number(v)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

export function ManualLeadModal({ mode, role, commerciaux = [], onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isClient = mode === 'client'
  const title = isClient ? 'Ajouter un client manuellement' : 'Ajouter un prospect manuellement'
  const subtitle = isClient
    ? 'Renseigne les informations de base. Le client sera ajouté au portefeuille commercial.'
    : 'Renseigne les informations de base. Le prospect sera ajouté à ta liste de traitement.'
  const canChooseCommercial = isClient && role !== 'commercial' && commerciaux.length > 0

  const selectedCommercial = useMemo(
    () => commerciaux.find((c) => c.id === draft.assignedToId) ?? null,
    [commerciaux, draft.assignedToId],
  )

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const hasIdentity = [draft.firstName, draft.lastName, draft.phone, draft.email].some((v) => v.trim())
    if (!hasIdentity) {
      setError('Ajoute au moins un nom, un téléphone ou un email.')
      return
    }

    setSaving(true)
    try {
      const payload: CreateLeadInput = {
        source: 'manual',
        status: isClient ? 'rdv_pris' : 'nouveau',
        firstName: clean(draft.firstName),
        lastName: clean(draft.lastName),
        phone: clean(draft.phone),
        email: clean(draft.email),
        addressLine: clean(draft.addressLine),
        city: clean(draft.city),
        postalCode: clean(draft.postalCode),
        revenuFiscal: cleanNumber(draft.revenuFiscal),
        typeLogement: clean(draft.typeLogement),
        canalAcquisition: clean(draft.canalAcquisition) ?? 'Saisie manuelle',
        acquisitionChannel: 'direct',
        assignedToId: canChooseCommercial ? clean(draft.assignedToId) : undefined,
      }
      const created = await createLead(payload)
      onCreated?.(created)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer la fiche.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-[24px] border border-line bg-white shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line bg-success-tint/40 px-5 py-4">
          <div>
            <span className="eyebrow text-[10px]">SAISIE MANUELLE</span>
            <h2 className="mt-1 text-xl font-black text-text">{title}</h2>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line bg-white p-2 text-muted hover:text-text" aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-5 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Prénom" value={draft.firstName} onChange={set('firstName')} autoFocus />
            <Field label="Nom" value={draft.lastName} onChange={set('lastName')} />
            <Field label="Téléphone" value={draft.phone} onChange={set('phone')} placeholder="+262 692 ..." />
            <Field label="Email" value={draft.email} onChange={set('email')} type="email" />
            <Field label="Adresse" value={draft.addressLine} onChange={set('addressLine')} className="sm:col-span-2" />
            <Field label="Ville" value={draft.city} onChange={set('city')} />
            <Field label="Code postal" value={draft.postalCode} onChange={set('postalCode')} />
            <Field label="Revenu fiscal" value={draft.revenuFiscal} onChange={set('revenuFiscal')} type="number" min="0" />
            <Field label="Type de logement" value={draft.typeLogement} onChange={set('typeLogement')} placeholder="Maison, appartement…" />
            <Field label="Canal d’acquisition" value={draft.canalAcquisition} onChange={set('canalAcquisition')} />
            {canChooseCommercial && (
              <label className="flex flex-col gap-1 text-xs font-bold text-muted">
                Commercial assigné
                <select
                  value={draft.assignedToId}
                  onChange={(e) => set('assignedToId')(e.target.value)}
                  className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-text outline-none focus:border-or"
                >
                  <option value="">Non assigné</option>
                  {commerciaux.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {selectedCommercial && <span className="text-[11px] font-medium text-faint">Client visible dans le portefeuille de {selectedCommercial.name}.</span>}
              </label>
            )}
          </div>

          {error && <div className="rounded-xl border border-rouille/30 bg-rouille-tint/40 px-3 py-2 text-sm font-semibold text-rouille">{error}</div>}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-muted hover:bg-line/30 disabled:opacity-50">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-success px-4 py-2 text-sm font-black text-white shadow-sm hover:brightness-95 disabled:opacity-60">
              <Icon name="plus" size={15} />
              {saving ? 'Création…' : isClient ? 'Ajouter le client' : 'Ajouter le prospect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, className = '', ...props }: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-bold text-muted ${className}`}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-text outline-none focus:border-or"
        {...props}
      />
    </label>
  )
}
