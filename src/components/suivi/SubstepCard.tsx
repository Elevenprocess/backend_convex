import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import type { SubstepResponse, UserResponse } from '../../lib/types'
import { slaGaugeInfo } from '../../lib/suivi-board'

type Props = {
  substep: SubstepResponse
  users?: UserResponse[]
  today: string
  onOpen: () => void
}

type TipPos = { left: number; top: number; placement: 'below' | 'above' }

/**
 * « Nœud » d'un module du workflow façon N8N : juste un rond + un titre. Le
 * détail (échéance, technicien, pièces) n'apparaît qu'au survol dans une
 * info-bulle rendue en portail (position fixe → jamais rognée par le scroll du
 * drawer). Le clic ouvre le pop-up (SubstepModal) via onOpen.
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

  const btnRef = useRef<HTMLButtonElement>(null)
  const [tip, setTip] = useState<TipPos | null>(null)

  const showTip = () => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Bascule au-dessus si le nœud est dans le tiers bas de l'écran.
    const below = r.bottom < window.innerHeight * 0.62
    setTip({
      left: r.left,
      top: below ? r.bottom + 6 : r.top - 6,
      placement: below ? 'below' : 'above',
    })
  }
  const hideTip = () => setTip(null)

  return (
    <article className={`wf-substep wf-substep-node ${stateClass}`}>
      <button
        ref={btnRef}
        type="button"
        className="wf-node-btn"
        onClick={onOpen}
        disabled={locked}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
      >
        <span className="wf-substep-marker" aria-hidden>
          {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : blocked ? <span>!</span> : <span>{substep.position}</span>}
        </span>
        <span className="wf-node-title">{substep.label}{substep.optional ? ' (option.)' : ''}</span>
      </button>

      {tip && createPortal(
        <div
          className={`wf-node-tip wf-node-tip-${tip.placement}`}
          role="tooltip"
          style={{ left: tip.left, top: tip.top }}
        >
          <span className="wf-node-tip-title">{substep.label}{substep.optional ? ' (option.)' : ''}</span>
          {locked ? (
            <span className="wf-locked-note"><Icon name="shield" size={13} /> En attente d'une étape précédente</span>
          ) : (
            <div className="wf-node-summary">
              {gauge && <span className={`wf-gauge wf-gauge-${gauge.tone}`}><Icon name="clock" size={12} /> {gauge.label}</span>}
              {substep.missingDocument && <span className="wf-badge-missing"><Icon name="tag" size={12} /> pièce manquante</span>}
              {substep.dateRealisee && <span className="wf-node-chip"><Icon name="calendar" size={12} /> {substep.dateRealisee}</span>}
              {technicien && <span className="wf-node-chip"><Icon name="users" size={12} /> {technicien}</span>}
              {expectedTotal > 0 && (
                <span className={`wf-node-chip${docsMissing > 0 ? ' is-missing' : ''}`}>
                  <Icon name="tag" size={12} /> {docsPresent}/{expectedTotal} pièces
                </span>
              )}
              <span className="wf-node-tip-cta"><Icon name="chevron-right" size={13} /> Cliquer pour ouvrir</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </article>
  )
}
