import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { PHASE_GUIDE } from '../../lib/phase-guide'
import { PHASE_LABEL } from '../../lib/suivi-board'
import type { WorkflowPhase } from '../../lib/types'

/**
 * Icône « ? » + popover expliquant une phase du workflow délivrabilité
 * (objectif, documents attendus, condition de clôture, phase suivante).
 * Utilisée sur le tunnel de l'Overview délivrabilité et les sections du
 * WorkflowBoard — pour qu'un nouveau n'ait jamais à demander « c'est quoi RACCO ? ».
 */
export function PhaseHelp({ phase }: { phase: WorkflowPhase }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const guide = PHASE_GUIDE[phase]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <span className="phase-help" ref={ref}>
      <button
        type="button"
        aria-label={`Aide — ${PHASE_LABEL[phase]}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        <Icon name="help" size={13} />
      </button>
      {open && (
        <div className="phase-help-pop" role="dialog" aria-label={PHASE_LABEL[phase]}>
          <strong>{PHASE_LABEL[phase]}</strong>
          <p>{guide.objectif}</p>
          {guide.docs.length > 0 && <p><b>Documents :</b> {guide.docs.join(', ')}</p>}
          <p><b>Se clôture quand :</b> {guide.cloture}</p>
          {guide.suivante && <p><b>Phase suivante :</b> {PHASE_LABEL[guide.suivante]}</p>}
        </div>
      )}
    </span>
  )
}
