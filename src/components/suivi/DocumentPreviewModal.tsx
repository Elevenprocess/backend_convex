import { useEffect, useState } from 'react'
import { Icon } from '../Icon'

export type DocPreview = {
  /** URL brute (streamée par l'API, auth via cookie de session). */
  url: string
  filename: string
  /** Type MIME si connu (contentType pour les attachments, mimeType pour les docs). */
  mimeType?: string | null
  label?: string | null
}

type Props = {
  doc: DocPreview
  onClose: () => void
}

function kindOf(doc: DocPreview): 'image' | 'pdf' | 'other' {
  const mime = (doc.mimeType ?? '').toLowerCase()
  const name = doc.filename.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(name)) return 'image'
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  return 'other'
}

/**
 * Aperçu d'un document/mandat dans une pop-up, sans quitter la page. On affiche
 * le binaire en direct via l'URL brute (/attachments/:id/raw ou /documents/:id/raw) :
 * <img> pour les images, <iframe> pour les PDF. L'auth passe par le cookie de
 * session, envoyé même cross-origin — pas de fetch().blob() (la réponse raw ne
 * porte pas d'en-têtes CORS et casserait), pas de window.open (navigation
 * top-level qui n'envoie pas le cookie → 404).
 */
export function DocumentPreviewModal({ doc, onClose }: Props) {
  const [failed, setFailed] = useState(false)
  const kind = kindOf(doc)
  const title = doc.label || doc.filename

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
        <header className="doc-preview-head">
          <div className="doc-preview-title">
            <span className="doc-preview-icon"><Icon name="tag" size={15} /></span>
            <span className="truncate">{title}</span>
          </div>
          <div className="doc-preview-actions">
            <a className="doc-preview-open" href={doc.url} target="_blank" rel="noreferrer" title="Ouvrir dans un nouvel onglet">
              <Icon name="download" size={14} />
            </a>
            <button type="button" className="doc-preview-close" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </header>

        <div className="doc-preview-body">
          {failed || kind === 'other' ? (
            <div className="doc-preview-fallback">
              <span className="doc-preview-fallback-icon"><Icon name="tag" size={28} /></span>
              <p>Aperçu indisponible pour ce type de fichier.</p>
              <a className="btn-primary" href={doc.url} target="_blank" rel="noreferrer">Ouvrir le fichier</a>
            </div>
          ) : kind === 'image' ? (
            <img
              className="doc-preview-img"
              src={doc.url}
              alt={title}
              onError={() => setFailed(true)}
            />
          ) : (
            <iframe
              className="doc-preview-frame"
              src={doc.url}
              title={title}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
