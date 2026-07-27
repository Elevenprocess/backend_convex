import type { AdsReport, AdsReportRow, AdsSeriesPoint } from './types'

/**
 * Jeu de données de DÉMONSTRATION de la page Publicité — affiché quand le
 * rapport réel est vide (clé Windsor absente → aucune dépense synchronisée).
 * Purement front : rien n'est écrit en base ; dès que de vraies données
 * existent sur la période, la démo s'efface toute seule.
 *
 * Génération déterministe (seed = jour) pour que la page ne « scintille »
 * pas d'un rendu à l'autre et que les tests soient stables.
 */

// mulberry32 — petit PRNG déterministe seedé.
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

type DemoCampaign = {
  id: string
  name: string
  dailyBudget: number // € / jour
  cpl: number // € / prospect cible
  ctr: number // clics / impressions
  signRate: number // devis signés / prospects
  ticket: number // € TTC moyen par devis signé
  adsets: Array<{ id: string; name: string; share: number; ads: Array<{ id: string; name: string; share: number }> }>
}

const DEMO_CAMPAIGNS: DemoCampaign[] = [
  {
    id: 'demo-c1', name: 'Solaire — Leads Réunion', dailyBudget: 55, cpl: 9, ctr: 0.021, signRate: 0.11, ticket: 9200,
    adsets: [
      { id: 'demo-c1-a1', name: 'Propriétaires 30-55 ans', share: 0.62, ads: [
        { id: 'demo-c1-a1-ad1', name: 'Vidéo témoignage client', share: 0.57 },
        { id: 'demo-c1-a1-ad2', name: 'Carrousel économies facture', share: 0.43 },
      ] },
      { id: 'demo-c1-a2', name: 'Lookalike signataires', share: 0.38, ads: [
        { id: 'demo-c1-a2-ad1', name: 'Image maison + panneaux', share: 0.52 },
        { id: 'demo-c1-a2-ad2', name: 'Réel « votre facture en 2026 »', share: 0.48 },
      ] },
    ],
  },
  {
    id: 'demo-c2', name: 'Chauffe-eau solaire — Promo', dailyBudget: 32, cpl: 12, ctr: 0.017, signRate: 0.09, ticket: 4300,
    adsets: [
      { id: 'demo-c2-a1', name: 'Intérêt rénovation', share: 0.55, ads: [
        { id: 'demo-c2-a1-ad1', name: 'Offre pose incluse', share: 0.6 },
        { id: 'demo-c2-a1-ad2', name: 'Avant/après consommation', share: 0.4 },
      ] },
      { id: 'demo-c2-a2', name: 'Retargeting 30 j', share: 0.45, ads: [
        { id: 'demo-c2-a2-ad1', name: 'Rappel simulation', share: 0.5 },
        { id: 'demo-c2-a2-ad2', name: 'FAQ aides & primes', share: 0.5 },
      ] },
    ],
  },
  {
    id: 'demo-c3', name: 'Retargeting visiteurs simulateur', dailyBudget: 18, cpl: 6, ctr: 0.034, signRate: 0.16, ticket: 8700,
    adsets: [
      { id: 'demo-c3-a1', name: 'Abandon simulateur 7 j', share: 1, ads: [
        { id: 'demo-c3-a1-ad1', name: 'Reprenez votre simulation', share: 0.65 },
        { id: 'demo-c3-a1-ad2', name: 'RDV conseiller offert', share: 0.35 },
      ] },
    ],
  },
  {
    id: 'demo-c4', name: 'Notoriété — Énergie verte 974', dailyBudget: 12, cpl: 24, ctr: 0.009, signRate: 0.02, ticket: 7800,
    adsets: [
      { id: 'demo-c4-a1', name: 'Large Réunion 25-65', share: 1, ads: [
        { id: 'demo-c4-a1-ad1', name: 'Spot marque 15 s', share: 1 },
      ] },
    ],
  },
]

