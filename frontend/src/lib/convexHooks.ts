import { useCallback, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { getFunctionName } from 'convex/server'
import { convexClient } from './convex'
import { adsReport, adBudget, adDepositsList, type ConvexAdBudget, type ConvexAdDeposit, simulatorFunnel, type ConvexSimulatorFunnel, analyticsCommercialStats, analyticsDebriefStats, analyticsFunnel, analyticsSetterStats, analyticsSummary, callLogsListBySetter, callLogsListByLead, clientsList, commercialObjectivesListByPeriod, debriefsListByLead, leadsListEnriched, leadsStats, paymentsListAcomptes, rdvList, rdvListByLead, rdvListWindow, substepsList, usersGet, usersList, usersDirectory, leadsGetEnriched, analyticsSetterLeaderboard } from './convexApi'
import type { ConvexUserDoc, SetterLeaderboardEntry, ConvexActivityDoc } from './convexApi'
import { activityLogForLead, activityLogList, activityLogMyScope, ghlContactNotesListByLead, type ActivityListArgs, type ActivityDomain, type ConvexGhlNotesResult } from './convexApi'
import { mapConvexAcompte, mapConvexCallLog, mapConvexClient, mapConvexCommercialObjective, mapConvexDebrief, mapConvexLead, mapConvexRdv, mapConvexSubstep, mapConvexUser } from './convexMappers'
import { useAuth } from './auth'
import { fetchCache } from './fetchCacheStore'
import { persistEntry } from './cachePersist'
import type {
  AcompteResponse,
  AdChannel,
  AdsLevel,
  AdsReport,
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
// Taille des pages réactives : chaque écriture sur un doc d'une page ré-exécute
// TOUTE la page côté serveur, pour chaque client abonné (bande passante DB
// facturée) → pages courtes = ré-exécutions bon marché. Le drain reste complet.
const PAGE_SIZE = 100
// Leads : première page PETITE pour peindre l'écran vite (l'enrichissement
// serveur — appels/RDV/devis par lead — domine la latence), puis le drain
// enchaîne automatiquement des pages plus grosses jusqu'au bout (demande user
// 2026-07-22 : « je ne veux pas que les prospects soient bloqués à 100 » — les
// compteurs et filtres du rail portent sur la liste chargée, donc elle doit
// être complète). Garde-fou LEADS_DRAIN_MAX : au-delà, on s'arrête (une base
// de dizaines de milliers de leads saturerait la RAM de l'onglet).
const LEADS_FIRST_PAGE = 100
const LEADS_DRAIN_PAGE = 100
const LEADS_DRAIN_MAX = 5000

// ─── Persistance disque des listes (stale-while-revalidate) ──────────────────
// Demande user 2026-07-22 : une fois les prospects/clients chargés, ils doivent
// repeindre instantanément au prochain passage (cache disque via cachePersist /
// fetchCache, hydraté au boot dans main.tsx) puis se mettre à jour tout seuls —
// les useQuery Convex restent la source de vérité et réécrivent le cache au fil
// du travail. Le cache est par utilisateur PERÇU (viewAs compris) et vidé au
// logout (clearFetchCache). Pas de cache pour les recherches (résultats volatils).
const LEADS_CACHE_MAX_ROWS = 5000

// ─── `now` de session (listes réactives) ─────────────────────────────────────
// useStableNow (bucket 5 min mémoïsé PAR MONTAGE) sert de TTL aux one-shots
// analytics — mais pour les listes réactives paginées, un `now` qui change au
// remontage change les args de TOUTES les pages : chaque navigation pouvait
// ré-exécuter le drain complet côté serveur. Ce `now`-ci vit au niveau module :
// stable toute la session, rollover au changement de jour Réunion (les champs
// dérivés — callsToday, joursSansContact — sont à granularité jour).
const REUNION_OFFSET_MS = 4 * 60 * 60 * 1000
const reunionDayIndex = (ms: number) => Math.floor((ms + REUNION_OFFSET_MS) / 86_400_000)
const sessionNowStore = create<{ now: number }>(() => ({ now: Math.floor(Date.now() / 300_000) * 300_000 }))
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    const { now } = sessionNowStore.getState()
    if (reunionDayIndex(Date.now()) !== reunionDayIndex(now)) {
      sessionNowStore.setState({ now: Math.floor(Date.now() / 300_000) * 300_000 })
    }
  }, 60_000)
}
export function useSessionNow(): number {
  return sessionNowStore((s) => s.now)
}

