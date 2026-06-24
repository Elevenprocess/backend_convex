import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { STATUS_LABEL, fullName, initials } from '../../lib/types'
import type { ClientResponse } from '../../lib/types'
import { clientCardSummary } from '../../lib/suivi-board'

type Props = {
  dossier: Dossier
  client?: ClientResponse
  /** Nombre de projets (clients) rattachés à ce lead. */
  projectCount?: number
  onClick: () => void
}

export function DossierCard({ dossier, client, projectCount, onClick }: Props) {
  const summary = clientCardSummary(client)
  const statusColor = summary?.blocked
    ? 'var(--color-rouille)'
    : summary?.delivered
      ? 'var(--color-or)'
      : 'var(--color-cuivre)'

  const projectName = summary?.phaseLabel ?? stepLabel(dossier.activeStep)
  const count = projectCount ?? 0

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
      </div>

      {/* Projet : nom + nombre de projets, jauge d'avancement juste en dessous */}
      <div className="suivi-card-project">
        <div className="suivi-card-project-row">
          <span className="suivi-card-project-name">{projectName}</span>
          {count > 0 && (
            <span className="suivi-card-project-count">{count} projet{count > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="suivi-card-progress" aria-label={`Progression ${dossier.progress}%`}>
          <div className="suivi-card-progress-track">
            <div className="suivi-card-progress-fill" style={{ width: `${dossier.progress}%` }} />
          </div>
          <span>{dossier.progress}%</span>
        </div>
      </div>

      {summary && (summary.blocked || summary.missingDocsCount > 0 || summary.delivered) && (
        <div className="suivi-card-tags">
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
        <span className="suivi-card-action">Ouvrir la fiche</span>
      </footer>
    </button>
  )
}
