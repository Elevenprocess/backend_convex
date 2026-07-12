import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'

/**
 * Pop-up d'ajout d'une note au journal du projet. Renvoie le texte saisi via
 * onSubmit ; la mise en forme (en-tête horodaté + auteur) est faite par
 * l'appelant via prependNote(). Échap ferme, Cmd/Ctrl+Entrée valide.
 *
 * Surfaces 100 % theme-aware (tokens) : fonctionne en clair ET en sombre.
 * Plein écran sur mobile, panneau centré sur desktop.
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

  // Auto-extension : le textarea grandit avec le contenu jusqu'à un plafond,
  // puis défile. Évite la poignée de resize manuelle.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`
  }, [text])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || saving) return
    onSubmit(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-stretch justify-center bg-[rgba(15,30,22,0.58)] p-0 backdrop-blur-sm sm:items-center sm:p-7"
      role="dialog"
      aria-modal="true"
      aria-label="Ajouter une note"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-cream-darker shadow-2xl sm:h-auto sm:max-h-[88vh] sm:w-[min(540px,94vw)] sm:rounded-2xl sm:border sm:border-line"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'fiche-wf-fade .16s ease' }}
      >
        {/* En-tête */}
        <header className="flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-or-tint text-or-dark">
              <Icon name="edit" size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black leading-tight text-text">Ajouter une note</h2>
              <p className="truncate text-[11px] leading-tight text-muted">Journal de suivi du projet</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-muted transition hover:border-rouille/40 hover:bg-rouille-tint hover:text-rouille"
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        {/* Corps */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="Note de suivi (visite technique, relance, point de blocage…)"
            rows={5}
            className="w-full min-h-[140px] resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-text outline-none transition placeholder:text-faint focus:border-or"
          />
        </div>

        {/* Pied : raccourci + actions */}
        <footer
          className="flex items-center justify-between gap-3 border-t border-line bg-card px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <span className="hidden items-center gap-1 text-[10px] font-medium text-faint sm:flex">
            <kbd className="rounded border border-line bg-cream px-1.5 py-0.5 font-sans text-[10px] text-muted">⌘</kbd>
            <span>/</span>
            <kbd className="rounded border border-line bg-cream px-1.5 py-0.5 font-sans text-[10px] text-muted">Ctrl</kbd>
            <span>+</span>
            <kbd className="rounded border border-line bg-cream px-1.5 py-0.5 font-sans text-[10px] text-muted">Entrée</kbd>
            <span>pour valider</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-muted transition hover:bg-cream"
              onClick={onClose}
            >
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
        </footer>
      </div>
    </div>
  )
}
