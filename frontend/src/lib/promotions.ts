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
