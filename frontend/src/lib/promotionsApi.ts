// Accès Convex de l'onglet Promotion. `now` est figé par session
// (useSessionNow) : la liste « en cours » ne boucle pas à chaque rendu.
import { useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { convexClient } from './convex'
import { useSessionNow } from './convexHooks'
import type { ActivePromotion } from './promotions'

export type PromotionStatus = 'a_venir' | 'en_cours' | 'terminee'
export type PromotionRow = ActivePromotion & {
  tag?: string
  legacyStatuses?: string[]
  legacyArrivedFrom?: number
  legacyArrivedTo?: number
  archived: boolean
  webhookKey?: string
  status: PromotionStatus
}
export type PromotionInput = {
  name: string; tag?: string; startDay: string; endDay: string; offer?: string; pitch?: string
  officeCalendarId?: string; officeAddress?: string; legacyStatuses?: string[]
  legacyArrivedFromDay?: string; legacyArrivedToDay?: string
}
export type StatBlock = { leads: number; joints: number; rdvDomicile: number; rdvBureau: number; qualifies: number; signes: number }
export type PromotionStats = { nouveaux: StatBlock; anciens: StatBlock; rdvBureauHorsPromo: number }
export type LegacyPreview = { eligible: number; byStatus: Record<string, number>; skipped: number }

const refs = {
  active: makeFunctionReference<'query', { now: number }, ActivePromotion[]>('promotions:active'),
  list: makeFunctionReference<'query', { now: number }, PromotionRow[]>('promotions:list'),
  stats: makeFunctionReference<'query', { promotionId: string }, PromotionStats>('promotions:stats'),
  previewLegacy: makeFunctionReference<'query', { promotionId: string; now: number }, LegacyPreview>('promotions:previewLegacy'),
  create: makeFunctionReference<'mutation', PromotionInput, string>('promotions:create'),
  update: makeFunctionReference<'mutation', PromotionInput & { id: string }, null>('promotions:update'),
  archive: makeFunctionReference<'mutation', { id: string }, null>('promotions:archive'),
  ensureWebhookKey: makeFunctionReference<'mutation', { id: string }, string>('promotions:ensureWebhookKey'),
  attachLegacy: makeFunctionReference<'action', { promotionId: string }, { scanned: number; attached: number; skipped: number }>('promotions:attachLegacy'),
  backfill: makeFunctionReference<'action', { promotionId: string }, { scanned: number; attached: number }>('promotions:backfill'),
}

/** `undefined` tant que la requête charge (à distinguer de « aucune promo »). */
export function useActivePromotionsState(): ActivePromotion[] | undefined {
  const now = useSessionNow()
  return useQuery(refs.active, { now })
}
const EMPTY_ACTIVE: ActivePromotion[] = []
export function useActivePromotions(): ActivePromotion[] {
  return useActivePromotionsState() ?? EMPTY_ACTIVE
}
export function usePromotionsList(): PromotionRow[] | undefined {
  const now = useSessionNow()
  return useQuery(refs.list, { now })
}
export function usePromotionStats(promotionId: string | null): PromotionStats | undefined {
  return useQuery(refs.stats, promotionId ? { promotionId } : 'skip')
}
export function useLegacyPreview(promotionId: string | null): LegacyPreview | undefined {
  const now = useSessionNow()
  return useQuery(refs.previewLegacy, promotionId ? { promotionId, now } : 'skip')
}

function client() {
  if (!convexClient) throw new Error('Convex non configuré.')
  return convexClient
}
export const createPromotion = (input: PromotionInput) => client().mutation(refs.create, input)
export const updatePromotion = (id: string, input: PromotionInput) => client().mutation(refs.update, { id, ...input })
export const archivePromotion = (id: string) => client().mutation(refs.archive, { id })
export const ensurePromotionWebhook = (id: string) => client().mutation(refs.ensureWebhookKey, { id })
export const attachLegacy = (promotionId: string) => client().action(refs.attachLegacy, { promotionId })
export const backfillPromotion = (promotionId: string) => client().action(refs.backfill, { promotionId })

// Calendriers GHL (admin). L'action renvoie la réponse brute de GHL : { calendars: [{ id, name, ... }] }.
const listCalendarsRef = makeFunctionReference<'action', { groupId?: string }, { calendars?: { id: string; name?: string }[] }>('ghlCalendar:listCalendars')
export async function listGhlCalendars(): Promise<{ id: string; name: string }[]> {
  const raw = await client().action(listCalendarsRef, {})
  return (raw?.calendars ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id }))
}
