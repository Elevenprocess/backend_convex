import { useState } from 'react'
import { Icon } from '../../Icon'
import { FileDropzone } from '../../FileDropzone'
import { DocumentPreviewModal, type DocPreview } from '../../suivi/DocumentPreviewModal'
import {
  ApiError,
  attachmentRawUrl,
  deleteProjectAttachment,
  uploadProjectAttachment,
} from '../../../lib/api'
import type {
  ProjectAttachmentKind,
  ProjectAttachmentResponse,
  ProjectResponse,
} from '../../../lib/types'

type Props = {
  project: ProjectResponse
  attachments: ProjectAttachmentResponse[]
  onChanged: () => void
}

export function ProjectDocumentsTab({ project, attachments, onChanged }: Props) {
  const docs = attachments.filter((a) => a.kind === 'document' || a.kind === 'autre')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState<DocPreview | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const kind: ProjectAttachmentKind = file.type === 'application/pdf'
        || file.type === 'application/msword'
        || file.type.includes('officedocument')
        ? 'document'
        : 'autre'
      await uploadProjectAttachment(project.id, file, { kind, label: label.trim() || null })
      setLabel('')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Upload échoué.')
    } finally {
      setUploading(false)
    }
  }

  function openDoc(d: ProjectAttachmentResponse) {
    setPreview({ url: attachmentRawUrl(d.id), filename: d.filename, mimeType: d.contentType, label: d.label })
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer ce document ?')) return
    try {
      await deleteProjectAttachment(id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression échouée.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Étiquette (optionnel)</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ex. Mandat SEPA, Attestation TVA…"
          className="w-full bg-white border border-line rounded-[12px] px-3 py-2 text-sm focus:outline-none focus:border-or"
        />
      </div>

      <FileDropzone
        id={`docs-upload-${project.id}`}
        uploading={uploading}
        title="Déposer un document"
        subtitle="PDF, Word, Excel, etc. — 25 Mo max."
        onFiles={(files) => {
          const f = files[0]
          if (f) void handleFile(f)
        }}
      />

      {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs text-rouille">{error}</div>}

      {docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/40 px-4 py-4 text-xs text-muted">
          Aucun document. Ajoute les pièces administratives, attestations, etc.
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-3 py-2.5">
              <button
                type="button"
                onClick={() => openDoc(d)}
                className="w-9 h-9 rounded-lg bg-cream flex items-center justify-center shrink-0 hover:bg-cream-darker"
                title="Ouvrir"
              >
                <Icon name="grid" size={14} className="text-muted" />
              </button>
              <button
                type="button"
                onClick={() => openDoc(d)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="font-bold text-sm truncate">{d.label || d.filename}</div>
                <div className="text-[10px] text-muted">
                  {(d.sizeBytes / 1024).toFixed(0)} Ko · {new Date(d.createdAt).toLocaleDateString('fr-FR')}
                </div>
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(d.id)}
                className="text-faint hover:text-rouille"
                title="Supprimer"
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
