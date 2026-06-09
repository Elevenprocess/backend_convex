import { type ReactNode } from 'react'
import { SubstepCard } from './SubstepCard'
import { groupSubsteps, SUIVI_SECTIONS } from '../../lib/suivi-board'
import { useCollapsibleState } from '../../lib/useCollapsibleState'
import { Icon } from '../Icon'
import type { SubstepResponse, UpdateSubstepPatch, WorkflowPhase } from '../../lib/types'

type Props = {
  substeps: SubstepResponse[]
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  today: string
  savingId?: string | null
  onDocsChanged?: () => void
  onGoToDocs?: () => void
  canEditPhase?: (phase: WorkflowPhase) => boolean
}

function countDone(list: SubstepResponse[]) {
  return list.reduce((n, s) => (s.status === 'fait' ? n + 1 : n), 0)
}

function Progress({ list }: { list: SubstepResponse[] }) {
  const total = list.length
  const done = countDone(list)
  const pct = total ? Math.round((done / total) * 100) : 0
  const complete = total > 0 && done === total
  return (
    <span className={`wf-progress${complete ? ' is-complete' : ''}`}>
      <span className="wf-progress-bar" aria-hidden>
        <span className="wf-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="wf-progress-count">{done}/{total}</span>
    </span>
  )
}

function allDone(list: SubstepResponse[]): boolean {
  return list.length > 0 && list.every((s) => s.status === 'fait')
}

function CollapsibleWfSection({
  section, sectionList, children,
}: { section: typeof SUIVI_SECTIONS[number]; sectionList: SubstepResponse[]; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsibleState(`wf.section.${section.key}`, allDone(sectionList))
  return (
    <section className={`wf-section wf-section-${section.key}`}>
      <header className="wf-section-head">
        <button type="button" className="wf-section-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} className="text-faint" />
          <span className="wf-section-titles">
            <span className="wf-section-eyebrow">{section.eyebrow}</span>
            <span className="wf-section-title-text">{section.title}</span>
          </span>
        </button>
        <Progress list={sectionList} />
      </header>
      {!collapsed && children}
    </section>
  )
}

export function WorkflowBoard({ substeps, onMutate, today, savingId, onDocsChanged, onGoToDocs, canEditPhase }: Props) {
  const grouped = groupSubsteps(substeps)
  const overallDone = countDone(substeps)
  const overallTotal = substeps.length
  const overallPct = overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0

  const renderList = (list: SubstepResponse[]) => (
    <div className="wf-list">
      {list.map((s) => (
        <SubstepCard key={s.id} substep={s} onMutate={onMutate} today={today} saving={savingId === s.id} onDocsChanged={onDocsChanged} onGoToDocs={onGoToDocs} readOnly={canEditPhase ? !canEditPhase(s.phase) : false} />
      ))}
    </div>
  )

  return (
    <div className="wf-board">
      {overallTotal > 0 && (
        <div className="wf-overall">
          <div className="wf-overall-text">
            <span className="wf-overall-pct">{overallPct}%</span>
            <span className="wf-overall-label">{overallDone} / {overallTotal} étapes terminées</span>
          </div>
          <div className="wf-overall-track" aria-hidden>
            <div className="wf-overall-fill" style={{ width: `${overallPct}%` }} />
          </div>
        </div>
      )}

      {SUIVI_SECTIONS.map((section) => {
        const sectionList =
          section.key === 'amont'
            ? grouped.amont
            : section.key === 'aval'
              ? grouped.aval
              : [...grouped.backoffice.dp, ...grouped.backoffice.racco_consuel]
        return (
          <CollapsibleWfSection key={section.key} section={section} sectionList={sectionList}>
            {section.layout === 'parallel' && section.columns ? (
              <div className="wf-parallel">
                {section.columns.map((col) => {
                  const colList = col.key === 'dp' ? grouped.backoffice.dp : grouped.backoffice.racco_consuel
                  return (
                    <div key={col.key} className="wf-col">
                      <div className="wf-col-head">
                        <span className="wf-col-title">{col.title}</span>
                        <Progress list={colList} />
                      </div>
                      {renderList(colList)}
                    </div>
                  )
                })}
              </div>
            ) : (
              renderList(section.key === 'amont' ? grouped.amont : grouped.aval)
            )}
          </CollapsibleWfSection>
        )
      })}
    </div>
  )
}
