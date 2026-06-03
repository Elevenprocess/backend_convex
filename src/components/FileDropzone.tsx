import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Spinner } from './Spinner'

type FileDropzoneProps = {
  id: string
  title: string
  subtitle: string
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  uploading?: boolean
}

/**
 * Zone d'upload réutilisable : clic (label + input caché) OU glisser-déposer.
 * Ne fait aucun appel réseau — délègue les fichiers via onFiles. Style « air »,
 * tokens or/line, sans dégradé.
 */
export function FileDropzone({
  id,
  title,
  subtitle,
  onFiles,
  accept,
  multiple = false,
  uploading = false,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  // Compteur anti-clignotement : les dragenter/leave des enfants ne doivent pas
  // réinitialiser l'état de survol.
  const dragDepth = useRef(0)

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault() // obligatoire pour autoriser le drop
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragging(false)
    }
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (uploading) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  return (
    <label
      htmlFor={id}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`block rounded-2xl border-2 border-dashed px-6 py-5 text-center cursor-pointer transition-colors ${
        isDragging
          ? 'border-or bg-or-tint'
          : uploading
            ? 'border-or bg-or/10'
            : 'border-line bg-white/40 hover:bg-white/70'
      }`}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {uploading ? (
        <div className="inline-flex items-center gap-2 text-or-dark text-sm font-bold">
          <Spinner size={14} /> Upload en cours…
        </div>
      ) : (
        <div>
          <div className="font-bold text-sm text-text">{title}</div>
          <div className="text-[12px] text-muted mt-1">{isDragging ? 'Déposez ici' : subtitle}</div>
        </div>
      )}
    </label>
  )
}
