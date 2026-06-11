import { useState } from 'react'
import { attachmentRawUrl } from '../../lib/api'

type Props = {
  attachmentId: string
  alt: string
  className?: string
}

/**
 * Affiche une pièce jointe image via une <img src> directe vers
 * /attachments/:id/raw. L'auth passe par le cookie de session, envoyé même en
 * cross-origin car `crm.*` et `api.*` partagent le site electroconceptoi.com.
 *
 * On NE fait PAS de fetch+blob : en prod l'API est cross-origin et la réponse
 * StreamableFile du endpoint raw ne porte pas les en-têtes CORS — un fetch().blob()
 * échouait donc (image cassée), alors qu'une <img> n'a pas besoin de CORS.
 */
export function AuthImage({ attachmentId, alt, className }: Props) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={`fiche-photo-fallback ${className ?? ''}`} title="Image indisponible">
        <span>⚠︎</span>
      </div>
    )
  }

  return (
    <img
      src={attachmentRawUrl(attachmentId)}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
