import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { STATUS_LABEL, fullName, initials } from '../../lib/types'

type Props = {
  dossier: Dossier
  onClick: () => void
}

export function DossierCard({ dossier, onClick }: Props) {
  const status = dossier.state.statuses[dossier.activeStep] ?? 'active'
  const statusColor =
    status === 'blocked' ? 'var(--color-rouille)'
    : status === 'lost' ? 'var(--color-rouille)'
    : status === 'done' ? 'var(--color-or)'
    : 'var(--color-cuivre)'

  return (
    <button type="button" className="suivi-card glass-card" onClick={onClick}>
      <header className="suivi-card-head">
        <span className="suivi-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div className="suivi-card-id">
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{dossier.lead.city || '—'} · {formatCurrency(dossier.amount)}</span>
        </div>
        <span className="suivi-status-pill">{STATUS_LABEL[dossier.lead.status]}</span>
      </header>
      <div className="suivi-card-meta-grid">
        <span><b>Tél.</b>{dossier.lead.phone || '—'}</span>
        <span><b>Email</b>{dossier.lead.email || '—'}</span>
        <span><b>Setter</b>{dossier.setter?.name || '—'}</span>
        <span><b>Commercial</b>{dossier.commercial?.name || '—'}</span>
      </div>
      <div className="suivi-card-progress" aria-label={`Progression ${dossier.progress}%`}>
        <div className="suivi-card-progress-track">
          <div className="suivi-card-progress-fill" style={{ width: `${dossier.progress}%` }} />
        </div>
        <span>{dossier.progress}%</span>
      </div>
      <footer className="suivi-card-foot">
        <span className="suivi-card-dot" style={{ background: statusColor }} aria-hidden />
        <span className="suivi-card-step">{stepLabel(dossier.activeStep)}</span>
        <span className="suivi-card-time">· {formatRelativeDate(dossier.signedAt)}</span>
        <span className="suivi-card-action">Ouvrir fiche + workflow</span>
      </footer>
    </button>
  )
}
