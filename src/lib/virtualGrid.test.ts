import { describe, it, expect } from 'vitest'
import { rowsForGrid } from './virtualGrid'

describe('rowsForGrid', () => {
  it('calcule le nombre de lignes pour une grille', () => {
    expect(rowsForGrid(0, 3)).toBe(0)
    expect(rowsForGrid(3, 3)).toBe(1)
    expect(rowsForGrid(4, 3)).toBe(2)
    expect(rowsForGrid(10, 1)).toBe(10)
  })
})