/** Jours locaux YYYY-MM-DD couvrant [from..to] (bornes ISO du DateRangePicker). */
export function demoDayKeys(fromIso: string, toIso: string): string[] {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const days: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  // Garde-fou : 366 jours max (période « année » du picker).
  for (let i = 0; i < 366 && cursor.getTime() <= to.getTime(); i++) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    days.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

type DayCell = { spend: number; impressions: number; clicks: number; leads: number; devisSignes: number; ca: number }

function finalizeRow(row: AdsReportRow): AdsReportRow {
  row.cpl = row.leads > 0 ? row.spend / row.leads : 0
  row.roas = row.spend > 0 ? row.ca / row.spend : 0
  row.tauxSignature = row.leads > 0 ? row.devisSignes / row.leads : 0
  if (row.spend > 0 && row.leads === 0) row.unmatched = 'spend_no_leads'
  else if (row.leads > 0 && row.spend === 0) row.unmatched = 'leads_no_spend'
  else row.unmatched = null
  return row
}

function splitInt(total: number, shares: number[]): number[] {
  const out = shares.map((s) => Math.floor(total * s))
  let rest = total - out.reduce((a, b) => a + b, 0)
  for (let i = 0; rest > 0; i = (i + 1) % out.length) {
    out[i] += 1
    rest -= 1
  }
  return out
}

export type DemoAdsData = {
  campaign: AdsReport
  adset: AdsReport
  ad: AdsReport
}

export function buildDemoAdsData(fromIso: string, toIso: string): DemoAdsData {
  const days = demoDayKeys(fromIso, toIso)
  const perCampaignDay = new Map<string, DayCell[]>()

  for (const c of DEMO_CAMPAIGNS) {
    const cells: DayCell[] = days.map((day, i) => {
      const rand = makeRng(seedFromString(`${c.id}:${day}`))
      // Ondulation hebdo (creux le week-end) + bruit — rendu « vivant ».
      const weekly = 0.85 + 0.3 * Math.sin(((i % 7) / 7) * Math.PI * 2)
      const spend = c.dailyBudget * weekly * (0.75 + 0.5 * rand())
      const clicks = Math.max(1, Math.round((spend / 0.55) * (0.8 + 0.4 * rand())))
      const impressions = Math.round(clicks / c.ctr)
      const leads = Math.max(0, Math.round((spend / c.cpl) * (0.6 + 0.8 * rand())))
      const devisSignes = rand() < c.signRate * leads ? Math.max(1, Math.round(leads * c.signRate)) : 0
      const ca = devisSignes * Math.round(c.ticket * (0.85 + 0.3 * rand()))
      return { spend: Math.round(spend * 100) / 100, impressions, clicks, leads, devisSignes, ca }
    })
    perCampaignDay.set(c.id, cells)
  }

  // Série quotidienne (tous canaux confondus de la démo).
  const series: AdsSeriesPoint[] = days.map((date, i) => {
    const p: AdsSeriesPoint = { date, spend: 0, impressions: 0, clicks: 0, leads: 0, devisSignes: 0, ca: 0 }
    for (const c of DEMO_CAMPAIGNS) {
      const cell = perCampaignDay.get(c.id)![i]
      p.spend += cell.spend
      p.impressions += cell.impressions
      p.clicks += cell.clicks
      p.leads += cell.leads
      p.devisSignes += cell.devisSignes
      p.ca += cell.ca
    }
    p.spend = Math.round(p.spend * 100) / 100
    return p
  })

  const campaignRows: AdsReportRow[] = []
  const adsetRows: AdsReportRow[] = []
  const adRows: AdsReportRow[] = []

  for (const c of DEMO_CAMPAIGNS) {
    const cells = perCampaignDay.get(c.id)!
    const sum = cells.reduce(
      (a, b) => ({
        spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks,
        leads: a.leads + b.leads, devisSignes: a.devisSignes + b.devisSignes, ca: a.ca + b.ca,
      }),
      { spend: 0, impressions: 0, clicks: 0, leads: 0, devisSignes: 0, ca: 0 },
    )
    campaignRows.push(finalizeRow({
      level: 'campaign', campaignId: c.id, campaign: c.name,
      spend: Math.round(sum.spend * 100) / 100, impressions: sum.impressions, clicks: sum.clicks,
      leads: sum.leads, cpl: 0, devisSignes: sum.devisSignes, ca: sum.ca, roas: 0, tauxSignature: 0, unmatched: null,
    }))

    const adsetShares = c.adsets.map((a) => a.share)
    const leadSplit = splitInt(sum.leads, adsetShares)
    const signesSplit = splitInt(sum.devisSignes, adsetShares)
    c.adsets.forEach((a, ai) => {
      const spend = Math.round(sum.spend * a.share * 100) / 100
      const ca = Math.round(sum.ca * (signesSplit[ai] / Math.max(1, sum.devisSignes)))
      adsetRows.push(finalizeRow({
        level: 'adset', campaignId: c.id, campaign: c.name, adsetId: a.id, adset: a.name,
        spend, impressions: Math.round(sum.impressions * a.share), clicks: Math.round(sum.clicks * a.share),
        leads: leadSplit[ai], cpl: 0, devisSignes: signesSplit[ai], ca, roas: 0, tauxSignature: 0, unmatched: null,
      }))

      const adShares = a.ads.map((x) => x.share)
      const adLeadSplit = splitInt(leadSplit[ai], adShares)
      const adSignesSplit = splitInt(signesSplit[ai], adShares)
      a.ads.forEach((x, xi) => {
        adRows.push(finalizeRow({
          level: 'ad', campaignId: c.id, campaign: c.name, adsetId: a.id, adset: a.name, adId: x.id, ad: x.name,
          spend: Math.round(spend * x.share * 100) / 100,
          impressions: Math.round(sum.impressions * a.share * x.share),
          clicks: Math.round(sum.clicks * a.share * x.share),
          leads: adLeadSplit[xi], cpl: 0,
          devisSignes: adSignesSplit[xi],
          ca: Math.round(ca * (adSignesSplit[xi] / Math.max(1, signesSplit[ai]))),
          roas: 0, tauxSignature: 0, unmatched: null,
        }))
      })
    })
  }

  // Une ligne « prospect sans dépense » pour montrer la section ⚠ non rapproché.
  campaignRows.push(finalizeRow({
    level: 'campaign', campaignId: null, campaign: 'Formulaire site (source mal taguée)',
    spend: 0, impressions: 0, clicks: 0, leads: 6, cpl: 0, devisSignes: 1,
    ca: 8400, roas: 0, tauxSignature: 0, unmatched: null,
  }))

  const totals = campaignRows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend, impressions: acc.impressions + r.impressions, clicks: acc.clicks + r.clicks,
      leads: acc.leads + r.leads, devisSignes: acc.devisSignes + r.devisSignes, ca: acc.ca + r.ca,
      cpl: 0, roas: 0, tauxSignature: 0,
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, devisSignes: 0, ca: 0, cpl: 0, roas: 0, tauxSignature: 0 },
  )
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0
  totals.roas = totals.spend > 0 ? totals.ca / totals.spend : 0
  totals.tauxSignature = totals.leads > 0 ? totals.devisSignes / totals.leads : 0

  return {
    campaign: { rows: campaignRows, totals, series },
    adset: { rows: adsetRows, totals, series },
    ad: { rows: adRows, totals, series },
  }
}

/** Le rapport réel est-il « vide » (rien à afficher → bascule démo possible) ? */
export function isEmptyAdsReport(report: AdsReport | null): boolean {
  if (!report) return true
  const t = report.totals
  return report.rows.length === 0 && (t?.spend ?? 0) === 0 && (t?.leads ?? 0) === 0 && (t?.impressions ?? 0) === 0
}