// Fenêtre RDV des notifications (RootLayout, Topbar, page Notifications) :
// les règles regardent au plus 7 j en arrière (signalements accueil), les
// « débriefs à faire » récents et les RDV imminents → −90 j / +30 j couvre
// tout, contre un drain complet de la table rdv par composant auparavant.
// Bornes dérivées du `now` de session (stable, rollover quotidien) → args
// stables → une seule souscription partagée par le client Convex.
const NOTIF_RDV_PAST_MS = 90 * 86_400_000
const NOTIF_RDV_FUTURE_MS = 30 * 86_400_000
export function useNotificationRdvFilters(commercialId?: string): {
  commercialId?: string; fromDate: string; toDate: string; limit: number
} {
  const now = useSessionNow()
  return useMemo(() => ({
    ...(commercialId ? { commercialId } : {}),
    fromDate: new Date(now - NOTIF_RDV_PAST_MS).toISOString(),
    toDate: new Date(now + NOTIF_RDV_FUTURE_MS).toISOString(),
    limit: 200,
  }), [commercialId, now])
}

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
  // dernier RDV…) — les jauges appels 4/jour et 11 jours en dépendent. `now` de
  // session (stable au niveau module) sinon chaque remontage relancerait le drain.
  const now = useSessionNow()
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
  const { results, status, loadMore } = usePaginatedQuery(leadsListEnriched, args, { initialNumItems: LEADS_FIRST_PAGE })

  const canLoadMore = status === 'CanLoadMore'
  const doLoadMore = useCallback(() => {
    if (status === 'CanLoadMore') loadMore(LEADS_DRAIN_PAGE)
  }, [status, loadMore])
  // Drain automatique : la pagination se déroule toute seule jusqu'au bout
  // (ou jusqu'au garde-fou), page après page — la liste, les compteurs et les
  // filtres voient TOUTE la population, pas une fenêtre de 100.
  useEffect(() => {
    if (status === 'CanLoadMore' && results.length < LEADS_DRAIN_MAX) loadMore(LEADS_DRAIN_PAGE)
  }, [status, results.length, loadMore])

  const data = useMemo(() => results.map(mapConvexLead), [results])

  // Cache disque : sert la liste de la dernière session pendant le chargement,
  // puis la donnée live prend le relais et réécrit le cache en continu.
  const userId = useAuth((s) => s.user?.id)
  const cacheKey = filters === null || search ? null : leadsCacheKey(userId, filters ?? {})
  const cached = useMemo(
    () => (cacheKey ? ((fetchCache.get(cacheKey)?.data as LeadResponse[] | undefined) ?? null) : null),
    [cacheKey],
  )
  const liveReady = status !== 'LoadingFirstPage'
  // Toutes les listes se drainent en entier : on garde le cache complet à
  // l'écran tant que le live n'a pas rattrapé sa taille, pour éviter que la
  // liste rétrécisse puis regrossisse à chaque visite. À la fin du drain
  // (canLoadMore false), le live fait foi même s'il est plus court
  // (suppressions côté serveur).
  const showLive = liveReady && (!canLoadMore || !cached || data.length >= cached.length)
  useEffect(() => {
    if (!cacheKey || !liveReady || data.length === 0) return
    const entry = { data: data.slice(0, LEADS_CACHE_MAX_ROWS), timestamp: Date.now() }
    fetchCache.set(cacheKey, entry)
    persistEntry(cacheKey, entry)
  }, [cacheKey, data, liveReady])

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

// ─── Drain leads partagé (rôles non commerciaux) ─────────────────────────────
// usePaginatedQuery ne se déduplique PAS entre instances (id de pagination
// propre à chaque hook) : chaque montage de page — Topbar compris — re-souscrivait
// et re-téléchargeait toute la population enrichie. L'abonnement vit maintenant
// UNE fois au niveau du layout authentifié (<SharedLeadsKeeper/> dans
// RequireAuth) et les consommateurs (Topbar, liste setter, liste admin sans
// filtre) lisent ce store — la navigation ne coûte plus rien.
type SharedLeadsState = AsyncProgressive<LeadResponse[]>
const emptySharedLeads: SharedLeadsState = {
  data: null,
  loading: true,
  error: null,
  refetch: noop,
  backgroundLoading: false,
  canLoadMore: false,
  loadMore: undefined,
}
const sharedLeadsStore = create<SharedLeadsState>(() => emptySharedLeads)

