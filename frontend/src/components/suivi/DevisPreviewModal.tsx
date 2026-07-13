import { useEffect, useState } from 'react'
import { fetchDevisPdfObjectUrl } from '../../lib/api'
import { Spinner } from '../Spinner'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { Devis } from '../../lib/types'

/**
 * Aperçu d'un devis dans une pop-up, sans quitter la fiche. Le PDF est récupéré
 * en blob authentifié (cookie de session) puis affiché dans une iframe via un
 * object URL : un `blob:` s'affiche toujours inline, quel que soit le
 * Content-Disposition renvoyé par l'API (la route /devis/:id/pdf force
 * `attachment`, ce qui empêcherait un rendu inline en URL directe).
 */
export function DevisPreviewModal({ devis, onClose }: { devis: Devis; onClose: () => void }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    fetchDevisPdfObjectUrl(devis.id)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        url = u
        setObjectUrl(u)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Aperçu du devis indisponible.')
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [devis.id])

  const title = devis.devisNumber || devis.filename

  if (error) {
    return (
      <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
        <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
          <header className="doc-preview-head">
            <div className="doc-preview-title"><span className="truncate">{title}</span></div>
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
      <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
        <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
          <header className="doc-preview-head">
            <div className="doc-preview-title"><span className="truncate">{title}</span></div>
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
      doc={{ url: objectUrl, filename: devis.filename, mimeType: 'application/pdf', label: devis.devisNumber }}
      onClose={onClose}
    />
  )
}
