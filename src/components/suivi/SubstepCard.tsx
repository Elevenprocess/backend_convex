import { Icon } from '../Icon'
import type { SubstepResponse, UserResponse } from '../../lib/types'
import { slaGaugeInfo } from '../../lib/suivi-board'

type Props = {
  substep: SubstepResponse
  users?: UserResponse[]
  today: string
  onOpen: () => void
}

/**
 * « Nœud » d'un module du workflow façon N8N : cliquable, n'affiche qu'un
 * résumé (statut, échéance, technicien, pièces). Toute la saisie se fait dans
 * le pop-up ouvert au clic (SubstepModal).
 */
export function SubstepCard({ substep, users, today, onOpen }: Props) {
  const done = substep.status === 'fait'
  const blocked = substep.status === 'probleme'
  const locked = !substep.unlocked && !done
  const gauge = slaGaugeInfo(substep.deadline, today)
  const stateClass = blocked ? 'is-blocked' : done ? 'is-done' : locked ? 'is-locked' : 'is-active'

  // Technicien affiché seulement sur les phases terrain (VT / installation / MES).
  // Les phases back-office (DP, racco, consuel) n'ont pas de technicien attribué.
  const isFieldPhase = substep.phase === 'vt' || substep.phase === 'installation' || substep.phase === 'mes'
  const technicien = isFieldPhase ? (users?.find((u) => u.id === substep.responsableId)?.name ?? null) : null
  const expectedTotal = substep.expectedDocs.length
  const presentTypes = new Set(substep.documents.map((d) => d.type))
  const docsPresent = substep.expectedDocs.filter((t) => presentTypes.has(t)).length
  const docsMissing = expectedTotal - docsPresent

  return (
    <article className={`wf-substep wf-substep-node ${stateClass}`}>
      <div className="wf-substep-marker" aria-hidden>
        {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : blocked ? <span>!</span> : <span>{substep.position}</span>}
      </div>

      <button type="button" className="wf-substep-main wf-node-btn" onClick={onOpen} disabled={locked}>
        <header className="wf-substep-head">
          <strong>{substep.label}{substep.optional ? ' (option.)' : ''}</strong>
          <div className="wf-substep-tags">
            {gauge && <span className={`wf-gauge wf-gauge-${gauge.tone}`}><Icon name="clock" size={12} /> {gauge.label}</span>}
            {substep.missingDocument && <span className="wf-badge-missing"><Icon name="tag" size={12} /> pièce manquante</span>}
          </div>
        </header>

        {locked ? (
          <p className="wf-locked-note"><Icon name="shield" size={13} /> En attente d'une étape précédente</p>
        ) : (
          <div className="wf-node-summary">
            {substep.dateRealisee && <span className="wf-node-chip"><Icon name="calendar" size={12} /> {substep.dateRealisee}</span>}
            {technicien && <span className="wf-node-chip"><Icon name="users" size={12} /> {technicien}</span>}
            {expectedTotal > 0 && (
              <span className={`wf-node-chip${docsMissing > 0 ? ' is-missing' : ''}`}>
                <Icon name="tag" size={12} /> {docsPresent}/{expectedTotal} pièces
              </span>
            )}
            <span className="wf-node-open"><Icon name="chevron-right" size={14} /></span>
          </div>
        )}
      </button>
    </article>
  )
}