export function SharedLeadsKeeper(): null {
  const state = useConvexLeads({})
  useEffect(() => {
    sharedLeadsStore.setState(state)
  }, [state.data, state.loading, state.error, state.backgroundLoading, state.canLoadMore, state.loadMore])
  useEffect(() => () => sharedLeadsStore.setState(emptySharedLeads), [])
  return null
}

export function useSharedLeads(): SharedLeadsState {
  return sharedLeadsStore()
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

  // Avec une période (fromDate/toDate) : query fenêtrée rdv:listWindow (plage
  // portée par l'index, non paginée, dédupliquée entre composants). Sans
  // période : drain paginé classique de la table.
  const from = filters?.fromDate ? Date.parse(filters.fromDate) : undefined
  const to = filters?.toDate ? Date.parse(filters.toDate) : undefined
  const windowed = filters !== null && !leadId && from !== undefined && to !== undefined
  const windowRows = useQuery(
    rdvListWindow,
    windowed ? { commercialId: filters?.commercialId, from: from!, to: to! } : 'skip',
  )

  const args = filters === null || leadId || windowed
    ? ('skip' as const)
    : { commercialId: filters?.commercialId, from, to }
  const { results, status, loadMore } = usePaginatedQuery(rdvList, args, { initialNumItems: PAGE_SIZE })
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(PAGE_SIZE)
  }, [status, loadMore])

  const data = useMemo(() => {
    if (leadId) return (byLead ?? []).map(mapConvexRdv)
    if (windowed) return (windowRows ?? []).map(mapConvexRdv)
    return results.map(mapConvexRdv)
  }, [results, leadId, byLead, windowed, windowRows])

  // Stale-while-revalidate : un changement d'args (nouvelle période) fait
  // repartir usePaginatedQuery de zéro (LoadingFirstPage, results vides). On
  // continue d'afficher la dernière liste connue pendant le rechargement au
  // lieu de vider les graphes ; `loading` reste vrai pour qui veut un spinner.
  const listLoading = !leadId && (windowed ? windowRows === undefined : args !== 'skip' && status === 'LoadingFirstPage')
  const [heldList, setHeldList] = useState<RdvResponse[] | null>(null)
  if (!leadId && filters !== null && !listLoading && heldList !== data) setHeldList(data)

  return {
    data: filters === null ? null : (listLoading && heldList ? heldList : data),
    loading: filters !== null && (leadId ? byLead === undefined : listLoading),
    error: null,
    refetch: noop,
  }
}

