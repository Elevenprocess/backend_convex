import { describe, expect, it } from 'vitest'
import { buildDemoAdsData, demoDayKeys, isEmptyAdsReport } from './adsDemo'

const FROM = '2026-06-30T20:00:00.000Z' // 1er juillet minuit Réunion
const TO = '2026-07-31T19:59:59.999Z'

describe('adsDemo', () => {
  it('déterministe : deux générations identiques pour la même période', () => {
    expect(buildDemoAdsData(FROM, TO)).toEqual(buildDemoAdsData(FROM, TO))
  })

  it('série continue sur la période, avec de la dépense et des prospects', () => {
    const { campaign } = buildDemoAdsData(FROM, TO)
    expect(campaign.series!.length).toBe(demoDayKeys(FROM, TO).length)
    expect(campaign.series!.some((p) => p.spend > 0)).toBe(true)
    expect(campaign.series!.some((p) => p.leads > 0)).toBe(true)
  })

  it('totaux cohérents : somme des lignes campagne = totals', () => {
    const { campaign } = buildDemoAdsData(FROM, TO)
    const spend = campaign.rows.reduce((s, r) => s + r.spend, 0)
    const leads = campaign.rows.reduce((s, r) => s + r.leads, 0)
    expect(campaign.totals.spend).toBeCloseTo(spend, 6)
    expect(campaign.totals.leads).toBe(leads)
    expect(campaign.totals.roas).toBeGreaterThan(0)
  })

  it('drill-down cohérent : les prospects des adsets recomposent leur campagne', () => {
    const { campaign, adset, ad } = buildDemoAdsData(FROM, TO)
    for (const c of campaign.rows.filter((r) => r.campaignId)) {
      const children = adset.rows.filter((a) => a.campaignId === c.campaignId)
      expect(children.reduce((s, a) => s + a.leads, 0)).toBe(c.leads)
      for (const a of children) {
        const ads = ad.rows.filter((x) => x.adsetId === a.adsetId)
        expect(ads.reduce((s, x) => s + x.leads, 0)).toBe(a.leads)
      }
    }
  })

  it('inclut une ligne « prospect sans dépense » pour la section non rapprochée', () => {
    const { campaign } = buildDemoAdsData(FROM, TO)
    expect(campaign.rows.some((r) => r.unmatched === 'leads_no_spend')).toBe(true)
  })

  it('isEmptyAdsReport : vide sur null/zéros, non vide dès la moindre donnée', () => {
    expect(isEmptyAdsReport(null)).toBe(true)
    expect(
      isEmptyAdsReport({
        rows: [],
        totals: { spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0, devisSignes: 0, ca: 0, roas: 0, tauxSignature: 0 },
        series: [],
      }),
    ).toBe(true)
    const demo = buildDemoAdsData(FROM, TO)
    expect(isEmptyAdsReport(demo.campaign)).toBe(false)
  })
})
