import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { FileDropzone } from '../FileDropzone'
import { MassDepositAssigner } from './MassDepositAssigner'
import { DocumentPreviewModal, type DocPreview } from './DocumentPreviewModal'
import type { SubstepResponse } from '../../lib/types'
import { groupSubsteps, SUIVI_SECTIONS, fileKind, substepDocStatus } from '../../lib/suivi-board'
import { deleteSubstepDocument, substepDocumentRawUrl } from '../../lib/api'
import { displayFilename } from '../../lib/filename'

type Props = {
  substeps: SubstepResponse[]
  today: string
  onDocsChanged?: () => void
}

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', image: 'IMG', doc: 'DOC' }

export function DocumentsHub({ substeps, onDocsChanged }: Props) {
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [pending, setPending] = useState<File[] | null>(null)
  const [preview, setPreview] = useState<DocPreview | null>(null)

  const grouped = useMemo(() => groupSubsteps(substeps), [substeps])

  const totals = useMemo(() => {
    let present = 0
    let expected = 0
    for (const s of substeps) {
      const st = substepDocStatus(s)
      expected += s.expectedDocs.length
      present += s.expectedDocs.length - st.missingTypes.length
    }
    return { present, expected }
  }, [substeps])

  const onDelete = async (docId: string) => {
    await deleteSubstepDocument(docId)
    onDocsChanged?.()
  }

  const targetable = substeps.filter((s) => s.unlocked && s.expectedDocs.length > 0)

  const sectionFor = (key: 'amont' | 'backoffice' | 'aval'): SubstepResponse[] =>
    key === 'amont' ? grouped.amont
      : key === 'aval' ? grouped.aval
        : [...grouped.backoffice.dp, ...grouped.backoffice.racco]

  return (
    <div className="dochub">
      <header className="dochub-head">
        <div className="dochub-count">
          <strong>{totals.present}/{totals.expected}</strong>
          <span>pièces du dossier</span>
        </div>
        <button type="button" className={`dochub-filter${onlyMissing ? ' is-on' : ''}`} onClick={() => setOnlyMissing((v) => !v)}>
          <Icon name="tag" size={13} /> Manquantes uniquement
        </button>
      </header>

      <FileDropzone
        id="dochub-mass"
        multiple
        title="Déposer un ou plusieurs fichiers"
        subtitle="Ils seront rangés par étape · 25 Mo / fichier"
        onFiles={(files) => setPending(files)}
      />

      {pending && (
        <MassDepositAssigner
          files={pending}
          targets={targetable}
          onCancel={() => setPending(null)}
          onDone={() => { setPending(null); onDocsChanged?.() }}
        />
      )}

      {SUIVI_SECTIONS.map((section) => {
        const list = sectionFor(section.key)
        const rows = list.filter((s) => s.expectedDocs.length > 0)
        if (rows.length === 0) return null
        return (
          <section key={section.key} className="dochub-section">
            <h4>{section.title}</h4>
            <ul className="dochub-list">
              {rows.flatMap((s) => {
                const st = substepDocStatus(s)
                const items: ReactNode[] = []
                if (!onlyMissing) {
                  for (const d of st.present) {
                    items.push(
                      <li key={d.id} className="dochub-doc">
                        <span className={`dochub-thumb kind-${fileKind(d.mimeType)}`}>{KIND_LABEL[fileKind(d.mimeType)]}</span>
                        <button type="button" className="dochub-doc-name" onClick={() => setPreview({ url: substepDocumentRawUrl(d.id), filename: displayFilename(d.filename), mimeType: d.mimeType })} title={displayFilename(d.filename)}>
                          <span>{displayFilename(d.filename)}</span>
                        </button>
                        <span className="dochub-doc-meta">{s.label} · {Math.max(1, Math.round(d.sizeBytes / 1024))} Ko</span>
                        <button type="button" className="dochub-doc-del" aria-label="Supprimer" onClick={() => void onDelete(d.id)}>
                          <Icon name="x" size={13} />
                        </button>
                      </li>,
                    )
                  }
                }
                for (const t of st.missingTypes) {
                  items.push(
                    <li key={`${s.id}-${t}`} className="dochub-doc is-missing">
                      <span className="dochub-thumb kind-missing">—</span>
                      <span className="dochub-doc-name">{s.label}</span>
                      <span className="dochub-doc-meta">type « {t} »</span>
                      <span className="dochub-missing-pill">manquante</span>
                    </li>,
                  )
                }
                return items
              })}
            </ul>
          </section>
        )
      })}

      {preview && <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
