import { useEffect, useState } from 'react'
import { fetchAttachmentObjectUrl } from '../../lib/api'

type Props = {
  attachmentId: string
  alt: string
  className?: string
}

/**
 * Affiche une pièce jointe image via un fetch authentifié (cookie) → object URL.
 * Le endpoint /attachments/:id/raw étant protégé, une <img src> directe casse ;
 * on récupère donc le blob comme pour le PDF des devis.
 */
export function AuthImage({ attachmentId, alt, className }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setUrl(null)
    setFailed(false)
    fetchAttachmentObjectUrl(attachmentId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachmentId])

  if (failed) {
    return (
      <div className={`fiche-photo-fallback ${className ?? ''}`} title="Image indisponible">
        <span>⚠︎</span>
      </div>
    )
  }
  if (!url) {
    return <div className={`fiche-photo-skeleton ${className ?? ''}`} aria-hidden />
  }
  return <img src={url} alt={alt} className={className} loading="lazy" />
}
