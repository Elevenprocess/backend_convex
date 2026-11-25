import { describe, expect, it } from 'vitest'
import { promotionPieSlices } from './PromotionPie'

describe('promotionPieSlices', () => {
  it('découpe les leads en parts qui ne se chevauchent pas', () => {
    const b = { leads: 284, joints: 170, rdvDomicile: 45, rdvBureau: 0, qualifies: 61, signes: 2 }
    const a = { leads: 1, joints: 1, rdvDomicile: 0, rdvBureau: 0, qualifies: 1, signes: 0 }
    const s = promotionPieSlices([b, a])
    expect(s.map((x) => x.value)).toEqual([114, 109, 60, 2])
    expect(s.reduce((n, x) => n + x.value, 0)).toBe(285)
  })
})
