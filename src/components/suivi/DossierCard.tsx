import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { STATUS_LABEL, fullName, initials } from '../../lib/types'
import type { ClientResponse } from '../../lib/types'
import { clientCardSummary } from '../../lib/suivi-board'

type Props = {
  dossier: Dossier
  client?: ClientResponse
  onClick: () => void
}

export function DossierCard({ dossier, client, onClick }: Props) {
  const summary = clientCardSummary(client)
  const statusColor = summary?.blocked
    ? 'var(--color-rouille)'
    : summary?.delivered
      ? 'var(--color-or)'
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

      {summary && (
        <div className="suivi-card-tags">
          <span className="suivi-tag suivi-tag-phase">{summary.phaseLabel}</span>
          {summary.blocked && <span className="suivi-tag suivi-tag-blocked">bloqué</span>}
          {summary.missingDocsCount > 0 && (
            <span className="suivi-tag suivi-tag-missing">{summary.missingDocsCount} pièces</span>
          )}
          {summary.delivered && <span className="suivi-tag suivi-tag-done">livré</span>}
        </div>
      )}

      <footer className="suivi-card-foot">
        <span className="suivi-card-dot" style={{ background: statusColor }} aria-hidden />
        <span className="suivi-card-step">{stepLabel(dossier.activeStep)}</span>
        <span className="suivi-card-time">· {formatRelativeDate(dossier.signedAt)}</span>
        <span className="suivi-card-action">Ouvrir fiche + workflow</span>
      </footer>
    </button>
  )
}
