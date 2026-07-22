import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { getFunctionName } from 'convex/server'
import { convexClient } from './convex'
import { analyticsCommercialStats, analyticsDebriefStats, analyticsFunnel, analyticsSetterStats, analyticsSummary, callLogsListBySetter, clientsList, commercialObjectivesListByPeriod, debriefsListByLead, leadsListEnriched, leadsStats, paymentsListAcomptes, rdvList, rdvListByLead, substepsList, usersGet, usersList, usersDirectory, leadsGetEnriched, analyticsSetterLeaderboard } from './convexApi'
import type { ConvexUserDoc, SetterLeaderboardEntry } from './convexApi'
import { mapConvexAcompte, mapConvexCallLog, mapConvexClient, mapConvexCommercialObjective, mapConvexDebrief, mapConvexLead, mapConvexRdv, mapConvexSubstep, mapConvexUser } from './convexMappers'
import { useAuth } from './auth'
import { fetchCache } from './fetchCacheStore'
import { persistEntry } from './cachePersist'
import type {
  AcompteResponse,
  AnalyticsCommercialSummary,
  AnalyticsFunnelResponse,
  AnalyticsSetterSummary,
  AnalyticsSummaryResponse,
  CallLogResponse,
  ClientResponse,
  CommercialObjectiveResponse,
  SubstepResponse,
  DebriefResponse,
  LeadResponse,
  LeadStatus,
  RdvResponse,
  Role,
  UserResponse,
} from './types'

// Adaptateurs Convex des hooks data de la tranche 1. Même contrat de retour
// que useFetch ({ data, loading, error, refetch }) pour que les pages ne
// voient pas la différence. refetch est un no-op : les useQuery Convex sont
// réactifs, la donnée arrive toute seule.

type Async<T> = { data: T | null; loading: boolean; error: string | null; refetch: () => void }
type AsyncProgressive<T> = Async<T> & {
  backgroundLoading: boolean
  loadMore?: () => void
  canLoadMore?: boolean
}

const noop = () => {}
const PAGE_SIZE = 200
// Leads : fenêtre plus petite car chargée à la demande (scroll), pas d'un bloc.
const LEADS_PAGE_SIZE = 100

// ─── Persistance disque des listes (stale-while-revalidate) ──────────────────
// Demande user 2026-07-22 : une fois les prospects/clients chargés, ils doivent
// repeindre instantanément au prochain passage (cache disque via cachePersist /
// fetchCache, hydraté au boot dans main.tsx) puis se mettre à jour tout seuls —
// les useQuery Convex restent la source de vérité et réécrivent le cache au fil
// du travail. Le cache est par utilisateur PERÇU (viewAs compris) et vidé au
// logout (clearFetchCache). Pas de cache pour les recherches (résultats volatils).
const LEADS_CACHE_MAX_ROWS = 1500

function leadsCacheKey(userId: string | undefined, filters: {
  status?: LeadStatus; setterId?: string; assignedToId?: string; city?: string; scope?: 'clients'
}): string {
  return `convex:leads:${userId ?? 'anon'}:${JSON.stringify({
    status: filters.status ?? null,
    setterId: filters.setterId ?? null,
    assignedToId: filters.assignedToId ?? null,
    city: filters.city ?? null,
    scope: filters.scope ?? null,
  })}`
}

