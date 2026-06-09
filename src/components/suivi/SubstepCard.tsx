import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import type { SubstepResponse, UpdateSubstepPatch } from '../../lib/types'
import { slaGaugeInfo } from '../../lib/suivi-board'

type Props = {
  substep: SubstepResponse
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  today: string
  saving?: boolean
  onDocsChanged?: () => void
  onGoToDocs?: () => void
  readOnly?: boolean
}

export function SubstepCard({ substep, onMutate, today, saving, onGoToDocs, readOnly }: Props) {
  const [date, setDate] = useState(substep.dateRealisee ?? '')
  const [notes, setNotes] = useState(substep.notes ?? '')
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setDate(substep.dateRealisee ?? '')
    setNotes(substep.notes ?? '')
  }, [substep.id, substep.dateRealisee, substep.notes])

  const done = substep.status === 'fait'
  const blocked = substep.status === 'probleme'
  const locked = !substep.unlocked && !done
  const gauge = slaGaugeInfo(substep.deadline, today)

  const debounced = (patch: UpdateSubstepPatch) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => onMutate(substep.id, patch), 500)
  }

  const onAction = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    if (done) onMutate(substep.id, { status: 'a_faire' })
    else onMutate(substep.id, { status: 'fait', dateRealisee: date || today })
  }

  const stateClass = blocked ? 'is-blocked' : done ? 'is-done' : locked ? 'is-locked' : 'is-active'

  return (
    <article className={`wf-substep ${stateClass}`}>
      <div className="wf-substep-marker" aria-hidden>
        {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : blocked ? <span>!</span> : <span>{substep.position}</span>}
      </div>

      <div className="wf-substep-main">
        <header className="wf-substep-head">
          <strong>{substep.label}{substep.optional ? ' (option.)' : ''}</strong>
          <div className="wf-substep-tags">
            {gauge && <span className={`wf-gauge wf-gauge-${gauge.tone}`}><Icon name="clock" size={12} /> {gauge.label}</span>}
            {substep.missingDocument && <span className="wf-badge-missing"><Icon name="tag" size={12} /> pièce manquante</span>}
          </div>
        </header>

        {locked ? (
          <p className="wf-locked-note"><Icon name="shield" size={13} /> En attente d'une étape précédente</p>
        ) : readOnly ? (
          <div className="wf-substep-fields wf-readonly">
            {substep.dateRealisee && <p className="wf-field-ro"><span>Date</span> {substep.dateRealisee}</p>}
            {substep.notes && <p className="wf-field-ro"><span>Notes</span> {substep.notes}</p>}
            <p className="wf-field-ro wf-field-ro-status"><span>Statut</span> {substep.status}</p>
          </div>
        ) : (
          <div className="wf-substep-fields">
            <label className="wf-field">
              <span>Date prévue / réalisation</span>
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); debounced({ dateRealisee: e.target.value || null }) }} />
            </label>
            <label className="wf-field">
              <span>Notes</span>
              <textarea rows={2} value={notes} placeholder="Notes internes, blocages, contact…"
                onChange={(e) => { setNotes(e.target.value); debounced({ notes: e.target.value || null }) }} />
            </label>
          </div>
        )}

        {!locked && substep.expectedDocs.length > 0 && (() => {
          const presentTypes = new Set(substep.documents.map((d) => d.type))
          const present = substep.expectedDocs.filter((t) => presentTypes.has(t)).length
          const total = substep.expectedDocs.length
          return (
            <div className="wf-docs-summary">
              <span className={`wf-docs-count${present < total ? ' is-missing' : ''}`}>
                {present}/{total} pièces{present < total ? ` · ${total - present} manquante${total - present > 1 ? 's' : ''}` : ''}
              </span>
              {onGoToDocs && (
                <button type="button" className="wf-docs-link" onClick={onGoToDocs}>Voir les pièces →</button>
              )}
            </div>
          )
        })()}

        {!readOnly && (
          <footer className="wf-substep-foot">
            <button type="button" className="wf-cta" disabled={locked || saving} onClick={onAction}>
              {done ? 'Rouvrir' : substep.actionLabel}
            </button>
            {saving && <span className="wf-saving">…</span>}
          </footer>
        )}
      </div>
    </article>
  )
}
