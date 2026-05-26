import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import type { NodeStatus, SuiviState, WorkflowStep as WorkflowStepDef } from '../../lib/suivi'
import { nodeDetail, stepIndex } from '../../lib/suivi'

type Props = {
  step: WorkflowStepDef
  status: NodeStatus
  state: SuiviState
  expanded: boolean
  isLast: boolean
  onToggle: () => void
  onChange: (next: SuiviState) => void
  onCommit: () => void
  savedAgo: number | null
}

export function WorkflowStep({ step, status, state, expanded, isLast, onToggle, onChange, onCommit, savedAgo }: Props) {
  const [localNotes, setLocalNotes] = useState(state.notes[step.id] ?? '')
  const [localDate, setLocalDate] = useState(state.dates[step.id] ?? '')
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocalNotes(state.notes[step.id] ?? '')
    setLocalDate(state.dates[step.id] ?? '')
  }, [step.id, state.notes, state.dates])

  const persistDebounced = (updater: (s: SuiviState) => SuiviState) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      onChange(updater(state))
    }, 500)
  }

  const handleNotes = (value: string) => {
    setLocalNotes(value)
    persistDebounced((s) => ({ ...s, notes: { ...s.notes, [step.id]: value } }))
  }

  const handleDate = (value: string) => {
    setLocalDate(value)
    persistDebounced((s) => ({ ...s, dates: { ...s.dates, [step.id]: value } }))
  }

  const toggleDone = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    const nextStatus: NodeStatus = status === 'done' ? 'active' : 'done'
    onChange({ ...state, statuses: { ...state.statuses, [step.id]: nextStatus } })
    onCommit()
  }

  return (
    <li className={`suivi-step suivi-step-${status} ${expanded ? 'is-expanded' : ''} ${isLast ? 'is-last' : ''}`}>
      <button
        type="button"
        className="suivi-step-circle"
        aria-expanded={expanded}
        aria-controls={`suivi-step-${step.id}`}
        onClick={onToggle}
      >
        {status === 'done' ? <Icon name="check" size={18} strokeWidth={2.4} />
          : status === 'blocked' || status === 'lost' ? <span aria-hidden>!</span>
          : <span aria-hidden>{stepIndex(step.id) + 1}</span>}
      </button>

      <div className="suivi-step-body" id={`suivi-step-${step.id}`}>
        <button type="button" className="suivi-step-head" onClick={onToggle}>
          <div>
            <strong>{step.label}</strong>
            <span>{step.short} · {step.owner}</span>
          </div>
          {/* chevron-up not in icon set — rotate chevron-down 180° when expanded */}
          <span style={{ display: 'inline-flex', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <Icon name="chevron-down" size={16} strokeWidth={2} />
          </span>
        </button>

        {expanded && (
          <div className="suivi-step-panel">
            <p className="suivi-step-detail">{nodeDetail(step, state)}</p>

            <div className="suivi-step-fields">
              <label>
                <span>Date prévue / réalisation</span>
                <input type="date" value={localDate} onChange={(e) => handleDate(e.target.value)} />
              </label>
              <label>
                <span>Notes</span>
                <textarea
                  value={localNotes}
                  onChange={(e) => handleNotes(e.target.value)}
                  rows={3}
                  placeholder="Notes internes, blocages, contact…"
                />
              </label>
            </div>

            <footer className="suivi-step-foot">
              <button type="button" className="suivi-step-cta" onClick={toggleDone}>
                {status === 'done' ? 'Réouvrir' : 'Marquer terminé'}
              </button>
              {savedAgo !== null && <span className="suivi-step-saved">Enregistré il y a {savedAgo}s ✓</span>}
            </footer>
          </div>
        )}
      </div>
    </li>
  )
}
