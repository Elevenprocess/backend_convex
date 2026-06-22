import { Icon } from '../Icon'
import type { SubstepResponse, UserResponse } from '../../lib/types'

type Props = {
  substep: SubstepResponse
  users?: UserResponse[]
  today: string
  onOpen: () => void
}

/**
 * « Nœud » d'un module du workflow façon N8N : juste un rond + un titre,
 * cliquable. Tout le détail (échéance, technicien, pièces) se consulte et se
 * saisit dans le pop-up ouvert au clic (SubstepModal).
 */
export function SubstepCard({ substep, onOpen }: Props) {
  const done = substep.status === 'fait'
  const blocked = substep.status === 'probleme'
  const locked = !substep.unlocked && !done
  const stateClass = blocked ? 'is-blocked' : done ? 'is-done' : locked ? 'is-locked' : 'is-active'

  return (
    <article className={`wf-substep wf-substep-node ${stateClass}`}>
      <button type="button" className="wf-node-btn" onClick={onOpen} disabled={locked}>
        <span className="wf-substep-marker" aria-hidden>
          {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : blocked ? <span>!</span> : <span>{substep.position}</span>}
        </span>
        <span className="wf-node-title">{substep.label}{substep.optional ? ' (option.)' : ''}</span>
      </button>
    </article>
  )
}
