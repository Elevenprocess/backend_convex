import { describe, expect, it } from 'vitest'
import {
  activePromotionIds, activePromotionLeads, formatPromotionRange, isInActivePromotion, officePromotion,
  promotionLeads, withoutActivePromotionLeads, type ActivePromotion,
  bureauDays, formatBureauDay, leadKpis, promotionWebhookUrl,
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
  it('onglet Promotion : leads de toutes les promos en cours', () => {
    const more = [...leads, { id: 'e', promotionId: 'p2', promotionSource: 'tag' as const }]
    const ids = activePromotionIds([promo, { ...promo, _id: 'p2' }])
    expect(activePromotionLeads(more, ids, 'all').map((l) => l.id)).toEqual(['a', 'b', 'e'])
    expect(activePromotionLeads(more, ids, 'tag').map((l) => l.id)).toEqual(['a', 'e'])
    expect(activePromotionLeads(more, ids, 'statut').map((l) => l.id)).toEqual(['b'])
  })
  it('dates en heure de la Réunion', () => {
    expect(formatPromotionRange(promo.startAt, promo.endAt)).toBe('du 23 au 29 nov.')
  })
  it('officePromotion : la promo qui a un calendrier bureau', () => {
    expect(officePromotion([promo])).toBeUndefined()
    expect(officePromotion([{ ...promo, officeCalendarId: 'cal' }])?._id).toBe('p1')
  })
})

describe('promotionWebhookUrl', () => {
  it('passe du domaine .convex.cloud au .convex.site', () => {
    expect(promotionWebhookUrl('https://spotted-horse-257.eu-west-1.convex.cloud', 'abc'))
      .toBe('https://spotted-horse-257.eu-west-1.convex.site/webhooks/ghl/promotion/abc')
  })
  it('null sans clé ou sans URL', () => {
    expect(promotionWebhookUrl(undefined, 'abc')).toBeNull()
    expect(promotionWebhookUrl('https://x.convex.cloud', undefined)).toBeNull()
  })
})

describe('bureauDays', () => {
  // 2026-11-20 00:00 Réunion = 2026-11-19T20:00Z ; fin 2026-11-30 23:59:59 Réunion.
  const start = Date.UTC(2026, 10, 19, 20)
  const end = Date.UTC(2026, 10, 30, 19, 59, 59)
  it('vendredis et samedis restants de la promo', () => {
    expect(bureauDays(start, end, Date.UTC(2026, 10, 21, 6))).toEqual(['2026-11-21', '2026-11-27', '2026-11-28'])
  })
  it('vide une fois la promo finie', () => {
    expect(bureauDays(start, end, Date.UTC(2026, 11, 1, 6))).toEqual([])
  })
  it('libellé lisible', () => {
    expect(formatBureauDay('2026-11-27')).toBe('ven. 27 nov.')
  })
})

describe('leadKpis', () => {
  it('compte sur la liste donnée', () => {
    expect(leadKpis([
      { status: 'nouveau', source: 'ghl' }, { status: 'rdv_pris', source: 'ghl' }, { status: 'perdu', source: 'manual' },
    ])).toEqual({ total: 3, directGhl: 2, qualifies: 1, perdus: 1 })
  })
})