export function useConvexLeads(filters?: {
  status?: LeadStatus
  setterId?: string
  city?: string
  // acceptés pour compat de signature REST, sans effet côté Convex (tranche 1)
  assignedToId?: string
  search?: string
  limit?: number
  offset?: number
  quickLimit?: number
  fullLimit?: number
  notInAirtable?: boolean
  scope?: 'clients'
} | null): AsyncProgressive<LeadResponse[]> {
  // status/setterId/assignedToId/city/search sont exécutés CÔTÉ SERVEUR (index +
  // searchIndex Convex). Changer un de ces args réinitialise la pagination du curseur.
  const search = filters?.search?.trim()
  // Liste ENRICHIE : chaque lead arrive avec ses agrégats (callsToday, joursRelance,
  // dernier RDV…) — les jauges appels 4/jour et 11 jours en dépendent. `now` stable
  // (bucket 5 min) sinon chaque rendu relancerait la query.
  const now = useStableNow()
  const args = filters === null
    ? ('skip' as const)
    : {
        status: filters?.status,
        setterId: filters?.setterId,
        assignedToId: filters?.assignedToId,
        city: filters?.city,
        search: search ? search : undefined,
        // Page client : population « chemin positif » filtrée côté serveur
        // (leads:listEnriched scope=clients) — sans lui, la page recevait la
        // fenêtre des leads récents toute population confondue.
        scope: filters?.scope,
        now,
      }
  const { results, status, loadMore } = usePaginatedQuery(leadsListEnriched, args, { initialNumItems: LEADS_PAGE_SIZE })

  // Chargement fenêtré : on NE déroule PAS toute la pagination (10k–50k leads
  // saturent la RAM et crashent l'onglet). On expose loadMore/canLoadMore et la
  // liste virtualisée déclenche la fenêtre suivante quand on approche du bas.
  const canLoadMore = status === 'CanLoadMore'
  const doLoadMore = useCallback(() => {
    if (status === 'CanLoadMore') loadMore(LEADS_PAGE_SIZE)
  }, [status, loadMore])

  const data = useMemo(() => results.map(mapConvexLead), [results])

  // Cache disque : sert la liste de la dernière session pendant le chargement,
  // puis la donnée live prend le relais et réécrit le cache en continu.
  const userId = useAuth((s) => s.user?.id)
  const cacheKey = filters === null || search ? null : leadsCacheKey(userId, filters)
  const cached = useMemo(
    () => (cacheKey ? ((fetchCache.get(cacheKey)?.data as LeadResponse[] | undefined) ?? null) : null),
    [cacheKey],
  )
  const liveReady = status !== 'LoadingFirstPage'
  // Page « scope=clients » : elle déroule toute la pagination — on garde le
  // cache complet à l'écran tant que le drain live n'a pas rattrapé, pour
  // éviter que la liste rétrécisse puis regrossisse à chaque visite. Les pages
  // fenêtrées (leads) basculent sur le live dès la première page (sinon une
  // suppression côté serveur laisserait la liste figée sur le cache).
  const keepCacheDuringDrain = filters?.scope === 'clients'
  const showLive = liveReady && (!keepCacheDuringDrain || !canLoadMore || !cached || data.length >= cached.length)
  useEffect(() => {
    if (!cacheKey || !liveReady || data.length === 0) return
    const maxRows = filters?.scope === 'clients' ? LEADS_CACHE_MAX_ROWS : LEADS_PAGE_SIZE
    const entry = { data: data.slice(0, maxRows), timestamp: Date.now() }
    fetchCache.set(cacheKey, entry)
    persistEntry(cacheKey, entry)
  }, [cacheKey, data, liveReady, filters?.scope])

  return {
    data: filters === null ? null : showLive ? data : cached,
    loading: status === 'LoadingFirstPage' && filters !== null && !cached,
    // backgroundLoading = fenêtre suivante en cours, ou premier chargement
    // pendant qu'on affiche le cache de la session précédente.
    backgroundLoading: status === 'LoadingMore' || (!showLive && filters !== null),
    canLoadMore,
    loadMore: doLoadMore,
    error: null,
    refetch: noop,
  }
}

// Compteurs des stat cards : servis par la query agrégée leads:stats (comptes
// exacts sur toute la base), et non par le comptage des leads chargés — qui, en
// mode fenêtré, ne verrait que la fenêtre courante.
export function useConvexLeadStats(): Async<import('./types').LeadStatsResponse> {
  // Ponctuel (pas d'abonnement) : la query full-scan les leads et ses args fixes
  // en faisaient LE plus gros consommateur réactif — chaque appel loggé patche
  // un lead et ré-exécutait le scan pour chaque client. TTL = bucket 5 min.
  const now = useStableNow()
  // Minuit local : le serveur en déduit le compteur global « arrivés aujourd'hui ».
  const todayStart = new Date(now).setHours(0, 0, 0, 0)
  const res = useOneShotQuery(leadsStats, { todayStart }, String(now))
  const data = useMemo(
    () => (res ? (res as unknown as import('./types').LeadStatsResponse) : null),
    [res],
  )
  return { data, loading: res === undefined, error: null, refetch: noop }
}

