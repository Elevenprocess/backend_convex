import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchDevisPdfObjectUrl } from '../../lib/api'

type Props = {
  devisId: string
  filename?: string | null
  onClose: () => void
}

/** Modale plein écran affichant le PDF d'origine du devis dans une iframe. */
export function PdfPreviewModal({ devisId, filename, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Récupère le blob PDF → object URL, révoqué au démontage.
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    fetchDevisPdfObjectUrl(devisId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Chargement du PDF échoué.')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [devisId])

  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Fermeture au clavier (Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-[160] bg-stone-900/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-title"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-stone-200">
          <span id="pdf-preview-title" className="text-sm font-bold text-stone-900 truncate">{filename ?? 'Devis'}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="px-2 py-1 text-stone-500 hover:text-stone-900"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 bg-stone-100">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-red-700">{error}</div>
          ) : url ? (
            <iframe title="Aperçu du devis" src={url} className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-stone-500">
              Chargement du PDF…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
