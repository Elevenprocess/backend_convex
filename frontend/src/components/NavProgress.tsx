import { useEffect, useState } from 'react'
import { useNavigation } from 'react-router-dom'

// Fil de progression en haut de l'écran pendant un changement de page qui
// attend son chunk. Affiché seulement après 150 ms : une navigation rapide
// (chunk déjà préchargé) n'affiche rien.
export function NavProgress() {
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const [delayPassed, setDelayPassed] = useState(false)
  useEffect(() => {
    if (!busy) return
    const t = window.setTimeout(() => setDelayPassed(true), 150)
    return () => {
      window.clearTimeout(t)
      setDelayPassed(false)
    }
  }, [busy])
  const visible = busy && delayPassed
  return <div className={`nav-progress ${visible ? 'is-active' : ''}`} aria-hidden="true" />
}