export function useConvexLead(id: string | undefined): Async<LeadResponse> {
  // Variante enrichie : la fiche détail a besoin d'assignedSetterIds (setters
  // dérivés des appels — les leads GHL natifs n'ont pas de setterId principal).
  const now = useSessionNow()
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
// le fige au montage, bucketé à 15 min (le serveur ne s'en sert que pour la
// troncature "live" et le fallback de plage). Ce bucket sert aussi de TTL aux
// stats ponctuelles (useOneShotQuery) : leads:stats / setterLeaderboard /
// summary scannent des tables entières (3 à 5 Mo lus par exécution) — 15 min
// divise leur coût par 3 par rapport à l'ancien bucket de 5 min.
const STABLE_NOW_BUCKET_MS = 15 * 60_000
function useStableNow(): number {
  return useMemo(() => Math.floor(Date.now() / STABLE_NOW_BUCKET_MS) * STABLE_NOW_BUCKET_MS, [])
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
    // Plage jamais visitée (rien en localStorage) : on conserve les chiffres de
    // la plage précédente le temps du rechargement (~1 s) au lieu de tout
    // remettre à zéro. Pas de fuite entre comptes : un changement d'utilisateur
    // passe par /login → la page (et ce fallback mémoire) est démontée.
    current = { k: key, v: lsRead<T>(key) ?? held.v }
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

// Rapport ROAS pubs (ads:report, rôles alignés sur convex/ads.ts). Query
// RÉACTIVE : la resync dépense (action adSpend:sync) écrit adSpendDaily et la
// donnée se rafraîchit toute seule — refetch est donc un no-op.
const ADS_ROLES = new Set<Role>(['admin', 'commercial_lead'])

export function useConvexAdsReport(params: {
  from: string
  to: string
  level?: AdsLevel
  channel?: AdChannel
} | null): Async<AdsReport> {
  const role = useAuth((s) => s.user?.role)
  const allowed = !!role && ADS_ROLES.has(role)
  const res = useQuery(
    adsReport,
    allowed && params !== null
      ? {
          from: params.from,
          to: params.to,
          level: params.level ?? 'campaign',
          channel: params.channel ?? 'meta',
        }
      : 'skip',
  )
  return {
    data: (res ?? null) as AdsReport | null,
    loading: allowed && params !== null && res === undefined,
    error: null,
    refetch: noop,
  }
}

// Budget publicitaire en cours (adDeposits:budget) : KPI depuis le dernier
// dépôt de solde. Réactif — la saisie d'un dépôt ou la sync dépense rafraîchit
// la carte toute seule.
export function useConvexAdBudget(channel: AdChannel): Async<ConvexAdBudget> {
  const role = useAuth((s) => s.user?.role)
  const allowed = !!role && ADS_ROLES.has(role)
  const res = useQuery(adBudget, allowed ? { channel } : 'skip')
  return {
    data: (res ?? null) as ConvexAdBudget | null,
    loading: allowed && res === undefined,
    error: null,
    refetch: noop,
  }
}

// Historique des dépôts (dialog admin « Nouveau dépôt »).
export function useConvexAdDeposits(channel: AdChannel, enabled: boolean): Async<ConvexAdDeposit[]> {
  const role = useAuth((s) => s.user?.role)
  const allowed = !!role && ADS_ROLES.has(role)
  const res = useQuery(adDepositsList, allowed && enabled ? { channel } : 'skip')
  return {
    data: (res ?? null) as ConvexAdDeposit[] | null,
    loading: allowed && enabled && res === undefined,
    error: null,
    refetch: noop,
  }
}

// Tunnel simulateur — même garde de rôles et même réactivité que le rapport ads.
export function useConvexSimulatorFunnel(
  params: { from: string; to: string } | null,
): Async<ConvexSimulatorFunnel> {
  const role = useAuth((s) => s.user?.role)
  const allowed = !!role && ADS_ROLES.has(role)
  const res = useQuery(
    simulatorFunnel,
    allowed && params !== null ? { from: params.from, to: params.to } : 'skip',
  )
  return {
    data: (res ?? null) as ConvexSimulatorFunnel | null,
    loading: allowed && params !== null && res === undefined,
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
  // Overview : feed d'appels d'un setter (setterId). Fiche prospect : appels
  // d'un lead (leadId — callLogs:listByLead, était ignoré avant → historique
  // de la fiche toujours vide). Sans l'un ni l'autre → vide (pas de list globale).
  const filtersIsNull = filters === null
  const setterId = filters === null ? undefined : filters?.setterId
  const leadId = filters === null ? undefined : filters?.leadId
  const limit = filters === null ? undefined : filters?.limit
  const bySetter = useQuery(callLogsListBySetter, setterId ? { setterId, limit } : 'skip')
  const byLead = useQuery(callLogsListByLead, !setterId && leadId ? { leadId } : 'skip')
  const rows = setterId ? bySetter : leadId ? byLead : undefined
  const enabled = Boolean(setterId || leadId)
  const data = useMemo(() => {
    if (!enabled) return filtersIsNull ? null : []
    if (rows === undefined) return null
    const mapped = rows.map(mapConvexCallLog)
    return limit !== undefined && !setterId ? mapped.slice(0, limit) : mapped
  }, [enabled, rows, filtersIsNull, limit, setterId])
  return { data, loading: enabled && rows === undefined, error: null, refetch: noop }
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
  // Rôle perçu (s.user), pas realUser : le serveur applique l'overlay viewAs,
  // un admin qui explore un profil non-lead doit basculer sur directory.
  const role = useAuth((s) => s.user?.role)
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

// Journal d'activité d'un prospect (fiche : section Historique). Périmètre
// appliqué côté serveur (activityLog:forLead).
export function useConvexLeadActivity(leadId: string | undefined, limit = 200): Async<ConvexActivityDoc[]> {
  const rows = useQuery(activityLogForLead, leadId ? { leadId, limit } : 'skip')
  const data = useMemo(() => (leadId ? (rows ?? null) : []), [leadId, rows])
  return { data, loading: Boolean(leadId) && rows === undefined, error: null, refetch: noop }
}

// Remarques GHL d'un prospect (fiche) : miroir local des notes de la fiche
// contact GHL, rafraîchi côté serveur (ghlContactNotes:refresh).
export function useConvexGhlNotes(leadId: string | undefined): Async<ConvexGhlNotesResult> {
  const rows = useQuery(ghlContactNotesListByLead, leadId ? { leadId } : 'skip')
  return { data: leadId ? (rows ?? null) : null, loading: Boolean(leadId) && rows === undefined, error: null, refetch: noop }
}

// ─── Journal d'activité (page Historique) ────────────────────────────────────
// Même recette que les listes : la dernière page vue (mêmes filtres) est servie
// depuis le cache mémoire/disque pendant que l'abonnement Convex démarre —
// plus d'écran « Chargement… » à chaque entrée sur la page.
// La période est chargée UNE fois (drain automatique par pages de 200 jusqu'à
// un plafond) ; les filtres domaine/personne/type/recherche s'appliquent côté
// client → chaque sélection est instantanée (avant : nouvelle souscription
// serveur à chaque clic, latence datacenter à chaque fois).
const JOURNAL_CACHE_MAX_ROWS = 2000
export const JOURNAL_PAGE_SIZE = 200
export const JOURNAL_DRAIN_MAX = 2000

function journalCacheKey(userId: string | undefined, args: ActivityListArgs): string {
  return `journal:${userId ?? 'anon'}:${JSON.stringify(args)}`
}

export type ActivityScope = { kind: 'all' | 'domains' | 'own'; domains: ActivityDomain[]; userId: string }

export function useConvexActivityScope(): ActivityScope | null {
  const userId = useAuth((s) => s.user?.id)
  const key = `journal-scope:${userId ?? 'anon'}`
  const live = useQuery(activityLogMyScope, userId ? {} : 'skip')
  const cached = useMemo(() => (fetchCache.get(key)?.data as ActivityScope | undefined) ?? null, [key])
  useEffect(() => {
    if (!live) return
    const entry = { data: live, timestamp: Date.now() }
    fetchCache.set(key, entry)
    persistEntry(key, entry)
  }, [key, live])
  return live ?? cached
}

export function useConvexActivityLog(args: ActivityListArgs): {
  rows: ConvexActivityDoc[]
  loading: boolean
  fromCache: boolean
  canLoadMore: boolean
  loadingMore: boolean
  loadMore: () => void
} {
  const userId = useAuth((s) => s.user?.id)
  const { results, status, loadMore } = usePaginatedQuery(activityLogList, args, { initialNumItems: JOURNAL_PAGE_SIZE })
  const cacheKey = journalCacheKey(userId, args)
  const cached = useMemo(
    () => (fetchCache.get(cacheKey)?.data as ConvexActivityDoc[] | undefined) ?? null,
    [cacheKey],
  )
  const liveReady = status !== 'LoadingFirstPage'
  // Drain automatique de la période jusqu'au plafond (au-delà : « Charger plus »).
  useEffect(() => {
    if (status === 'CanLoadMore' && results.length < JOURNAL_DRAIN_MAX) loadMore(JOURNAL_PAGE_SIZE)
  }, [status, results.length, loadMore])
  useEffect(() => {
    if (!liveReady) return
    const entry = { data: results.slice(0, JOURNAL_CACHE_MAX_ROWS), timestamp: Date.now() }
    fetchCache.set(cacheKey, entry)
    persistEntry(cacheKey, entry)
  }, [cacheKey, results, liveReady])
  // Le cache reste affiché tant que le live n'a pas rattrapé sa taille (évite
  // la liste qui rétrécit puis regrossit pendant le drain).
  const draining = status === 'CanLoadMore' && results.length < JOURNAL_DRAIN_MAX
  const showLive = liveReady && (!cached || !draining || results.length >= cached.length)
  return {
    rows: showLive ? results : cached ?? [],
    loading: !liveReady && !cached,
    fromCache: !showLive,
    canLoadMore: status === 'CanLoadMore' && results.length >= JOURNAL_DRAIN_MAX,
    loadingMore: status === 'LoadingMore' || (liveReady && draining),
    loadMore: () => loadMore(JOURNAL_PAGE_SIZE),
  }
}
