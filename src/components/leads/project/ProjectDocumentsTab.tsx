import { useState } from 'react'
import { Icon } from '../../Icon'
import { Spinner } from '../../Spinner'
import {
  ApiError,
  deleteProjectAttachment,
  getAttachmentSignedUrl,
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

  async function openDoc(id: string) {
    try {
      const { url } = await getAttachmentSignedUrl(id)
      window.open(url, '_blank', 'noopener')
    } catch {
      /* ignore */
    }
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

      <label
        htmlFor={`docs-upload-${project.id}`}
        className={`block rounded-2xl border-2 border-dashed px-6 py-5 text-center cursor-pointer transition-colors ${
          uploading ? 'border-or bg-or/10' : 'border-line bg-white/40 hover:bg-white/70'
        }`}
      >
        <input
          id={`docs-upload-${project.id}`}
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
        {uploading ? (
          <div className="inline-flex items-center gap-2 text-or-dark text-sm font-bold">
            <Spinner size={14} /> Upload en cours…
          </div>
        ) : (
          <div>
            <div className="font-bold text-sm">Déposer un document</div>
            <div className="text-xs text-muted mt-0.5">PDF, Word, Excel, etc. — 25 Mo max.</div>
          </div>
        )}
      </label>

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
                onClick={() => void openDoc(d.id)}
                className="w-9 h-9 rounded-lg bg-cream flex items-center justify-center shrink-0 hover:bg-cream-darker"
                title="Ouvrir"
              >
                <Icon name="grid" size={14} className="text-muted" />
              </button>
              <button
                type="button"
                onClick={() => void openDoc(d.id)}
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
    </div>
  )
}
