import { useCallback, useState } from 'react'

const PREFIX = 'ecoi.collapse.'

/**
 * État replié/déplié persistant dans localStorage (best-effort).
 * '1' = replié, '0' = déplié ; valeur absente/illisible → defaultCollapsed.
 *
 * Renvoie [collapsed, toggle, setCollapsed]. `setCollapsed` (valeur explicite)
 * sert au pliage groupé « Tout réduire / Tout développer ». `toggle` et
 * `setCollapsed` sont stables (useCallback) pour pouvoir figurer sans risque
 * dans les dépendances d'un useEffect côté consommateur.
 */
export function useCollapsibleState(
  storageKey: string,
  defaultCollapsed: boolean,
): [boolean, () => void, (value: boolean) => void] {
  const fullKey = PREFIX + storageKey
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(fullKey)
      if (raw === '1') return true
      if (raw === '0') return false
    } catch {
      // localStorage indisponible (mode privé, quota) → défaut
    }
    return defaultCollapsed
  })

  const persist = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(fullKey, next ? '1' : '0')
      } catch {
        // best-effort
      }
    },
    [fullKey],
  )

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      persist(next)
      return next
    })
  }, [persist])

  const setCollapsed = useCallback(
    (value: boolean) => {
      setCollapsedState(value)
      persist(value)
    },
    [persist],
  )

  return [collapsed, toggle, setCollapsed]
}
