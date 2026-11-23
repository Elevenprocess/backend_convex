import { describe, expect, it } from 'vitest'
import { ghlSlotTexts, officeSlotDays, officeSlotHours } from './promotionSlots'

const R = 4 * 3_600_000
const day = (d: string) => Date.parse(`${d}T00:00:00Z`) - R

describe('créneaux bureau (miroir du serveur)', () => {
  it('jeu./ven./sam. 8 h-18 h, dim. 8 h-13 h', () => {
    expect(officeSlotDays(day('2026-11-23'), day('2026-11-30') - 1, day('2026-11-23'))).toEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'])
    expect(officeSlotHours('2026-11-27', day('2026-11-23'))).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(officeSlotHours('2026-11-29', day('2026-11-23'))).toEqual([8, 9, 10, 11, 12])
  })
  it('libellé', () => {
    expect(ghlSlotTexts('2026-11-27', 9).creneau).toBe('Vendredi 27 novembre, 9 h à 10 h')
  })
})
