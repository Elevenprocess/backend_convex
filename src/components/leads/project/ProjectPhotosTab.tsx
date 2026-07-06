import { useState } from 'react'
import { Icon } from '../../Icon'
import { FileDropzone } from '../../FileDropzone'
import {
  ApiError,
  attachmentDisplayUrl,
  deleteProjectAttachment,
  uploadProjectAttachment,
} from '../../../lib/api'
import type { ProjectAttachmentResponse, ProjectResponse } from '../../../lib/types'

type Props = {
  project: ProjectResponse
  attachments: ProjectAttachmentResponse[]
  onChanged: () => void
}

export function ProjectPhotosTab({ project, attachments, onChanged }: Props) {
  const photos = attachments.filter((a) => a.kind === 'photo')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setError(`"${file.name}" n'est pas une image — ignoré.`)
          continue
        }
        await uploadProjectAttachment(project.id, file, { kind: 'photo' })
      }
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Upload échoué.')
    } finally {
      setUploading(false)
    }
  }

  function openPhoto(photo: ProjectAttachmentResponse) {
    window.open(attachmentDisplayUrl(photo), '_blank', 'noopener')
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer cette photo ?')) return
    try {
      await deleteProjectAttachment(id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression échouée.')
    }
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        id={`photos-upload-${project.id}`}
        accept="image/*"
        multiple
        uploading={uploading}
        title="Déposer des photos"
        subtitle="Multi-fichiers, jusqu'à 25 Mo chacune."
        onFiles={(files) => void handleFiles(files)}
      />

      {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs text-rouille">{error}</div>}

      {photos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/40 px-4 py-4 text-xs text-muted">
          Aucune photo. Ajoute les visuels du toit, des panneaux, etc.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {photos.map((p) => (
            <li key={p.id} className="relative rounded-xl overflow-hidden border border-line bg-white">
              <button
                type="button"
                onClick={() => openPhoto(p)}
                className="group relative block w-full aspect-square bg-cream overflow-hidden"
                title="Ouvrir en grand"
              >
                <img
                  src={attachmentDisplayUrl(p)}
                  alt={p.label || p.filename}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  onError={(e) => {
                    const img = e.currentTarget
                    img.style.display = 'none'
                    img.parentElement?.classList.add('photo-missing')
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 group-[.photo-missing]:bg-cream-darker transition-colors">
                  <Icon
                    name="eye"
                    size={20}
                    className="text-white opacity-0 group-hover:opacity-100 group-[.photo-missing]:text-muted group-[.photo-missing]:opacity-60"
                  />
                </span>
              </button>
              <div className="px-2 py-1.5 text-[10px] text-muted">
                <div className="truncate font-bold text-text">{p.label || p.filename}</div>
                <div>{new Date(p.createdAt).toLocaleDateString('fr-FR')}</div>
              </div>
              <button
                type="button"
                onClick={() => void handleDelete(p.id)}
                className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-rouille hover:bg-white"
                title="Supprimer"
              >
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
