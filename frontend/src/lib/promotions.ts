// Helpers purs de l'onglet Promotion : exclusion des leads d'une promo en
// cours des onglets habituels, filtre nouveaux/anciens, libellés de dates
// (heure de la Réunion, quel que soit le fuseau du navigateur).

export type ActivePromotion = {
  _id: string
  name: string
  startAt: number
  endAt: number
  offer?: string
  pitch?: string
  officeCalendarId?: string
  officeAddress?: string
}

type PromoLead = { promotionId?: string | null; promotionSource?: 'tag' | 'statut' | null }

export function activePromotionIds(promos: ActivePromotion[]): Set<string> {
  return new Set(promos.map((p) => p._id))
}

export function isInActivePromotion(lead: PromoLead, ids: Set<string>): boolean {
  return Boolean(lead.promotionId && ids.has(lead.promotionId))
}

export function withoutActivePromotionLeads<T extends PromoLead>(leads: T[], ids: Set<string>): T[] {
  if (ids.size === 0) return leads
  return leads.filter((l) => !isInActivePromotion(l, ids))
}

/** Retire de la sélection les ids qui ne sont plus dans `leads` ; renvoie la MÊME référence si rien ne change (évite une boucle de rendu). */
export function pruneSelectedIds(current: string[], leads: { id: string }[]): string[] {
  const existing = new Set(leads.map((l) => l.id))
  const next = current.filter((id) => existing.has(id))
  return next.length === current.length ? current : next
}

export function promotionLeads<T extends PromoLead>(leads: T[], promotionId: string, source: 'all' | 'tag' | 'statut'): T[] {
  return leads.filter((l) => l.promotionId === promotionId && (source === 'all' || l.promotionSource === source))
}

/** Leads de TOUTES les promos en cours, filtrés par source (onglet Promotion). */
export function activePromotionLeads<T extends PromoLead>(leads: T[], ids: Set<string>, source: 'all' | 'tag' | 'statut'): T[] {
  return leads.filter((l) => isInActivePromotion(l, ids) && (source === 'all' || l.promotionSource === source))
}

export function officePromotion(promos: ActivePromotion[]): ActivePromotion | undefined {
  return promos.find((p) => Boolean(p.officeCalendarId))
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const REUNION_OFFSET_MS = 4 * 3_600_000

function reunionParts(ms: number) {
  const d = new Date(ms + REUNION_OFFSET_MS)
  return { day: d.getUTCDate(), month: d.getUTCMonth() }
}

export function formatPromotionRange(startAt: number, endAt: number): string {
  const a = reunionParts(startAt)
  const b = reunionParts(endAt)
  return a.month === b.month
    ? `du ${a.day} au ${b.day} ${MONTHS[b.month]}`
    : `du ${a.day} ${MONTHS[a.month]} au ${b.day} ${MONTHS[b.month]}`
}

/** ms → "YYYY-MM-DD" du jour Réunion (pré-remplissage du formulaire). */
export function reunionDayInput(ms: number): string {
  return new Date(ms + REUNION_OFFSET_MS).toISOString().slice(0, 10)
}

/** URL du lien webhook d'une promo, à coller dans une action Webhook GHL. */
export function promotionWebhookUrl(convexUrl: string | undefined, key: string | undefined): string | null {
  if (!convexUrl || !key) return null
  const site = convexUrl.replace(/\/+$/, '').replace(/\.convex\.cloud$/, '.convex.site')
  return `${site}/webhooks/ghl/promotion/${key}`
}

/**
 * Jours de RDV au bureau proposés au setter : vendredis et samedis (heure de
 * la Réunion) entre aujourd'hui et la fin de la promo. Vide quand la promo est
 * finie : le calendrier bureau n'est plus proposé.
 */
export function bureauDays(startAt: number, endAt: number, now: number): string[] {
  const days: string[] = []
  const DAY = 86_400_000
  const first = Math.max(startAt, now)
  // Minuit Réunion du premier jour.
  let t = Math.floor((first + REUNION_OFFSET_MS) / DAY) * DAY - REUNION_OFFSET_MS
  for (; t <= endAt && days.length < 60; t += DAY) {
    const d = new Date(t + REUNION_OFFSET_MS)
    const wd = d.getUTCDay()
    if (wd === 5 || wd === 6) days.push(d.toISOString().slice(0, 10))
  }
  return days
}

const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
/** "2026-11-27" → "ven. 27 nov." */
export function formatBureauDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export type LeadKpis = { total: number; directGhl: number; qualifies: number; perdus: number }
/** Chiffres d'en-tête calculés sur une liste de leads (ex. leads d'une promo). */
export function leadKpis(leads: { status: string; source?: string }[]): LeadKpis {
  return {
    total: leads.length,
    directGhl: leads.filter((l) => l.source === 'ghl').length,
    qualifies: leads.filter((l) => ['qualifie', 'rdv_pris', 'rdv_honore', 'signe'].includes(l.status)).length,
    perdus: leads.filter((l) => l.status === 'perdu' || l.status === 'pas_qualifie').length,
  }
}
