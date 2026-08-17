import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { useAuth } from '../../lib/auth'

const API_ORIGIN = ((import.meta.env.VITE_CONVEX_URL as string | undefined) ?? 'https://spotted-horse-257.eu-west-1.convex.cloud').replace('.convex.cloud', '.convex.site')

/**
 * Bouton flottant d'aide (bas droite, toutes les pages de l'app), réservé aux
 * ADMINS : menu vers la documentation de l'API, le guide agents IA et la
 * gestion des clés. Les autres rôles ne le voient pas.
 */
export function HelpFab() {
  const [open, setOpen] = useState(false)
  const role = useAuth((s) => s.user?.role)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (role !== 'admin') return null

  return (
    <div ref={ref} className="help-fab" data-testid="help-fab">
      {open && (
        <div className="help-fab-menu" role="menu">
          <p className="help-fab-title">Aide & API</p>
          <a href="#/api-docs" target="_blank" rel="noreferrer" role="menuitem" className="help-fab-item" onClick={() => setOpen(false)}>
            <Icon name="help" size={15} />
            <span><b>Documentation de l'API</b><small>Toutes les routes, paramètres, exemples</small></span>
          </a>
          <a href={`${API_ORIGIN}/api/v1/guide.md`} target="_blank" rel="noreferrer" role="menuitem" className="help-fab-item" onClick={() => setOpen(false)}>
            <Icon name="sparkles" size={15} />
            <span><b>Guide pour agents IA</b><small>Markdown à donner à Hermes / n8n</small></span>
          </a>
          <a href="#/settings" role="menuitem" className="help-fab-item" onClick={() => setOpen(false)}>
            <Icon name="key" size={15} />
            <span><b>Gérer les clés API</b><small>Paramètres → API</small></span>
          </a>
        </div>
      )}
      <button
        type="button"
        aria-label="Aide et documentation de l'API"
        aria-expanded={open}
        title="Aide & API"
        onClick={() => setOpen((v) => !v)}
        className={`help-fab-button ${open ? 'is-open' : ''}`}
      >
        <Icon name={open ? 'x' : 'help'} size={20} />
      </button>
    </div>
  )
}
