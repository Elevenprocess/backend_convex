import { useEffect, useState } from 'react'
import { fetchSubstepDocumentObjectUrl } from '../../lib/api'
import { Spinner } from '../Spinner'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { SubstepDocument } from '../../lib/types'

/**
 * Aperçu d'un document de sous-étape (pièce du workflow) dans une pop-up. Le
 * binaire est récupéré en blob authentifié (cookie de session) puis affiché via
 * un object URL : un `blob:` s'affiche toujours inline (PDF/image), sans dépendre
 * du Content-Disposition ni des en-têtes CORS de l'URL brute cross-origin.
 */
export function SubstepDocPreviewModal({ doc, onClose }: { doc: SubstepDocument; onClose: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [detectedMime, setDetectedMime] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // URL storage Convex signée (embarquée) : directement affichable inline, pas
    // besoin de la récupérer en blob authentifié via l'ancien endpoint NestJS.
    if (doc.url) {
      setObjectUrl(doc.url)
      setDetectedMime(doc.mimeType)
      return
    }
    let url: string | null = null
    let cancelled = false
    fetchSubstepDocumentObjectUrl(doc.id)
      .then((r) => {
        if (cancelled) {
          URL.revokeObjectURL(r.url)
          return
        }
        url = r.url
        setObjectUrl(r.url)
        setDetectedMime(r.mimeType)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Aperçu du document indisponible.')
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [doc.id, doc.url, doc.mimeType])

  if (error) {
    return (
      <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label={doc.filename} onClick={onClose}>
        <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
          <header className="doc-preview-head">
            <div className="doc-preview-title"><span className="truncate">{doc.filename}</span></div>
            <button type="button" className="doc-preview-close" onClick={onClose} aria-label="Fermer">✕</button>
          </header>
          <div className="doc-preview-body">
            <div className="doc-preview-fallback"><p>{error}</p></div>
          </div>
        </div>
      </div>
    )
  }

  if (!objectUrl) {
    return (
      <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label={doc.filename} onClick={onClose}>
        <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
          <header className="doc-preview-head">
            <div className="doc-preview-title"><span className="truncate">{doc.filename}</span></div>
            <button type="button" className="doc-preview-close" onClick={onClose} aria-label="Fermer">✕</button>
          </header>
          <div className="doc-preview-body" style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
            <Spinner />
          </div>
        </div>
      </div>
    )
  }

  return (
    <DocumentPreviewModal
      doc={{ url: objectUrl, filename: doc.filename, mimeType: detectedMime ?? doc.mimeType }}
      onClose={onClose}
    />
  )
}
