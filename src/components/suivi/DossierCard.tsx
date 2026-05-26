import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { fullName, initials } from '../../lib/types'

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
    <button type="button" className="suivi-v2-card glass-card" onClick={onClick}>
      <header className="suivi-v2-card-head">
        <span className="suivi-v2-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div className="suivi-v2-card-id">
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{dossier.lead.city || '—'} · {formatCurrency(dossier.amount)}</span>
        </div>
      </header>
      <div className="suivi-v2-card-progress" aria-label={`Progression ${dossier.progress}%`}>
        <div className="suivi-v2-card-progress-track">
          <div className="suivi-v2-card-progress-fill" style={{ width: `${dossier.progress}%` }} />
        </div>
        <span>{dossier.progress}%</span>
      </div>
      <footer className="suivi-v2-card-foot">
        <span className="suivi-v2-card-dot" style={{ background: statusColor }} aria-hidden />
        <span className="suivi-v2-card-step">{stepLabel(dossier.activeStep)}</span>
        <span className="suivi-v2-card-time">· {formatRelativeDate(dossier.signedAt)}</span>
      </footer>
    </button>
  )
}
