import { useEffect, useState } from 'react'
import {
  ApiError,
  bootstrapClient,
  createManualClient,
  type DuplicateLeadInfo,
} from '../../lib/api'
import type { ClientResponse } from '../../lib/types'

const FINANCEMENTS = [
  ['', '—'],
  ['comptant', 'Comptant'],
  ['financement', 'Financement'],
  ['financement_sans_apport', 'Financement sans apport'],
  ['apport_financement', 'Apport + financement'],
  ['paiement_10x', 'Paiement 10×'],
  ['paiement_12x', 'Paiement 12×'],
] as const

const inputCls =
  'rounded-lg border border-[var(--border,rgba(15,30,22,0.14))] bg-[var(--surface,transparent)] px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500'

/**
 * Modal « Nouveau client » : création manuelle d'un dossier délivrabilité
 * (lead absent de GHL, source='manual'). Sur 409 doublon, propose « Utiliser
 * ce lead » qui initialise le dossier du lead existant via bootstrapClient.
 */
export function NewClientModal({
  onCreated,
  onClose,
}: {
  onCreated: (client: ClientResponse) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    addressLine: '', city: '', postalCode: '',
    montantTotal: '', typeFinancement: '', signedAt: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateLeadInfo | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError(null); setDuplicate(null)
    try {
      const payload: Record<string, string> = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      }
      for (const k of ['phone', 'email', 'addressLine', 'city', 'postalCode', 'montantTotal', 'typeFinancement'] as const) {
        if (form[k].trim()) payload[k] = form[k].trim()
      }
      if (form.signedAt) payload.signedAt = new Date(form.signedAt).toISOString()
      onCreated(await createManualClient(payload as never))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const lead = (err.data as { lead?: DuplicateLeadInfo } | null)?.lead
        if (lead) setDuplicate(lead)
        else setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Échec de la création')
      }
    } finally {
      setSaving(false)
    }
  }

  const useExisting = async () => {
    if (!duplicate || saving) return
    setSaving(true); setError(null)
    try {
      onCreated(await bootstrapClient(duplicate.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de l’initialisation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-stretch justify-center bg-[rgba(15,30,22,0.58)] p-0 backdrop-blur-sm sm:items-center sm:p-7"
      role="dialog" aria-modal="true" aria-label="Nouveau client"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <form
        onSubmit={submit}
        className="flex w-full max-w-xl flex-col gap-4 overflow-y-auto bg-[var(--surface-raised,#fff)] p-5 text-[var(--text,inherit)] sm:rounded-2xl sm:shadow-xl"
      >
        <h2 className="text-lg font-semibold">Nouveau client</h2>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium opacity-70">Identité</legend>
          <label className="flex flex-col gap-1 text-sm">Prénom *
            <input required value={form.firstName} onChange={set('firstName')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Nom *
            <input required value={form.lastName} onChange={set('lastName')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Téléphone
            <input value={form.phone} onChange={set('phone')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Email
            <input type="email" value={form.email} onChange={set('email')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">Adresse
            <input value={form.addressLine} onChange={set('addressLine')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Ville
            <input value={form.city} onChange={set('city')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Code postal
            <input value={form.postalCode} onChange={set('postalCode')} className={inputCls} />
          </label>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-medium opacity-70">Vente (optionnel)</legend>
          <label className="flex flex-col gap-1 text-sm">Montant total (€)
            <input inputMode="decimal" value={form.montantTotal} onChange={set('montantTotal')} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Financement
            <select value={form.typeFinancement} onChange={set('typeFinancement')} className={inputCls}>
              {FINANCEMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">Signé le
            <input type="date" value={form.signedAt} onChange={set('signedAt')} className={inputCls} />
          </label>
        </fieldset>

        {duplicate && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Un lead existe déjà :{' '}
              <strong>{[duplicate.firstName, duplicate.lastName].filter(Boolean).join(' ') || duplicate.id}</strong>
              {' '}(statut {duplicate.status}{duplicate.hasDossier ? ', dossier déjà ouvert' : ''}).
            </p>
            <button
              type="button"
              onClick={useExisting}
              disabled={saving}
              className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-white disabled:opacity-60"
            >
              Utiliser ce lead
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm opacity-80">
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Création…' : 'Créer le client'}
          </button>
        </div>
      </form>
    </div>
  )
}
