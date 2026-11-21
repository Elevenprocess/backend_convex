import { describe, expect, it } from 'vitest'
import {
  activePromotionIds, activePromotionLeads, formatPromotionRange, isInActivePromotion, officePromotion,
  promotionLeads, withoutActivePromotionLeads, type ActivePromotion,
  bureauDays, formatBureauDay, leadKpis, promotionWebhookUrl, formatPromotionSlot, slotBookingLink, leadSlotView,
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

describe('créneau d’arrivée d’une promo', () => {
  const bf: ActivePromotion = { _id: 'p1', name: 'BF', startAt: 0, endAt: 1, slotBookingUrl: 'https://invitation.exemple.re/' }
  it('formatPromotionSlot', () => {
    expect(formatPromotionSlot('2026-11-27', 14, 'BF-0012')).toBe('vendredi 27, 14 h, billet BF-0012')
    expect(formatPromotionSlot('2026-11-29', 9, null)).toBe('dimanche 29, 9 h')
  })
  it('slotBookingLink : contact GHL + marque setter ; lien non https refusé', () => {
    expect(slotBookingLink('https://invitation.exemple.re/', 'abc123')).toBe('https://invitation.exemple.re/?c=abc123&setter=1')
    expect(slotBookingLink('https://invitation.exemple.re/', null)).toBe('https://invitation.exemple.re/?setter=1')
    expect(slotBookingLink('javascript:alert(1)', 'abc')).toBeNull()
    expect(slotBookingLink('pas un lien', 'abc')).toBeNull()
  })
  it('leadSlotView : créneau pris, pas encore, ou rien', () => {
    expect(leadSlotView({ promotionId: 'p1', externalId: 'c1', promotionSlotDay: '2026-11-27', promotionSlotHour: 14, promotionTicket: 'BF-0012' }, [bf]))
      .toEqual({ hasSlot: true, label: 'Créneau : vendredi 27, 14 h, billet BF-0012', link: 'https://invitation.exemple.re/?c=c1&setter=1' })
    expect(leadSlotView({ promotionId: 'p1', externalId: 'c1' }, [bf]))
      .toEqual({ hasSlot: false, label: 'Pas encore de créneau', link: 'https://invitation.exemple.re/?c=c1&setter=1' })
    // Promo sans site de réservation, ou lead hors promo : rien.
    expect(leadSlotView({ promotionId: 'p1' }, [{ ...bf, slotBookingUrl: undefined }])).toBeNull()
    expect(leadSlotView({ promotionId: null }, [bf])).toBeNull()
    // Créneau à 0 h : bien un créneau.
    expect(leadSlotView({ promotionId: 'p1', promotionSlotDay: '2026-11-27', promotionSlotHour: 0 }, [bf])?.hasSlot).toBe(true)
  })
})
