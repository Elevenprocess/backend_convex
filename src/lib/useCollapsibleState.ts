import { useState } from 'react'

const PREFIX = 'ecoi.collapse.'

/**
 * État replié/déplié persistant dans localStorage (best-effort).
 * '1' = replié, '0' = déplié ; valeur absente/illisible → defaultCollapsed.
 */
export function useCollapsibleState(
  storageKey: string,
  defaultCollapsed: boolean,
): [boolean, () => void] {
  const fullKey = PREFIX + storageKey
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(fullKey)
      if (raw === '1') return true
      if (raw === '0') return false
    } catch {
      // localStorage indisponible (mode privé, quota) → défaut
    }
    return defaultCollapsed
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(fullKey, next ? '1' : '0')
      } catch {
        // best-effort
      }
      return next
    })
  }

  return [collapsed, toggle]
}
