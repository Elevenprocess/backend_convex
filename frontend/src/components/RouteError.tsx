import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { RouteFallback } from './RouteFallback'

const RELOAD_FLAG = 'ecoi.chunk-reload-at'

// Un chunk lazy (React.lazy) introuvable = déploiement passé entre deux
// navigations : l'index.html en mémoire référence des fichiers hashés qui
// n'existent plus. La seule issue est de recharger pour récupérer le nouveau
// build.
function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /dynamically imported module|Importing a module script failed|error loading|Failed to fetch/i.test(msg)
}

// Garde anti-boucle : on ne recharge automatiquement qu'une fois toutes les
// 15 s. Si le rechargement ne règle pas le problème (vraie panne), on affiche
// l'écran d'erreur au lieu de boucler.
export function shouldAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0)
    if (Date.now() - last < 15_000) return false
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
    return true
  } catch {
    return false
  }
}

/**
 * errorElement du routeur : chunk périmé → rechargement auto silencieux ;
 * toute autre erreur → écran propre avec bouton recharger (au lieu du
 * « Application Error! » brut de react-router).
 */
export function RouteError() {
  const error = useRouteError()
  const stale = isStaleChunkError(error)
  const autoReloading = stale && shouldAutoReload()

  useEffect(() => {
    if (autoReloading) window.location.reload()
  }, [autoReloading])

  // Pendant le rechargement auto : même visuel que le chargement d'un chunk.
  if (autoReloading) return <RouteFallback />

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-2xl">⚠️</p>
      <h1 className="text-lg font-bold text-text">
        {stale ? 'Nouvelle version disponible' : 'Une erreur est survenue'}
      </h1>
      <p className="max-w-md text-sm text-muted">
        {stale
          ? "L'application a été mise à jour pendant que cette page était ouverte. Recharge pour récupérer la nouvelle version."
          : "Quelque chose s'est mal passé au chargement de cette page. Recharge, et si le problème persiste préviens l'équipe."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 rounded-xl bg-or px-4 py-2 text-sm font-semibold text-white transition hover:bg-or-dark"
      >
        Recharger la page
      </button>
    </div>
  )
}