export function useConvexRdvList(filters?: {
  leadId?: string
  commercialId?: string
  setterId?: string
  fromDate?: string
  toDate?: string
  limit?: number
} | null): Async<RdvResponse[]> {
  const leadId = filters === null ? undefined : filters?.leadId

  // Avec un leadId : query ciblée rdv:listByLead (index by_lead) — un lead n'a
  // que quelques RDV. Sans leadId : liste paginée classique. Avant, le cas
  // leadId paginait TOUTE la table rdv puis filtrait côté client.
  const byLead = useQuery(rdvListByLead, leadId ? { leadId } : 'skip')

  const args = filters === null || leadId
    ? ('skip' as const)
    : {
        commercialId: filters?.commercialId,
        from: filters?.fromDate ? Date.parse(filters.fromDate) : undefined,
        to: filters?.toDate ? Date.parse(filters.toDate) : undefined,
      }
  const { results, status, loadMore } = usePaginatedQuery(rdvList, args, { initialNumItems: PAGE_SIZE })
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(PAGE_SIZE)
  }, [status, loadMore])

  const data = useMemo(() => {
    if (leadId) return (byLead ?? []).map(mapConvexRdv)
    return results.map(mapConvexRdv)
  }, [results, leadId, byLead])

  return {
    data: filters === null ? null : data,
    loading: filters !== null && (leadId ? byLead === undefined : status === 'LoadingFirstPage'),
    error: null,
    refetch: noop,
  }
}

export function useConvexLead(id: string | undefined): Async<LeadResponse> {
  // Variante enrichie : la fiche détail a besoin d'assignedSetterIds (setters
  // dérivés des appels — les leads GHL natifs n'ont pas de setterId principal).
  const now = useStableNow()
  const res = useQuery(leadsGetEnriched, id ? { leadId: id, now } : 'skip')
  const data = useMemo(() => (res ? mapConvexLead(res) : (res === null ? null : null)), [res])
  return { data, loading: !!id && res === undefined, error: null, refetch: noop }
}

export function useConvexLeadDebriefs(leadId?: string | null): Async<DebriefResponse[]> {
  const rows = useQuery(debriefsListByLead, leadId ? { leadId } : 'skip')
  const data = useMemo(() => (rows ? rows.map(mapConvexDebrief) : null), [rows])
  return { data, loading: !!leadId && rows === undefined, error: null, refetch: noop }
}

// ─── Analytics ──────────────────────────────────────────────
// `now` doit être STABLE entre les rendus : le passer via Date.now() à chaque
// render ferait boucler le useQuery (args différents → refetch en boucle). On
// le fige au montage, bucketé à 5 min (le serveur ne s'en sert que pour la
// troncature "live" et le fallback de plage).
function useStableNow(): number {
  return useMemo(() => Math.floor(Date.now() / 300_000) * 300_000, [])
}

