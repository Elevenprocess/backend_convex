import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { fullName } from '../../lib/types'
import type { ClientResponse } from '../../lib/types'
import { clientCardSummary, workflowPhaseProgress } from '../../lib/suivi-board'

type Props = {
  dossier: Dossier
  client?: ClientResponse
  /** Nombre de projets (clients) rattachés à ce lead. */
  projectCount?: number
  onClick: () => void
}

/**
 * Carte dossier (liste Délivrabilité) — volontairement minimaliste : nom,
 * localisation/contact, jauge fine, phase courante + état. Le détail (email,
 * statut, actions) vit dans la fiche.
 */
export function DossierCard({ dossier, client, projectCount, onClick }: Props) {
  const summary = clientCardSummary(client)
  const progress = workflowPhaseProgress(client)
  const tone = summary?.blocked ? 'blocked' : summary?.delivered ? 'done' : summary?.installed ? 'installed' : 'running'

  const count = projectCount ?? 0
  const amountLabel = dossier.amount > 0 ? formatCurrency(dossier.amount) : null
  const signedAt = client?.signedAt ?? dossier.rdv?.signatureAt ?? null
  const phase = summary?.phaseLabel ?? stepLabel(dossier.activeStep)
  const meta = [dossier.lead.city, dossier.lead.phone, count > 1 ? `${count} projets` : null].filter(Boolean).join(' · ')

  return (
    <button type="button" className={`dcard dcard--${tone}`} onClick={onClick}>
      <div className="dcard-head">
        <strong className="dcard-name">{fullName(dossier.lead) || 'Client sans nom'}</strong>
        {progress && <span className="dcard-pct" aria-label={`Progression ${progress.pct}%`}>{progress.pct}%</span>}
      </div>
      {meta && <span className="dcard-meta">{meta}</span>}

      <div className="dcard-track" aria-hidden>
        <div className="dcard-fill" style={{ width: `${progress?.pct ?? 0}%` }} />
      </div>

      <div className="dcard-foot">
        <span className="dcard-dot" aria-hidden />
        <span className="dcard-phase">{phase}</span>
        {signedAt && <span className="dcard-time">· {formatRelativeDate(signedAt)}</span>}
        <span className="dcard-end">
          {summary?.blocked && <span className="dcard-tag dcard-tag--blocked">bloqué</span>}
          {summary?.installed && !summary.delivered && <span className="dcard-tag dcard-tag--installed">Installé</span>}
          {summary?.delivered && <span className="dcard-tag dcard-tag--done">livré</span>}
          {amountLabel && <span className="dcard-amount">{amountLabel}</span>}
        </span>
      </div>
    </button>
  )
}
