import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { useLeadDebriefs, updateLead, type UpdateLeadInput } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import { DEBRIEF_OUTCOME_LABEL, STATUS_LABEL, fieldOrDash, fullName, initials } from '../../lib/types'

type Props = {
  dossier: Dossier
  onLeadUpdated?: () => void
}

type EditForm = {
  firstName: string
  lastName: string
  phone: string
  email: string
  addressLine: string
  postalCode: string
  city: string
  typeLogement: string
  revenuFiscal: string
}

export function DossierSidebar({ dossier, onLeadUpdated }: Props) {
  const tel = dossier.lead.phone
  const mail = dossier.lead.email
  // No ghlContactId on LeadResponse — GHL button omitted
  const ghlId: string | undefined = undefined

  const { data: debriefs } = useLeadDebriefs(dossier.lead.id)
  const setterNote = dossier.lead.latestCallComment
  const sortedDebriefs = [...(debriefs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const hasHistory = Boolean(setterNote) || sortedDebriefs.length > 0

  const role = useAuth((s) => s.user?.role)
  const canEdit = role === 'admin' || role === 'responsable_technique' || role === 'back_office'
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>(() => leadToForm(dossier.lead))

  const startEdit = useCallback(() => {
    setEditError(null)
    setForm(leadToForm(dossier.lead))
    setEditing(true)
  }, [dossier.lead])

  const setField = useCallback((name: keyof EditForm, value: string) => {
    setForm((f) => ({ ...f, [name]: value }))
  }, [])

  const onSave = useCallback(async () => {
    setSaving(true)
    setEditError(null)
    try {
      await updateLead(dossier.lead.id, formToPatch(form))
      setEditing(false)
      onLeadUpdated?.()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Échec de l’enregistrement')
    } finally {
      setSaving(false)
    }
  }, [dossier.lead.id, form, onLeadUpdated])

  return (
    <aside className="suivi-side glass-card">
      <header className="suivi-side-head">
        <span className="suivi-side-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div>
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{dossier.lead.city || '—'}</span>
        </div>
      </header>

      {canEdit ? (
        <div className="suivi-edit-bar">
          {editing ? (
            <>
              <button type="button" className="suivi-edit-btn primary" onClick={onSave} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              <button type="button" className="suivi-edit-btn" onClick={() => setEditing(false)} disabled={saving}>
                Annuler
              </button>
            </>
          ) : (
            <button type="button" className="suivi-edit-btn" onClick={startEdit}>✎ Modifier la fiche</button>
          )}
          {editError ? <span className="suivi-edit-error">{editError}</span> : null}
        </div>
      ) : null}

      <dl className="suivi-side-list">
        <Info label="Statut" value={STATUS_LABEL[dossier.lead.status]} />
        {editing ? (
          <>
            <EditableInfo label="Prénom" editing display={fieldOrDash(dossier.lead.firstName)} value={form.firstName} onChange={(v) => setField('firstName', v)} placeholder="Prénom" />
            <EditableInfo label="Nom" editing display={fieldOrDash(dossier.lead.lastName)} value={form.lastName} onChange={(v) => setField('lastName', v)} placeholder="Nom" />
          </>
        ) : null}
        <EditableInfo label="Téléphone" editing={editing} display={tel ? <a href={`tel:${tel}`}>{tel}</a> : '—'} value={form.phone} onChange={(v) => setField('phone', v)} type="tel" placeholder="+262 692 ..." />
        <EditableInfo label="Email" editing={editing} display={mail ? <a href={`mailto:${mail}`}>{mail}</a> : '—'} value={form.email} onChange={(v) => setField('email', v)} type="email" placeholder="email@exemple.com" />
        <EditableInfo label="Adresse" editing={editing} display={fieldOrDash(dossier.lead.addressLine)} value={form.addressLine} onChange={(v) => setField('addressLine', v)} placeholder="N° et rue" />
        <EditableInfo label="Code postal" editing={editing} display={fieldOrDash(dossier.lead.postalCode)} value={form.postalCode} onChange={(v) => setField('postalCode', v)} placeholder="97430" />
        <EditableInfo label="Ville" editing={editing} display={fieldOrDash(dossier.lead.city)} value={form.city} onChange={(v) => setField('city', v)} placeholder="Le Tampon" />
        <EditableInfo label="Logement" editing={editing} display={fieldOrDash(dossier.lead.typeLogement)} value={form.typeLogement} onChange={(v) => setField('typeLogement', v)} placeholder="ex : maison" />
        <EditableInfo label="Revenu fiscal" editing={editing} display={dossier.lead.revenuFiscal ? `${dossier.lead.revenuFiscal.toLocaleString('fr-FR')} €` : '—'} value={form.revenuFiscal} onChange={(v) => setField('revenuFiscal', v)} type="number" placeholder="ex : 25000" />
        <Info label="Source" value={fieldOrDash(dossier.lead.source)} />
        <Info label="Canal" value={fieldOrDash(dossier.lead.canalAcquisition)} />
        <Info label="Campagne" value={fieldOrDash(dossier.lead.campaign)} />
        <Info label="Setter" value={dossier.setter?.name ?? '—'} />
        <Info label="Commercial" value={dossier.commercial?.name ?? fieldOrDash(dossier.lead.assignedToId)} />
        <Info label="Dernier appel" value={dossier.lead.latestCallAt ? formatDate(dossier.lead.latestCallAt) : '—'} />
        <Info label="RDV" value={dossier.rdv?.scheduledAt ? formatDate(dossier.rdv.scheduledAt) : fieldOrDash(dossier.lead.latestRdvAt)} />
        <Info label="Montant" value={formatCurrency(dossier.amount)} />
        <Info label="Financement" value={dossier.rdv?.financingType ?? (dossier.state.payMode === 'financement' ? 'Financement' : 'Comptant')} />
        <Info label="Signé le" value={dossier.rdv?.signatureAt ? formatDate(dossier.rdv.signatureAt) : (dossier.lead.status === 'signe' && dossier.signedAt ? formatDate(dossier.signedAt) : '—')} />
        <Info label="Objections" value={fieldOrDash(dossier.rdv?.objections)} />
        <Info label="Debrief commercial" value={fieldOrDash(dossier.rdv?.notes)} />
      </dl>

      {dossier.lead.customFields?.length ? (
        <section className="suivi-side-section">
          <h3>Données formulaire / setter</h3>
          <dl className="suivi-side-list">
            {dossier.lead.customFields.map((field) => (
              <Info key={`${field.fieldKey}-${field.fieldName}`} label={field.fieldName || field.fieldKey} value={fieldOrDash(field.value)} />
            ))}
          </dl>
        </section>
      ) : null}

      {hasHistory ? (
        <section className="suivi-side-section">
          <h3>Historique</h3>
          <div className="suivi-history">
            {sortedDebriefs.map((d) => (
              <article key={d.id} className="suivi-history-item">
                <div className="suivi-history-head">
                  <span className="suivi-history-kind">Débrief · {DEBRIEF_OUTCOME_LABEL[d.outcome] ?? d.outcome}</span>
                  <span className="suivi-history-date">{formatDate(d.createdAt)}</span>
                </div>
                {d.notes ? <p className="suivi-history-body">{d.notes}</p> : null}
                {d.objection ? <p className="suivi-history-meta">Objection : {d.objection}</p> : null}
              </article>
            ))}
            {setterNote ? (
              <article className="suivi-history-item is-setter">
                <div className="suivi-history-head">
                  <span className="suivi-history-kind">Note setter{dossier.setter?.name ? ` · ${dossier.setter.name}` : ''}</span>
                  {dossier.lead.latestCallAt ? <span className="suivi-history-date">{formatDate(dossier.lead.latestCallAt)}</span> : null}
                </div>
                <p className="suivi-history-body">{setterNote}</p>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="suivi-side-progress" aria-label={`Avancement global ${dossier.progress} pour cent`}>
        <div className="suivi-side-progress-head">
          <span>Avancement</span>
          <strong>{dossier.progress}%</strong>
        </div>
        <div className="suivi-side-progress-track">
          <div className="suivi-side-progress-fill" style={{ width: `${dossier.progress}%` }} />
        </div>
      </div>

      <div className="suivi-side-actions">
        {tel && <a className="suivi-side-cta" href={`tel:${tel}`}>Appeler</a>}
        {mail && <a className="suivi-side-cta" href={`mailto:${mail}`}>Email</a>}
        <button
          type="button"
          className="suivi-side-cta secondary"
          onClick={() => document.getElementById('workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          Aller au workflow
        </button>
        {ghlId && (
          <a
            className="suivi-side-cta secondary"
            href={`https://app.gohighlevel.com/v2/location/_/contacts/detail/${ghlId}`}
            target="_blank"
            rel="noreferrer"
          >
            Voir dans GHL
          </a>
        )}
      </div>
    </aside>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function EditableInfo({
  label,
  editing,
  display,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  editing: boolean
  display: ReactNode
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {editing ? (
          <input
            className="suivi-edit-input"
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          display
        )}
      </dd>
    </>
  )
}

function leadToForm(lead: Dossier['lead']): EditForm {
  return {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    addressLine: lead.addressLine ?? '',
    postalCode: lead.postalCode ?? '',
    city: lead.city ?? '',
    typeLogement: lead.typeLogement ?? '',
    revenuFiscal: lead.revenuFiscal != null ? String(lead.revenuFiscal) : '',
  }
}

/** Ne renvoie que les champs renseignés (on ne pousse pas de valeurs vides). */
function formToPatch(f: EditForm): UpdateLeadInput {
  const patch: UpdateLeadInput = {}
  const t = (v: string) => v.trim()
  if (t(f.firstName)) patch.firstName = t(f.firstName)
  if (t(f.lastName)) patch.lastName = t(f.lastName)
  if (t(f.phone)) patch.phone = t(f.phone)
  if (t(f.email)) patch.email = t(f.email)
  if (t(f.addressLine)) patch.addressLine = t(f.addressLine)
  if (t(f.postalCode)) patch.postalCode = t(f.postalCode)
  if (t(f.city)) patch.city = t(f.city)
  if (t(f.typeLogement)) patch.typeLogement = t(f.typeLogement)
  const rev = t(f.revenuFiscal)
  if (rev) {
    const n = Number(rev)
    if (!Number.isNaN(n)) patch.revenuFiscal = n
  }
  return patch
}
