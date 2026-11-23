import { describe, expect, it } from 'vitest'
import { readPromoTabs, writePromoTabs } from './promoTabsUrl'

const p = (s: string) => new URLSearchParams(s)

describe('onglets de promo dans l’adresse', () => {
  it('lit les trois onglets', () => {
    expect(readPromoTabs(p(''))).toEqual({ view: 'leads', promoId: null })
    expect(readPromoTabs(p('onglet=promotion'))).toEqual({ view: 'promotions', promoId: null })
    expect(readPromoTabs(p('onglet=promo&promo=abc'))).toEqual({ view: 'promoLeads', promoId: 'abc' })
  })
  it('onglet promo sans id = onglet Leads', () => {
    expect(readPromoTabs(p('onglet=promo')).view).toBe('leads')
  })
  it('ouvre une promo puis revient sur Leads en gardant l’onglet ouvert', () => {
    const opened = writePromoTabs(p('search=dupont'), { view: 'promoLeads', promoId: 'abc' })
    expect(opened.toString()).toBe('search=dupont&promo=abc&onglet=promo')
    const back = writePromoTabs(opened, { view: 'leads' })
    expect(readPromoTabs(back)).toEqual({ view: 'leads', promoId: 'abc' })
    expect(back.get('search')).toBe('dupont')
  })
  it('fermer la promo ouverte retombe sur Promotion', () => {
    const closed = writePromoTabs(p('onglet=promo&promo=abc'), { promoId: null })
    expect(readPromoTabs(closed)).toEqual({ view: 'promotions', promoId: null })
  })
})
