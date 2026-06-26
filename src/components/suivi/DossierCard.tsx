import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { STATUS_LABEL, fullName, initials } from '../../lib/types'
import type { ClientResponse } from '../../lib/types'
import { clientCardSummary, workflowPhaseProgress } from '../../lib/suivi-board'

type Props = {
  dossier: Dossier
  client?: ClientResponse
  /** Nombre de projets (clients) rattachés à ce lead. */
  projectCount?: number
  onClick: () => void
}

export function DossierCard({ dossier, client, projectCount, onClick }: Props) {
  const summary = clientCardSummary(client)
  const workflowProgress = workflowPhaseProgress(client)
  const statusColor = summary?.blocked
    ? 'var(--color-rouille)'
    : summary?.delivered
      ? 'var(--color-or)'
      : 'var(--color-cuivre)'

  const projectName = summary?.phaseLabel ?? 'Projet signé'
  const count = projectCount ?? 0
  const amountLabel = dossier.amount > 0 ? formatCurrency(dossier.amount) : null
  const signedAt = client?.signedAt ?? dossier.rdv?.signatureAt ?? null

  return (
    <button type="button" className="suivi-card glass-card" onClick={onClick}>
      <header className="suivi-card-head">
        <span className="suivi-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div className="suivi-card-id">
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{[dossier.lead.city, amountLabel].filter(Boolean).join(' · ') || '—'}</span>
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
        {workflowProgress && (
        <div className="suivi-card-progress" aria-label={`Progression ${workflowProgress.pct}%`}>
          <div className="suivi-card-progress-track">
            <div className="suivi-card-progress-fill" style={{ width: `${workflowProgress.pct}%` }} />
          </div>
          <span>{workflowProgress.pct}%</span>
        </div>
        )}
      </div>

      {summary && (summary.blocked || summary.installed || summary.delivered) && (
        <div className="suivi-card-tags">
          {summary.blocked && <span className="suivi-tag suivi-tag-blocked">bloqué</span>}
          {summary.installed && !summary.delivered && <span className="suivi-tag suivi-tag-installed">Installé</span>}
          {summary.delivered && <span className="suivi-tag suivi-tag-done">livré</span>}
        </div>
      )}

      <footer className="suivi-card-foot">
        <span className="suivi-card-dot" style={{ background: statusColor }} aria-hidden />
        <span className="suivi-card-step">{summary?.phaseLabel ?? stepLabel(dossier.activeStep)}</span>
        {signedAt && <span className="suivi-card-time">· {formatRelativeDate(signedAt)}</span>}
        <span className="suivi-card-action">Ouvrir la fiche</span>
      </footer>
    </button>
  )
}