// Stale-while-revalidate : quand les args d'un useQuery changent (ex. nouvelle
// période), Convex renvoie `undefined` le temps de recharger. On conserve la
// dernière valeur connue pour que l'UI affiche les anciens chiffres pendant ce
// laps (~1-2 s) au lieu de tout remettre à zéro, puis bascule d'un coup sur les
// nouveaux. Pattern React officiel « ajuster l'état pendant le rendu » (guardé)
// → pas d'effet ni de ref lus au rendu.
function lsRead<T>(key: string | null): T | undefined {
  if (!key || typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

// Stale-while-revalidate persistant : hydrate la valeur initiale depuis
// localStorage et l'y persiste. Au 1er rendu (onglet ouvert / refresh), Convex renvoie `undefined`
// le temps de se connecter + s'authentifier + répondre (~2-3 s cold) : on affiche
// alors INSTANTANÉMENT les derniers chiffres mémorisés (0 s d'attente perçue),
// puis on bascule sur la valeur fraîche dès qu'elle arrive. La clé exclut `now`
// (bucketé 5 min) pour survivre aux revalidations, et inclut l'utilisateur pour
// ne pas fuiter des chiffres entre comptes sur un navigateur partagé.
function usePersistentSticky<T>(key: string | null, value: T | undefined): T | undefined {
  const [held, setHeld] = useState<{ k: string | null; v: T | undefined }>(() => ({ k: key, v: lsRead<T>(key) }))
  let current = held
  if (key !== held.k) {
    // Période/utilisateur changé → réhydrate depuis le cache de la nouvelle clé.
    current = { k: key, v: lsRead<T>(key) }
    setHeld(current)
  } else if (value !== undefined && !Object.is(value, held.v)) {
    current = { k: key, v: value }
    setHeld(current)
  }
  useEffect(() => {
    if (!key || value === undefined || typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota / mode privé : le cache mémoire prend le relais */
    }
  }, [key, value])
  return value === undefined ? current.v : value
}

// ─── Requête PONCTUELLE (sans abonnement réactif) ───────────
// Un useQuery maintient un abonnement : CHAQUE écriture touchant les tables
// lues (appel loggé → patch du lead, changement de statut…) fait ré-exécuter
// la query côté serveur, pour chaque client connecté. Or les queries de stats
// scannent des tables entières : c'était le principal poste de bande passante
// du plan Convex. Les stats n'ont pas besoin d'être live → une requête
// ponctuelle par jeu d'arguments suffit ; le `now` bucketé 5 min (useStableNow)
// présent dans les args (ou passé en cacheSalt) sert de TTL de rafraîchissement.
const oneShotCache = new Map<string, Promise<unknown> | { value: unknown }>()

/** Vide le cache des requêtes ponctuelles (tests uniquement). */
export function __clearOneShotCacheForTests(): void {
  oneShotCache.clear()
}

function useOneShotQuery<T>(
  ref: Parameters<NonNullable<typeof convexClient>['query']>[0],
  args: Record<string, unknown> | 'skip',
  cacheSalt = '',
): T | undefined {
  const key = args === 'skip' ? null : `${getFunctionName(ref)}:${cacheSalt}:${JSON.stringify(args)}`
  const [held, setHeld] = useState<{ k: string; v: unknown } | null>(null)
  useEffect(() => {
    if (key === null || !convexClient || args === 'skip') return
    const cached = oneShotCache.get(key)
    if (cached && !(cached instanceof Promise)) {
      setHeld({ k: key, v: cached.value })
      return
    }
    // Les clés embarquent le bucket 5 min → elles expirent d'elles-mêmes ;
    // purge grossière pour éviter une croissance sans fin sur session longue.
    if (oneShotCache.size > 300) oneShotCache.clear()
    let cancelled = false
    const promise = cached instanceof Promise ? cached : convexClient.query(ref as never, args as never)
    if (!(cached instanceof Promise)) oneShotCache.set(key, promise)
    promise
      .then((v) => {
        oneShotCache.set(key, { value: v })
        if (!cancelled) setHeld({ k: key, v })
      })
      .catch((e) => {
        oneShotCache.delete(key)
        console.warn('Requête stats Convex échouée', e)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key résume ref+args
  }, [key])
  return held && held.k === key ? (held.v as T) : undefined
}

// Rôles autorisés côté serveur (analytics.ts). Une query Convex lancée par un
// rôle non autorisé THROW au rendu (→ crash/remount). On skip donc la query
// pour ces rôles et on renvoie null, comme un 403 REST capté silencieusement.
const SUMMARY_ROLES = new Set<Role>(['admin', 'setter', 'setter_lead', 'commercial', 'commercial_lead', 'finances'])
const FUNNEL_ROLES = new Set<Role>(['admin', 'commercial_lead'])
const DEBRIEF_ROLES = new Set<Role>(['admin', 'commercial', 'commercial_lead'])

type DebriefStats = {
  outcomeCounts: { vente: number; non_vente: number; en_reflexion: number; suivi_prevu: number }
  acceptanceFactorCounts: Record<string, number>
  nonSaleReasonCounts: Record<string, number>
  total: number
}

export function useConvexAnalyticsSummary(filters?: {
  days?: number
  from?: string
  to?: string
}): Async<AnalyticsSummaryResponse> {
  const now = useStableNow()
  const role = useAuth((s) => s.user?.role)
  const uid = useAuth((s) => s.user?.id)
  const allowed = !!role && SUMMARY_ROLES.has(role)
  const res = useOneShotQuery(
    analyticsSummary,
    allowed ? { now, days: filters?.days, from: filters?.from, to: filters?.to } : 'skip',
  )
  // Cache persistant (localStorage) : au cold load on affiche les derniers
  // chiffres connus instantanément, puis Convex revalide. Clé sans `now`.
  const key = allowed ? `kpi:summary:${uid ?? '?'}:${filters?.days ?? ''}:${filters?.from ?? ''}:${filters?.to ?? ''}` : null
  const sticky = usePersistentSticky(key, res)
  return {
    data: allowed ? ((sticky ?? null) as AnalyticsSummaryResponse | null) : null,
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

export function useConvexAnalyticsFunnel(filters?: {
  days?: number
  from?: string
  to?: string
  setterId?: string
  sector?: string
}): Async<AnalyticsFunnelResponse> {
  const now = useStableNow()
  const role = useAuth((s) => s.user?.role)
  const uid = useAuth((s) => s.user?.id)
  const allowed = !!role && FUNNEL_ROLES.has(role)
  const res = useOneShotQuery(
    analyticsFunnel,
    allowed
      ? { now, days: filters?.days, from: filters?.from, to: filters?.to, setterId: filters?.setterId, sector: filters?.sector }
      : 'skip',
  )
  const key = allowed
    ? `kpi:funnel:${uid ?? '?'}:${filters?.days ?? ''}:${filters?.from ?? ''}:${filters?.to ?? ''}:${filters?.setterId ?? ''}:${filters?.sector ?? ''}`
    : null
  const sticky = usePersistentSticky(key, res)
  return {
    data: allowed ? ((sticky ?? null) as AnalyticsFunnelResponse | null) : null,
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

export function useConvexDebriefAnalytics(filters?: {
  from?: string
  to?: string
  commercialId?: string
}): Async<DebriefStats> {
  const role = useAuth((s) => s.user?.role)
  const uid = useAuth((s) => s.user?.id)
  const allowed = !!role && DEBRIEF_ROLES.has(role)
  const res = useOneShotQuery(
    analyticsDebriefStats,
    allowed ? { from: filters?.from, to: filters?.to, commercialId: filters?.commercialId } : 'skip',
  )
  const key = allowed
    ? `kpi:debrief:${uid ?? '?'}:${filters?.from ?? ''}:${filters?.to ?? ''}:${filters?.commercialId ?? ''}`
    : null
  const sticky = usePersistentSticky(key, res)
  return {
    data: allowed ? ((sticky ?? null) as DebriefStats | null) : null,
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

// Rôles alignés sur analytics.ts (SETTER_STATS_ROLES / COMMERCIAL_STATS_ROLES).
const SETTER_STATS_ROLES = new Set<Role>(['admin', 'setter', 'setter_lead', 'commercial', 'commercial_lead'])
const COMMERCIAL_STATS_ROLES = new Set<Role>(['admin', 'commercial', 'commercial_lead'])

// Classement minimal des setters (carte Overview) : appels + qualifiés du jour
// par défaut. Même pattern one-shot + sticky que les autres stats.
export function useConvexSetterLeaderboard(
  filters?: { from?: string; to?: string; days?: number },
): Async<SetterLeaderboardEntry[]> {
  const now = useStableNow()
  const role = useAuth((s) => s.user?.role)
  const uid = useAuth((s) => s.user?.id)
  const allowed = !!role && SETTER_STATS_ROLES.has(role)
  const res = useOneShotQuery(
    analyticsSetterLeaderboard,
    allowed ? { now, days: filters?.days, from: filters?.from, to: filters?.to } : 'skip',
  )
  const key = allowed
    ? `kpi:setterboard:${uid ?? '?'}:${filters?.days ?? ''}:${filters?.from ?? ''}:${filters?.to ?? ''}`
    : null
  const sticky = usePersistentSticky(key, res)
  return {
    data: allowed ? ((sticky ?? null) as SetterLeaderboardEntry[] | null) : [],
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

export function useConvexSetterStats(
  id: string | undefined,
  filters?: { from?: string; to?: string; days?: number },
): Async<AnalyticsSetterSummary> {
  const now = useStableNow()
  const role = useAuth((s) => s.user?.role)
  const uid = useAuth((s) => s.user?.id)
  const allowed = !!id && !!role && SETTER_STATS_ROLES.has(role)
  const res = useOneShotQuery(
    analyticsSetterStats,
    allowed ? { setterId: id, now, days: filters?.days, from: filters?.from, to: filters?.to } : 'skip',
  )
  const key = allowed
    ? `kpi:setter:${uid ?? '?'}:${id}:${filters?.days ?? ''}:${filters?.from ?? ''}:${filters?.to ?? ''}`
    : null
  const sticky = usePersistentSticky(key, res)
  return {
    data: allowed ? ((sticky ?? null) as AnalyticsSetterSummary | null) : null,
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

export function useConvexCommercialAnalytics(
  id: string | undefined,
  filters?: { from?: string; to?: string; days?: number },
): Async<AnalyticsCommercialSummary> {
  const now = useStableNow()
  const role = useAuth((s) => s.user?.role)
  const uid = useAuth((s) => s.user?.id)
  const allowed = !!id && !!role && COMMERCIAL_STATS_ROLES.has(role)
  const res = useOneShotQuery(
    analyticsCommercialStats,
    allowed ? { commercialId: id, now, days: filters?.days, from: filters?.from, to: filters?.to } : 'skip',
  )
  const key = allowed
    ? `kpi:commercial:${uid ?? '?'}:${id}:${filters?.days ?? ''}:${filters?.from ?? ''}:${filters?.to ?? ''}`
    : null
  const sticky = usePersistentSticky(key, res)
  return {
    data: allowed ? ((sticky ?? null) as AnalyticsCommercialSummary | null) : null,
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

export function useConvexCallLogs(filters?: {
  leadId?: string; setterId?: string; limit?: number; offset?: number
} | null): Async<CallLogResponse[]> {
  // Overview : feed d'appels d'un setter. Sans setterId → vide (pas de list globale).
  const setterId = filters === null ? undefined : filters?.setterId
  const filtersIsNull = filters === null
  const limit = filters === null ? undefined : filters?.limit
  const rows = useQuery(callLogsListBySetter, setterId ? { setterId, limit } : 'skip')
  const data = useMemo(() => {
    if (!setterId) return filtersIsNull ? null : []
    if (rows === undefined) return null
    return rows.map(mapConvexCallLog)
  }, [setterId, rows, filtersIsNull])
  return { data, loading: !!setterId && rows === undefined, error: null, refetch: noop }
}

// commercialObjectives.listByPeriod exige admin/commercial_lead → skip sinon.
const OBJECTIVES_ROLES = new Set<Role>(['admin', 'commercial_lead'])

export function useConvexCommercialObjectives(period: string | null): Async<CommercialObjectiveResponse[]> {
  const role = useAuth((s) => s.user?.role)
  const allowed = !!period && !!role && OBJECTIVES_ROLES.has(role)
  const rows = useQuery(commercialObjectivesListByPeriod, allowed ? { period: period! } : 'skip')
  const data = useMemo(() => {
    if (!allowed) return period ? [] : null
    if (rows === undefined) return null
    return rows.map(mapConvexCommercialObjective)
  }, [allowed, rows, period])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}

// workflowSubsteps.list exige un rôle « vue workflow » → skip (vide) sinon crash.
const WORKFLOW_VIEW_ROLES = new Set<Role>([
  'admin', 'delivrabilite', 'responsable_technique', 'back_office',
  'technicien', 'finances', 'commercial', 'commercial_lead',
])

export function useConvexSubsteps(filters?: { clientId?: string } | null): Async<SubstepResponse[]> {
  const role = useAuth((s) => s.user?.role)
  const clientId = filters === null ? undefined : filters?.clientId
  const filtersIsNull = filters === null
  const allowed = !filtersIsNull && !!clientId && !!role && WORKFLOW_VIEW_ROLES.has(role)
  const rows = useQuery(substepsList, allowed ? { clientId } : 'skip')
  // Deps primitives uniquement : `filters` est un objet littéral recréé à chaque
  // render côté appelant ({ clientId }), donc l'inclure ferait recalculer `data`
  // (nouvelle référence) en boucle → setLocalSubsteps en boucle → React #185.
  const data = useMemo(() => {
    if (!allowed) return filtersIsNull || !clientId ? null : []
    if (rows === undefined) return null
    return rows.map(mapConvexSubstep)
  }, [allowed, rows, filtersIsNull, clientId])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}

// payments.listAcomptes exige un rôle finances côté serveur → skip (liste vide)
// pour les autres rôles, sinon la query throw au rendu.
const FINANCES_ROLES = new Set<Role>(['admin', 'finances', 'delivrabilite', 'responsable_technique', 'back_office'])

export function useConvexAcomptes(enabled = true): Async<AcompteResponse[]> {
  const role = useAuth((s) => s.user?.role)
  const allowed = enabled && !!role && FINANCES_ROLES.has(role)
  // today figé au jour (bucket 24 h) pour éviter des refetch inutiles.
  const today = useMemo(() => new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString().slice(0, 10), [])
  const rows = useQuery(paymentsListAcomptes, allowed ? { today } : 'skip')
  const data = useMemo(() => {
    if (!allowed) return enabled ? [] : []
    if (rows === undefined) return null
    return rows.map(mapConvexAcompte)
  }, [allowed, rows, enabled])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}

// Hooks sans équivalent Convex (tranche 1) : renvoient vide au lieu de taper le
// NestJS de prod (401 + latence). À câbler quand le domaine sera porté.
export function useConvexEmptyList<T>(): Async<T[]> {
  return { data: [], loading: false, error: null, refetch: noop }
}

// clients.list exige un rôle « vue workflow » côté serveur (admin, délivrabilité,
// resp. technique, back-office, technicien, finances, commerciaux). Hors de ce
// périmètre → skip (sinon la query throw) et liste vide.
const CLIENTS_VIEW_ROLES = new Set<Role>([
  'admin', 'delivrabilite', 'responsable_technique', 'back_office',
  'technicien', 'finances', 'commercial', 'commercial_lead',
])

export function useConvexClients(filters?: {
  technicienVtId?: string
  phase?: string
  leadId?: string
  projectId?: string
  unassignedVt?: boolean
} | null): Async<ClientResponse[]> {
  const role = useAuth((s) => s.user?.role)
  const filtersIsNull = filters === null
  const allowed = !filtersIsNull && !!role && CLIENTS_VIEW_ROLES.has(role)
  const rows = useQuery(
    clientsList,
    allowed
      ? {
          leadId: filters?.leadId,
          projectId: filters?.projectId,
          phase: filters?.phase,
          technicienVtId: filters?.technicienVtId,
          unassignedVt: filters?.unassignedVt,
        }
      : 'skip',
  )
  // filtersIsNull (primitive) plutôt que `filters` (objet recréé à chaque render
  // par l'appelant) : évite de recalculer `data` en boucle (cf. useConvexSubsteps).
  const data = useMemo(() => {
    if (!allowed) return filtersIsNull ? null : []
    if (rows === undefined) return null
    return rows.map(mapConvexClient)
  }, [allowed, rows, filtersIsNull])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}

// Profil d'un membre par id — users:get Convex (la variante REST /users/:id
// pointait sur NestJS/Render, qui ne connaît pas les ids Convex → « introuvable »).
export function useConvexUser(id: string | undefined): Async<UserResponse> {
  const res = useQuery(usersGet, id ? { userId: id } : 'skip')
  const data = useMemo(() => (res ? mapConvexUser(res) : null), [res])
  return { data, loading: !!id && res === undefined, error: null, refetch: noop }
}

const USERS_LIST_ROLES = new Set(['admin', 'setter_lead', 'commercial_lead'])

export function useConvexUsers(): Async<UserResponse[]> {
  // users:list (fiche complète) exige un rôle lead/admin côté serveur — les
  // autres rôles chargent l'annuaire minimal users:directory (id, nom, rôle)
  // pour que les noms setter/commercial restent résolus (appels, fiches, suivi).
  const role = useAuth((s) => s.realUser?.role)
  const known = role !== undefined && role !== null
  const allowed = known && USERS_LIST_ROLES.has(role)
  const rows = useQuery(usersList, allowed ? {} : 'skip')
  const dirRows = useQuery(usersDirectory, known && !allowed ? {} : 'skip')
  const data = useMemo(() => {
    if (!known) return []
    if (allowed) return rows === undefined ? null : rows.map(mapConvexUser)
    return dirRows === undefined ? null : dirRows.map((u) => mapConvexUser(u as ConvexUserDoc))
  }, [known, allowed, rows, dirRows])
  const loading = known && (allowed ? rows === undefined : dirRows === undefined)
  return { data, loading, error: null, refetch: noop }
}
