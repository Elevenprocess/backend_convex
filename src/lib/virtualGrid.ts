import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'

export function rowsForGrid(itemCount: number, columns: number): number {
  if (itemCount <= 0 || columns <= 0) return 0
  return Math.ceil(itemCount / columns)
}

// Virtualise une grille de cartes par LIGNES : chaque ligne virtuelle contient
// `columns` cartes. Même librairie que LeadsList (useLeadRowVirtualizer).
export function useCardGridVirtualizer(
  scrollRef: RefObject<HTMLElement>,
  itemCount: number,
  opts: { columns: number; estimateRowHeight: number; gap?: number },
): Virtualizer<HTMLElement, Element> {
  return useVirtualizer({
    count: rowsForGrid(itemCount, opts.columns),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => opts.estimateRowHeight + (opts.gap ?? 0),
    overscan: 4,
  })
}
