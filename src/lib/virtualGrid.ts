import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useState, useLayoutEffect, useRef, type RefObject } from 'react'

export function rowsForGrid(itemCount: number, columns: number): number {
  if (itemCount <= 0 || columns <= 0) return 0
  return Math.ceil(itemCount / columns)
}

/** Fixed column count or a function that maps container width → column count */
export type ColumnsInput = number | ((containerWidth: number) => number)

export interface CardGridVirtualizerResult {
  virtualizer: Virtualizer<HTMLElement, Element>
  /** Current resolved column count — use for slice AND gridTemplateColumns */
  columns: number
}

function resolveColumnsInput(input: ColumnsInput, width: number): number {
  const val = typeof input === 'function' ? input(width) : input
  return Math.max(1, val)
}

/**
 * Virtualise une grille de cartes par LIGNES.
 *
 * `columns` accepte :
 *   - un nombre fixe (rétro-compatibilité)
 *   - une fonction `(containerWidth: number) => number` pour des colonnes
 *     responsives mesurées via ResizeObserver. Une mesure synchrone initiale
 *     est prise au montage (useLayoutEffect) pour que le premier rendu soit
 *     correct même dans jsdom (où offsetWidth est mocké à 1024).
 *
 * `scrollMargin` (optionnel) : décalage en px entre le haut du scroll-element
 *   et le début de la liste. Utilisez le même nombre dans votre
 *   `transform: translateY(vRow.start - scrollMargin)`.
 *
 * Retourne `{ virtualizer, columns }` : utilisez `columns` dans les callers
 * pour le slicing des lignes ET pour `gridTemplateColumns`.
 *
 * Mesure dynamique : chaque ligne est mesurée après rendu via
 * `virtualizer.measureElement`. Pour l'activer, ajoutez
 * `ref={virtualizer.measureElement}` et `data-index={vRow.index}` sur le div
 * de ligne positionné en absolu. `estimateRowHeight` n'est utilisé qu'à titre
 * d'estimation initiale avant la première mesure réelle.
 */
export function useCardGridVirtualizer(
  scrollRef: RefObject<HTMLElement | null>,
  itemCount: number,
  opts: {
    columns: ColumnsInput
    estimateRowHeight: number
    gap?: number
    scrollMargin?: number
  },
): CardGridVirtualizerResult {
  const { columns: columnsInput, estimateRowHeight, gap = 0, scrollMargin = 0 } = opts

  // Keep the latest columns function/value in a ref so ResizeObserver callbacks
  // always use the most-recent value without re-subscribing on every render.
  const columnsInputRef = useRef<ColumnsInput>(columnsInput)
  columnsInputRef.current = columnsInput

  // ── Initial column count ───────────────────────────────────────────────────
  // Fixed number → use directly.
  // Function → estimate from window.innerWidth (often 0 in jsdom; the layout
  // effect below corrects this synchronously before the browser paints).
  const [columns, setColumns] = useState<number>(() => {
    if (typeof columnsInput === 'number') return columnsInput
    const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 0
    return resolveColumnsInput(columnsInput, fallbackWidth)
  })

  // ── Sync fixed-number columns ──────────────────────────────────────────────
  // `fixedCols` is null when columnsInput is a function (no unnecessary runs).
  const fixedCols = typeof columnsInput === 'number' ? columnsInput : null
  useLayoutEffect(() => {
    if (fixedCols !== null) setColumns(fixedCols)
  }, [fixedCols])

  // ── ResizeObserver for function-based columns ──────────────────────────────
  // Deps: `hasFnCols` (changes only if caller switches number↔function) and
  // `scrollRef` (stable object). We intentionally do NOT depend on
  // `columnsInput` directly — the ref pattern gives us the latest function
  // without triggering a re-subscription on every render (inline arrow fns).
  const hasFnCols = typeof columnsInput === 'function'
  useLayoutEffect(() => {
    if (!hasFnCols) return

    const el = scrollRef.current
    const measure = () => {
      // offsetWidth is mocked to 1024 in jsdom (src/test/setup.ts) → correct
      // columns are measured synchronously at mount time even in tests.
      const width = el ? el.offsetWidth : 0
      if (width <= 0) return
      const fn = columnsInputRef.current
      const next = typeof fn === 'function' ? Math.max(1, fn(width)) : (fn as number)
      setColumns((prev) => (prev === next ? prev : next))
    }

    measure() // ← synchronous initial measurement (critical for jsdom / first paint)

    const ro = new ResizeObserver(measure)
    if (el) ro.observe(el)

    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFnCols, scrollRef])

  const cols = Math.max(1, columns)

  const virtualizer = useVirtualizer({
    count: rowsForGrid(itemCount, cols),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight + gap,
    measureElement: (el) => (el as HTMLElement).getBoundingClientRect().height,
    overscan: 4,
    scrollMargin,
  })

  return { virtualizer, columns: cols }
}
