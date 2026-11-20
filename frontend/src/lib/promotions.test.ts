import { describe, expect, it } from 'vitest'
import {
  activePromotionIds, formatPromotionRange, isInActivePromotion, officePromotion,
  promotionLeads, withoutActivePromotionLeads, type ActivePromotion,
} from './promotions'

const promo: ActivePromotion = { _id: 'p1', name: 'Black Friday', startAt: Date.parse('2026-11-22T20:00:00Z'), endAt: Date.parse('2026-11-29T19:59:59.999Z') }
const leads = [
  { id: 'a', promotionId: 'p1', promotionSource: 'tag' as const },
  { id: 'b', promotionId: 'p1', promotionSource: 'statut' as const },
  { id: 'c', promotionId: 'old', promotionSource: 'tag' as const },
  { id: 'd', promotionId: null, promotionSource: null },
]

describe('promotions helpers', () => {
  it('exclut seulement les leads des promos en cours', () => {
    const ids = activePromotionIds([promo])
    expect(withoutActivePromotionLeads(leads, ids).map((l) => l.id)).toEqual(['c', 'd'])
    expect(isInActivePromotion(leads[0], ids)).toBe(true)
    expect(isInActivePromotion(leads[2], ids)).toBe(false)
  })
  it('promo archivée/terminée (absente des actives) → leads réintégrés', () => {
    expect(withoutActivePromotionLeads(leads, activePromotionIds([]))).toHaveLength(4)
  })
  it('filtre nouveaux / anciens', () => {
    expect(promotionLeads(leads, 'p1', 'all').map((l) => l.id)).toEqual(['a', 'b'])
    expect(promotionLeads(leads, 'p1', 'tag').map((l) => l.id)).toEqual(['a'])
    expect(promotionLeads(leads, 'p1', 'statut').map((l) => l.id)).toEqual(['b'])
  })
  it('dates en heure de la Réunion', () => {
    expect(formatPromotionRange(promo.startAt, promo.endAt)).toBe('du 23 au 29 nov.')
  })
  it('officePromotion : la promo qui a un calendrier bureau', () => {
    expect(officePromotion([promo])).toBeUndefined()
    expect(officePromotion([{ ...promo, officeCalendarId: 'cal' }])?._id).toBe('p1')
  })
})
