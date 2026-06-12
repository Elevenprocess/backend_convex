import { useEffect, useRef, useState } from 'react'

/**
 * Pop-up d'ajout d'une note au journal du projet. Renvoie le texte saisi via
 * onSubmit ; la mise en forme (en-tête horodaté + auteur) est faite par
 * l'appelant via prependNote(). Échap ferme, Cmd/Ctrl+Entrée valide.
 */
export function AddNoteModal({
  onSubmit,
  onClose,
  saving = false,
}: {
  onSubmit: (text: string) => void
  onClose: () => void
  saving?: boolean
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || saving) return
    onSubmit(trimmed)
  }

  return (
    <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label="Ajouter une note" onClick={onClose}>
      <div className="doc-preview" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <header className="doc-preview-head">
          <div className="doc-preview-title"><span>Ajouter une note</span></div>
          <button type="button" className="doc-preview-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>
        <div className="doc-preview-body" style={{ padding: 16, display: 'block' }}>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="Note de suivi (visite technique, relance, point de blocage…)"
            rows={6}
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-text focus:border-or focus:outline-none"
            style={{ resize: 'vertical' }}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-muted" onClick={onClose}>
              Annuler
            </button>
            <button
              type="button"
              className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={submit}
              disabled={!text.trim() || saving}
            >
              {saving ? 'Enregistrement…' : 'Ajouter la note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
