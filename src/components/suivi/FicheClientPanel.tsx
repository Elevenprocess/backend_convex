import { useCallback, useState } from 'react'
import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { fullName, initials, STATUS_LABEL, type DebriefResponse } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { updateLead } from '../../lib/hooks'
import { type ClientEditForm, leadToClientForm, clientFormToPatch } from '../../lib/clientEditForm'
import { Section, Field, DebriefCard, formatDebriefPaymentMethod } from './fiche-parts'

type Props = {
  dossier: Dossier
  debriefs: DebriefResponse[]
  onSaved?: () => void
}

/**
 * Colonne gauche de la page Fiche complète : identité, coordonnées & données
 * collectées, puis l'historique « global » du client. Le back-office et le
 * responsable technique peuvent éditer en place toutes les coordonnées du
 * client (corriger ou effacer), avec propagation GHL via updateLead.
 */
export function FicheClientPanel({ dossier, debriefs, onSaved }: Props) {
  const lead = dossier.lead
  const setterNote = lead.latestCallComment
  const generalDebriefs = [...debriefs]
    .filter((d) => d.projectId == null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const role = useAuth((s) => s.user?.role)
  const canEdit = role === 'admin' || role === 'responsable_technique' || role === 'back_office'
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ClientEditForm>(() => leadToClientForm(lead))

  const setField = useCallback((name: keyof ClientEditForm, value: string) => {
    setForm((f) => ({ ...f, [name]: value }))
  }, [])

  const startEdit = useCallback(() => {
    setError(null)
    setForm(leadToClientForm(lead))
    setEditing(true)
  }, [lead])

  const onSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const patch = clientFormToPatch(lead, form)
      if (Object.keys(patch).length === 0) {
        setEditing(false)
        return
      }
      await updateLead(lead.id, patch)
      setEditing(false)
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’enregistrement')
    } finally {
      setSaving(false)
    }
  }, [lead, form, onSaved])

  // Financement & méthode de paiement = ce qui a été saisi au débriefing. On prend
  // le débrief le plus récent qui porte une de ces infos (tous projets confondus),
  // puis on en dérive le TYPE (+ organisme) et la MÉTHODE (chèque/espèces/virement)
  // depuis le MÊME débrief, pour deux champs cohérents. Repli sur le financement
  // du RDV pour le type si aucun débrief n'est renseigné.
  const financingDebrief = [...debriefs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find((d) => d.financingType || d.paymentSubMethod || d.financingOrg) ?? null

  const paymentMethodValue = financingDebrief ? formatDebriefPaymentMethod(financingDebrief) : null

  const editAction = canEdit
    ? editing
      ? (
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs font-semibold text-or hover:underline disabled:opacity-50" onClick={onSave} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" className="text-xs font-medium text-muted hover:underline disabled:opacity-50" onClick={() => setEditing(false)} disabled={saving}>
            Annuler
          </button>
        </div>
      )
      : (
        <button type="button" className="text-xs font-semibold text-or hover:underline" onClick={startEdit}>
          ✎ Modifier
        </button>
      )
    : undefined

  return (
    <aside className="space-y-7 rounded-2xl border border-line bg-card p-5 lg:sticky lg:top-4">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-or-tint text-base font-semibold text-or-dark">
          {initials(lead)}
        </span>
        <div className="min-w-0">
          <div className="eyebrow text-or-dark">Fiche client</div>
          <h2 className="truncate text-lg font-semibold text-text">{fullName(lead) || 'Client sans nom'}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-cream px-2 py-0.5 font-medium text-or-dark">{STATUS_LABEL[lead.status]}</span>
            {lead.city && <span>· {lead.city}</span>}
          </div>
        </div>
      </header>

      <Section title="Coordonnées & données" action={editAction}>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          {editing ? (
            <>
              <EditField label="Prénom" value={form.firstName} onChange={(v) => setField('firstName', v)} placeholder="Prénom" />
              <EditField label="Nom" value={form.lastName} onChange={(v) => setField('lastName', v)} placeholder="Nom" />
              <EditField label="Téléphone" value={form.phone} onChange={(v) => setField('phone', v)} type="tel" placeholder="+262 692 …" />
              <EditField label="Email" value={form.email} onChange={(v) => setField('email', v)} type="email" placeholder="email@exemple.com" />
              <EditField label="Adresse" value={form.addressLine} onChange={(v) => setField('addressLine', v)} placeholder="N° et rue" wide />
              <EditField label="Code postal" value={form.postalCode} onChange={(v) => setField('postalCode', v)} placeholder="97430" />
              <EditField label="Ville" value={form.city} onChange={(v) => setField('city', v)} placeholder="Le Tampon" />
              <EditField label="Localisation (Maps)" value={form.localisationMap} onChange={(v) => setField('localisationMap', v)} type="url" placeholder="https://maps.google.com/…" wide />
            </>
          ) : (
            <>
              <Field label="Téléphone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
              <Field label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
              <Field label="Adresse" value={lead.addressLine} wide />
              <Field label="Code postal" value={lead.postalCode} />
              <Field label="Ville" value={lead.city} />
              <Field label="Localisation" value={lead.localisationMap ? 'Ouvrir' : null} href={lead.localisationMap ?? undefined} />
            </>
          )}
          <Field label="Source" value={lead.source} />
          <Field label="Canal" value={lead.canalAcquisition} />
          <Field label="Campagne" value={lead.campaign} />
          <Field label="Setter" value={dossier.setter?.name} />
          <Field label="Commercial" value={dossier.commercial?.name} />
          <Field label="RDV" value={dossier.rdv?.scheduledAt ? formatDate(dossier.rdv.scheduledAt) : null} />
          <Field label="Montant" value={dossier.amount ? formatCurrency(dossier.amount) : null} />
          <Field
            label="Signé le"
            value={dossier.rdv?.signatureAt ? formatDate(dossier.rdv.signatureAt) : (dossier.signedAt ? formatDate(dossier.signedAt) : null)}
          />
          <Field label="Méthode de paiement" value={paymentMethodValue} wide />
        </dl>
        {error && <p className="mt-2 text-xs font-medium text-rouille">{error}</p>}
      </Section>

      {(generalDebriefs.length > 0 || setterNote) && (
        <Section title="Historique" count={generalDebriefs.length + (setterNote ? 1 : 0)}>
          <div className="space-y-3">
            {generalDebriefs.map((d) => (
              <DebriefCard key={d.id} debrief={d} />
            ))}
            {setterNote && (
              <article className="rounded-xl border border-line bg-card p-3.5 [border-left:3px_solid_var(--color-cuivre)]">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-text">
                    Note setter{dossier.setter?.name ? ` · ${dossier.setter.name}` : ''}
                  </span>
                  {lead.latestCallAt && <span className="shrink-0 text-[10px] font-medium text-faint">{formatDate(lead.latestCallAt)}</span>}
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{setterNote}</p>
              </article>
            )}
          </div>
        </Section>
      )}
    </aside>
  )
}

function EditField({
  label, value, onChange, type = 'text', placeholder, wide,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  wide?: boolean
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5">
        <input
          className="suivi-edit-input w-full"
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </dd>
    </div>
  )
}
