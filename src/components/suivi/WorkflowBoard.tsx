import { SubstepCard } from './SubstepCard'
import { groupSubsteps, SUIVI_SECTIONS } from '../../lib/suivi-board'
import type { SubstepResponse, UpdateSubstepPatch } from '../../lib/types'

type Props = {
  substeps: SubstepResponse[]
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  today: string
  savingId?: string | null
}

export function WorkflowBoard({ substeps, onMutate, today, savingId }: Props) {
  const grouped = groupSubsteps(substeps)

  const renderList = (list: SubstepResponse[]) => (
    <div className="wf-list">
      {list.map((s) => (
        <SubstepCard key={s.id} substep={s} onMutate={onMutate} today={today} saving={savingId === s.id} />
      ))}
    </div>
  )

  return (
    <div className="wf-board">
      {SUIVI_SECTIONS.map((section) => (
        <section key={section.key} className={`wf-section wf-section-${section.key}`}>
          <header className="wf-section-head">
            <span className="wf-section-eyebrow">{section.eyebrow}</span>
            <h3>{section.title}</h3>
          </header>

          {section.layout === 'parallel' && section.columns ? (
            <div className="wf-parallel">
              {section.columns.map((col) => (
                <div key={col.key} className="wf-col">
                  <div className="wf-col-title">{col.title}</div>
                  {renderList(col.key === 'dp' ? grouped.backoffice.dp : grouped.backoffice.racco_consuel)}
                </div>
              ))}
            </div>
          ) : (
            renderList(section.key === 'amont' ? grouped.amont : grouped.aval)
          )}
        </section>
      ))}
    </div>
  )
}
