import { useState } from 'react'
import { Icon } from '../Icon'
import { formatDate } from '../../lib/suivi'
import { slaGaugeInfo, fileKind } from '../../lib/suivi-board'
import { SubstepDocPreviewModal } from './SubstepDocPreviewModal'
import type { SubstepDocument, SubstepResponse, UserResponse } from '../../lib/types'

type Props = {
  substep: SubstepResponse
  users?: UserResponse[]
  today: string
  onOpen: () => void
}

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', image: 'IMG', doc: 'DOC' }

/**
 * « Nœud » d'un module du workflow façon N8N : un rond + un titre, cliquable.
 * Sous le titre, une caption très discrète rappelle, d'un seul coup d'œil et
 * sans ouvrir la modale, la date du jalon (VT planifiée, DP/racco envoyée ou
 * validée, Consuel validé…) et, pour les phases terrain, le technicien attribué.
 * Tout le détail (échéance, pièces, notes) reste dans le pop-up ouvert au clic.
 */
export function SubstepCard({ substep, users, today, onOpen }: Props) {
  const [docPreview, setDocPreview] = useState<SubstepDocument | null>(null)

  const done = substep.status === 'fait'
  const cancelled = substep.status === 'annule'
  const blocked = substep.status === 'probleme' || cancelled
  const locked = !substep.unlocked && !done && !cancelled
  const stateClass = blocked ? 'is-blocked' : done ? 'is-done' : locked ? 'is-locked' : 'is-active'

  const dateLabel = substep.dateRealisee ? formatDate(substep.dateRealisee) : null
  const tech = substep.responsableId ? users?.find((u) => u.id === substep.responsableId) : undefined
  const gauge = slaGaugeInfo(substep.deadline, today)

  const totalDocs = substep.documents.length + substep.expectedDocs.filter(
    (t) => !substep.documents.find((d) => d.type === t),
  ).length
  const docSummary = totalDocs > 0 ? `${substep.documents.length}/${totalDocs} pièces` : null

  return (
    <article className={`wf-substep wf-substep-node ${stateClass}`}>
      <button type="button" className="wf-node-btn" onClick={onOpen} disabled={locked} aria-label={substep.label}>
        <span className="wf-substep-marker" aria-hidden>
          {done ? <Icon name="check" size={15} strokeWidth={2.6} /> : cancelled ? <span>✕</span> : blocked ? <span>!</span> : <span>{substep.position}</span>}
        </span>
        <span className="wf-node-body">
          <span className="wf-node-title">{substep.label}{substep.optional ? ' (option.)' : ''}</span>
          {(dateLabel || tech || gauge || docSummary || substep.missingDocument || locked) && (
            <span className="wf-node-meta">
              {dateLabel && <span className="wf-node-meta-item"><Icon name="calendar" size={11} /> {dateLabel}</span>}
              {tech && <span className="wf-node-meta-item"><Icon name="users" size={11} /> {tech.name}</span>}
              {gauge && <span className={`wf-node-meta-item wf-gauge-inline wf-gauge-${gauge.tone}`}><Icon name="clock" size={11} /> {gauge.label}</span>}
              {docSummary && <span className="wf-node-meta-item"><Icon name="tag" size={11} /> {docSummary}</span>}
              {substep.missingDocument && <span className="wf-node-meta-item wf-node-missing">pièce manquante</span>}
              {locked && <span className="wf-node-meta-item">en attente</span>}
            </span>
          )}
        </span>
      </button>

      {substep.documents.length > 0 && (
        <div className="wf-node-docs">
          {substep.documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={`wf-node-doc-chip kind-${fileKind(doc.mimeType)}`}
              title={doc.filename}
              onClick={(e) => { e.stopPropagation(); setDocPreview(doc) }}
            >
              <span className="wf-node-doc-chip-kind" aria-hidden>{KIND_LABEL[fileKind(doc.mimeType)]}</span>
              <span className="wf-node-doc-chip-name">{doc.filename}</span>
            </button>
          ))}
        </div>
      )}

      {docPreview && <SubstepDocPreviewModal doc={docPreview} onClose={() => setDocPreview(null)} />}
    </article>
  )
}
