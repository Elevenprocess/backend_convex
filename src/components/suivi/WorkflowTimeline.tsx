import { useEffect, useState } from 'react'
import { WorkflowStep } from './WorkflowStep'
import {
  readWorkflowState,
  statusForId,
  WORKFLOW,
  writeWorkflowState,
  type StepId,
  type SuiviState,
} from '../../lib/suivi'

type Props = {
  dossierId: string
  initialState: SuiviState
  activeStep: StepId
  onStateChange?: (state: SuiviState) => void
}

export function WorkflowTimeline({ dossierId, initialState, activeStep, onStateChange }: Props) {
  const [state, setState] = useState<SuiviState>(initialState)
  const [expandedStep, setExpandedStep] = useState<StepId | null>(activeStep)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setState(readWorkflowState(dossierId))
    setExpandedStep(activeStep)
  }, [dossierId, activeStep])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const persist = (next: SuiviState) => {
    setState(next)
    writeWorkflowState(dossierId, next)
    setSavedAt(Date.now())
    onStateChange?.(next)
  }

  const handleToggle = (id: StepId) => {
    setExpandedStep((current) => (current === id ? null : id))
  }

  const savedAgo = savedAt ? Math.max(0, Math.floor((now - savedAt) / 1000)) : null

  return (
    <ol className="suivi-v2-timeline">
      {WORKFLOW.map((step, idx) => {
        const status = state.statuses[step.id] ?? statusForId(activeStep, step.id)
        const expanded = expandedStep === step.id
        return (
          <WorkflowStep
            key={step.id}
            step={step}
            status={status}
            state={state}
            expanded={expanded}
            isLast={idx === WORKFLOW.length - 1}
            onToggle={() => handleToggle(step.id)}
            onChange={persist}
            onCommit={() => setSavedAt(Date.now())}
            savedAgo={expanded ? savedAgo : null}
          />
        )
      })}
    </ol>
  )
}
