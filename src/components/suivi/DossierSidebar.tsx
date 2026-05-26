import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { fullName, initials } from '../../lib/types'

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
        {tel && (<><dt>Téléphone</dt><dd><a href={`tel:${tel}`}>{tel}</a></dd></>)}
        {mail && (<><dt>Email</dt><dd><a href={`mailto:${mail}`}>{mail}</a></dd></>)}
        <dt>Montant</dt><dd>{formatCurrency(dossier.amount)}</dd>
        <dt>Financement</dt><dd>{dossier.state.payMode === 'financement' ? 'Financement' : 'Comptant'}</dd>
        <dt>Signé le</dt><dd>{formatDate(dossier.signedAt)}</dd>
        {dossier.commercial && (<><dt>Commercial</dt><dd>{dossier.commercial.name}</dd></>)}
      </dl>

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
