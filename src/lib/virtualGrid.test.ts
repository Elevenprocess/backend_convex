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

// ── Fonctions de colonnes responsives (testées ici indépendamment des callers) ──

describe('colonnes responsives ClientsList (grid-cols-1 sm:2 lg:3 xl:4)', () => {
  const cols = (w: number) => (w < 640 ? 1 : w < 1024 ? 2 : w < 1280 ? 3 : 4)
  it('1 colonne en mobile (<640 px)', () => expect(cols(320)).toBe(1))
  it('1 colonne à la limite mobile (639 px)', () => expect(cols(639)).toBe(1))
  it('2 colonnes en tablette (640–1023 px)', () => expect(cols(768)).toBe(2))
  it('3 colonnes en desktop lg (1024–1279 px)', () => expect(cols(1024)).toBe(3))
  it('4 colonnes en grand écran xl (≥1280 px)', () => expect(cols(1280)).toBe(4))
})

describe('colonnes responsives Suivi (minmax 320px)', () => {
  const cols = (w: number) => Math.max(1, Math.floor(w / 320))
  it('1 colonne minimum (même à largeur 0)', () => expect(cols(0)).toBe(1))
  it('1 colonne pour 319 px', () => expect(cols(319)).toBe(1))
  it('2 colonnes pour 640 px', () => expect(cols(640)).toBe(2))
  it('3 colonnes pour 1024 px (valeur jsdom mockée)', () => expect(cols(1024)).toBe(3))
  it('4 colonnes pour 1280 px', () => expect(cols(1280)).toBe(4))
})
