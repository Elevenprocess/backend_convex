import { useState, type ReactNode } from 'react'
import { SubstepCard } from './SubstepCard'
import { SubstepModal } from './SubstepModal'
import { groupSubsteps, SUIVI_SECTIONS } from '../../lib/suivi-board'
import { useCollapsibleState } from '../../lib/useCollapsibleState'
import { Icon, type IconName } from '../Icon'
import type { SubstepResponse, UpdateSubstepPatch, UserResponse, WorkflowPhase } from '../../lib/types'

// Pastille-icône en tête de chaque section, pour ancrer visuellement les 3 temps
// du dossier (préparation terrain → démarches admin → installation).
const SECTION_ICON: Record<typeof SUIVI_SECTIONS[number]['key'], IconName> = {
  amont: 'home',
  backoffice: 'mail',
  aval: 'settings',
}

type Props = {
  substeps: SubstepResponse[]
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  today: string
  users?: UserResponse[]
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
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} className="wf-section-chev" />
          <span className="wf-section-badge" aria-hidden><Icon name={SECTION_ICON[section.key]} size={15} /></span>
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

export function WorkflowBoard({ substeps, onMutate, today, users, savingId, onDocsChanged, canEditPhase }: Props) {
  const grouped = groupSubsteps(substeps)
  const cancelled = substeps.some((s) => s.status === 'annule')
  const overallDone = countDone(substeps)
  const overallTotal = substeps.length
  const overallPct = overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0
  const [openId, setOpenId] = useState<string | null>(null)
  const openSubstep = openId ? substeps.find((s) => s.id === openId) ?? null : null

  const renderList = (list: SubstepResponse[]) => (
    <div className="wf-list">
      {list.map((s) => (
        <SubstepCard key={s.id} substep={s} users={users} today={today} onOpen={() => setOpenId(s.id)} />
      ))}
    </div>
  )

  return (
    <div className={`wf-board${cancelled ? ' wf-board-cancelled' : ''}`}>
      {cancelled && (
        <div className="wf-cancel-banner" role="alert">
          <Icon name="x" size={16} strokeWidth={2.6} />
          <span><strong>Vente annulée</strong> — VT non validée. Dossier bloqué, finances à zéro (rien à encaisser).</span>
        </div>
      )}
      {overallTotal > 0 && (
        <div className={`wf-overall${overallPct === 100 ? ' is-complete' : ''}`}>
          <div
            className="wf-overall-ring"
            style={{ background: `conic-gradient(var(--color-or) ${overallPct * 3.6}deg, var(--color-line) 0)` }}
            aria-hidden
          >
            <span className="wf-overall-ring-num">{overallPct}<i>%</i></span>
          </div>
          <div className="wf-overall-text">
            <span className="wf-overall-label">Avancement du dossier</span>
            <span className="wf-overall-sub">{overallDone} / {overallTotal} étapes terminées</span>
            <div className="wf-overall-track" aria-hidden>
              <div className="wf-overall-fill" style={{ width: `${overallPct}%` }} />
            </div>
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

      {openSubstep && (
        <SubstepModal
          substep={openSubstep}
          users={users ?? []}
          today={today}
          saving={savingId === openSubstep.id}
          readOnly={canEditPhase ? !canEditPhase(openSubstep.phase) : false}
          onMutate={onMutate}
          onDocsChanged={onDocsChanged}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
