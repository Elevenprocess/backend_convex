import { useEffect } from 'react'
import { formatDate } from '../../lib/suivi'
import type { ProjectAttachmentResponse } from '../../lib/types'
import { AuthImage } from './AuthImage'

type Props = {
  photos: ProjectAttachmentResponse[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}

/** Visionneuse plein écran d'une photo de projet, avec navigation préc./suiv. */
export function PhotoLightbox({ photos, index, onIndexChange, onClose }: Props) {
  const photo = photos[index]
  const hasPrev = index > 0
  const hasNext = index < photos.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < photos.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, onIndexChange, onClose])

  if (!photo) return null

  return (
    <div className="fiche-lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <button type="button" className="fiche-lightbox-close" onClick={onClose} aria-label="Fermer">✕</button>
      {hasPrev && (
        <button
          type="button"
          className="fiche-lightbox-nav fiche-lightbox-prev"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1) }}
          aria-label="Photo précédente"
        >‹</button>
      )}
      <figure className="fiche-lightbox-figure" onClick={(e) => e.stopPropagation()}>
        <AuthImage attachmentId={photo.id} url={photo.url} alt={photo.label || photo.filename} className="fiche-lightbox-img" />
        <figcaption className="fiche-lightbox-caption">
          <span className="truncate">{photo.label || photo.filename}</span>
          <span className="fiche-lightbox-meta">{index + 1} / {photos.length} · {formatDate(photo.createdAt)}</span>
        </figcaption>
      </figure>
      {hasNext && (
        <button
          type="button"
          className="fiche-lightbox-nav fiche-lightbox-next"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1) }}
          aria-label="Photo suivante"
        >›</button>
      )}
    </div>
  )
}
