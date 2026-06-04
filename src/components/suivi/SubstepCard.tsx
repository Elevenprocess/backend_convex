import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { FileDropzone } from '../FileDropzone'
import type { SubstepResponse, UpdateSubstepPatch } from '../../lib/types'
import { slaGaugeInfo } from '../../lib/suivi-board'
import { deleteSubstepDocument, substepDocumentRawUrl, uploadSubstepDocuments } from '../../lib/api'

type Props = {
  substep: SubstepResponse
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  today: string
  saving?: boolean
  onDocsChanged?: () => void
  readOnly?: boolean
}

export function SubstepCard({ substep, onMutate, today, saving, onDocsChanged, readOnly }: Props) {
  const [date, setDate] = useState(substep.dateRealisee ?? '')
  const [notes, setNotes] = useState(substep.notes ?? '')
  const [uploading, setUploading] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  const onUploadFiles = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    setDocError(null)
    try {
      await uploadSubstepDocuments(substep.id, files)
      onDocsChanged?.()
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Échec de l’upload')
    } finally {
      setUploading(false)
    }
  }

  const onDeleteDoc = async (docId: string) => {
    setDocError(null)
    try {
      await deleteSubstepDocument(docId)
      onDocsChanged?.()
    } catch (e) {
      setDocError(e instanceof Error ? e.message : 'Suppression échouée')
    }
  }

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

        {!locked && substep.expectedDocs.length > 0 && (
          <div className="wf-docs">
            <div className="wf-docs-head">
              <span>Documents</span>
              {substep.missingDocument && <span className="wf-docs-missing"><Icon name="tag" size={11} /> pièce manquante</span>}
            </div>
            {substep.documents.length > 0 && (
              <ul className="wf-docs-list">
                {substep.documents.map((d) => (
                  <li key={d.id} className="wf-doc">
                    <a className="wf-doc-name" href={substepDocumentRawUrl(d.id)} target="_blank" rel="noreferrer" title={d.filename}>
                      <Icon name="check" size={12} /> <span>{d.filename}</span>
                    </a>
                    <span className="wf-doc-size">{Math.max(1, Math.round(d.sizeBytes / 1024))} Ko</span>
                    {!readOnly && (
                      <button type="button" className="wf-doc-del" onClick={() => void onDeleteDoc(d.id)} aria-label="Supprimer le document">
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && (
              <FileDropzone
                id={`docs-${substep.id}`}
                multiple
                uploading={uploading}
                title="Déposer un ou plusieurs fichiers"
                subtitle="Tout type · 25 Mo / fichier"
                onFiles={(files) => void onUploadFiles(files)}
              />
            )}
            {docError && <p className="wf-docs-error">{docError}</p>}
          </div>
        )}

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
