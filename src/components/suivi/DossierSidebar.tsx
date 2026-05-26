import type { ReactNode } from 'react'
import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { STATUS_LABEL, fieldOrDash, fullName, initials } from '../../lib/types'

type Props = {
  dossier: Dossier
}

export function DossierSidebar({ dossier }: Props) {
  const tel = dossier.lead.phone
  const mail = dossier.lead.email
  // No ghlContactId on LeadResponse — GHL button omitted
  const ghlId: string | undefined = undefined

  return (
    <aside className="suivi-side glass-card">
      <header className="suivi-side-head">
        <span className="suivi-side-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div>
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{dossier.lead.city || '—'}</span>
        </div>
      </header>

      <dl className="suivi-side-list">
        <Info label="Statut" value={STATUS_LABEL[dossier.lead.status]} />
        <Info label="Téléphone" value={tel ? <a href={`tel:${tel}`}>{tel}</a> : '—'} />
        <Info label="Email" value={mail ? <a href={`mailto:${mail}`}>{mail}</a> : '—'} />
        <Info label="Adresse" value={fieldOrDash(dossier.lead.addressLine)} />
        <Info label="Code postal" value={fieldOrDash(dossier.lead.postalCode)} />
        <Info label="Ville" value={fieldOrDash(dossier.lead.city)} />
        <Info label="Logement" value={fieldOrDash(dossier.lead.typeLogement)} />
        <Info label="Revenu fiscal" value={dossier.lead.revenuFiscal ? `${dossier.lead.revenuFiscal.toLocaleString('fr-FR')} €` : '—'} />
        <Info label="Source" value={fieldOrDash(dossier.lead.source)} />
        <Info label="Canal" value={fieldOrDash(dossier.lead.canalAcquisition)} />
        <Info label="Campagne" value={fieldOrDash(dossier.lead.campaign)} />
        <Info label="Setter" value={dossier.setter?.name ?? fieldOrDash(dossier.lead.setterId)} />
        <Info label="Commercial" value={dossier.commercial?.name ?? fieldOrDash(dossier.lead.assignedToId)} />
        <Info label="Dernier appel" value={dossier.lead.latestCallAt ? formatDate(dossier.lead.latestCallAt) : '—'} />
        <Info label="Note setter" value={fieldOrDash(dossier.lead.latestCallComment)} />
        <Info label="RDV" value={dossier.rdv?.scheduledAt ? formatDate(dossier.rdv.scheduledAt) : fieldOrDash(dossier.lead.latestRdvAt)} />
        <Info label="Montant" value={formatCurrency(dossier.amount)} />
        <Info label="Financement" value={dossier.rdv?.financingType ?? (dossier.state.payMode === 'financement' ? 'Financement' : 'Comptant')} />
        <Info label="Signé le" value={dossier.rdv?.signatureAt ? formatDate(dossier.rdv.signatureAt) : '—'} />
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
        <a className="suivi-side-cta secondary" href="#workflow">Aller au workflow</a>
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
