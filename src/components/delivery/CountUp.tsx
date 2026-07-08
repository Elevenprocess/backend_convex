import { useEffect, useState } from 'react'

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

function canAnimate(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.requestAnimationFrame !== 'function') return false
  if (typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Compteur animé 0 → `value`. En l'absence d'animation possible (SSR, jsdom,
 * `prefers-reduced-motion`), renvoie directement la valeur cible — les tests et
 * les utilisateurs sensibles au mouvement voient le chiffre final immédiatement.
 */
function useCountUp(value: number, durationMs = 850): number {
  const [animate] = useState(canAnimate)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!animate) return
    let raf = 0
    let start = 0
    const tick = (ts: number) => {
      if (!start) start = ts
      const p = Math.min(1, (ts - start) / durationMs)
      setDisplay(Math.round(easeOut(p) * value))
      if (p < 1) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [value, durationMs, animate])

  // Hors animation (reduced-motion, jsdom, SSR) : valeur cible directe et fraîche.
  return animate ? display : value
}

type Props = {
  value: number
  format?: (n: number) => string
  className?: string
  durationMs?: number
}

/** Nombre animé prêt à l'emploi ; `format` gère les suffixes (%, k€…). */
export function CountUp({ value, format, className, durationMs }: Props) {
  const n = useCountUp(value, durationMs)
  return <span className={className}>{format ? format(n) : n}</span>
}
