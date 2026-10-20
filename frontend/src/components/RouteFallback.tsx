// Fallback affiché le temps qu'un chunk se charge (premier rendu, rechargement
// après déploiement). Il n'apparaît qu'au-delà de 120 ms : un chargement rapide
// ne fait pas clignoter l'écran. Squelette à reflet plutôt que le mot
// « Chargement… » (conservé pour les lecteurs d'écran).
export function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="sr-only">Chargement…</span>
      <span className="v-skel route-fallback__title" />
      <span className="v-skel route-fallback__line" />
      <span className="v-skel route-fallback__block" />
    </div>
  )
}
