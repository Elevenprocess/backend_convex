// Fallback minimal affiché le temps qu'un chunk de page (React.lazy) se charge.
// Volontairement léger : pas d'animation lourde, juste un repère visuel.
export function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', opacity: 0.6 }}>
      Chargement…
    </div>
  )
}
