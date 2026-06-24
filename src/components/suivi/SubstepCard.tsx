import { Icon } from '../Icon'
import { formatDate } from '../../lib/suivi'
import type { SubstepResponse, UserResponse } from '../../lib/types'

type Props = {
  substep: SubstepResponse
  users?: UserResponse[]
  today: string
  onOpen: () => void
}

/**
 * « Nœud » d'un module du workflow façon N8N : un rond + un titre, cliquable.
 * Sous le titre, une caption très discrète rappelle, d'un seul coup d'œil et
 * sans ouvrir la modale, la date du jalon (VT planifiée, DP/racco envoyée ou
 * validée, Consuel validé…) et, pour les phases terrain, le technicien attribué.
 * Tout le détail (échéance, pièces, notes) reste dans le pop-up ouvert au clic.
 */
export function SubstepCard({ substep, users, onOpen }: Props) {
  const done = substep.status === 'fait'
  const cancelled = substep.status === 'annule'
  const blocked = substep.status === 'probleme' || cancelled
  const locked = !substep.unlocked && !done && !cancelled
  const stateClass = blocked ? 'is-blocked' : done ? 'is-done' : locked ? 'is-locked' : 'is-active'

  const dateLabel = substep.dateRealisee ? formatDate(substep.dateRealisee) : null
  const tech = substep.responsableId ? users?.find((u) => u.id === substep.responsableId) : undefined

  return (
    <article className={`wf-substep wf-substep-node ${stateClass}`}>
      <button type="button" className="wf-node-btn" onClick={onOpen} disabled={locked}>
        <span className="wf-substep-marker" aria-hidden>
          {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : cancelled ? <span>✕</span> : blocked ? <span>!</span> : <span>{substep.position}</span>}
        </span>
        <span className="wf-node-body">
          <span className="wf-node-title">{substep.label}{substep.optional ? ' (option.)' : ''}</span>
          {(dateLabel || tech) && (
            <span className="wf-node-meta">
              {dateLabel && <span className="wf-node-meta-item"><Icon name="calendar" size={11} /> {dateLabel}</span>}
              {tech && <span className="wf-node-meta-item"><Icon name="users" size={11} /> {tech.name}</span>}
            </span>
          )}
        </span>
      </button>
    </article>
  )
}
