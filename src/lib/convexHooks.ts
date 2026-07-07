import { useCallback, useEffect, useMemo } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { analyticsDebriefStats, analyticsFunnel, analyticsSummary, callLogsListBySetter, clientsList, commercialObjectivesListByPeriod, debriefsListByLead, leadsGet, leadsList, leadsStats, paymentsListAcomptes, rdvList, substepsList, usersList } from './convexApi'
import { mapConvexAcompte, mapConvexCallLog, mapConvexClient, mapConvexCommercialObjective, mapConvexDebrief, mapConvexLead, mapConvexRdv, mapConvexSubstep, mapConvexUser } from './convexMappers'
import { useAuth } from './auth'
import type {
  AcompteResponse,
  AnalyticsFunnelResponse,
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
  const args = filters === null
    ? ('skip' as const)
    : {
        status: filters?.status,
        setterId: filters?.setterId,
        assignedToId: filters?.assignedToId,
        city: filters?.city,
        search: search ? search : undefined,
      }
  const { results, status, loadMore } = usePaginatedQuery(leadsList, args, { initialNumItems: LEADS_PAGE_SIZE })

  // Chargement fenêtré : on NE déroule PAS toute la pagination (10k–50k leads
  // saturent la RAM et crashent l'onglet). On expose loadMore/canLoadMore et la
  // liste virtualisée déclenche la fenêtre suivante quand on approche du bas.
  const canLoadMore = status === 'CanLoadMore'
  const doLoadMore = useCallback(() => {
    if (status === 'CanLoadMore') loadMore(LEADS_PAGE_SIZE)
  }, [status, loadMore])

  const data = useMemo(() => results.map(mapConvexLead), [results])
  return {
    data: filters === null ? null : data,
    loading: status === 'LoadingFirstPage' && filters !== null,
    // backgroundLoading = fenêtre suivante en cours (pas d'hydratation de fond globale).
    backgroundLoading: status === 'LoadingMore',
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
  const res = useQuery(leadsStats, {})
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
  const args = filters === null
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

  // Filtre leadId non supporté par rdv:list — appliqué côté client.
  const leadId = filters === null ? undefined : filters?.leadId
  const data = useMemo(() => {
    const mapped = results.map(mapConvexRdv)
    return leadId ? mapped.filter((r) => r.leadId === leadId) : mapped
  }, [results, leadId])

  return {
    data: filters === null ? null : data,
    loading: status === 'LoadingFirstPage' && filters !== null,
    error: null,
    refetch: noop,
  }
}

export function useConvexLead(id: string | undefined): Async<LeadResponse> {
  const res = useQuery(leadsGet, id ? { leadId: id } : 'skip')
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
  const allowed = !!role && SUMMARY_ROLES.has(role)
  const res = useQuery(
    analyticsSummary,
    allowed ? { now, days: filters?.days, from: filters?.from, to: filters?.to } : 'skip',
  )
  return {
    data: allowed ? ((res ?? null) as AnalyticsSummaryResponse | null) : null,
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
  const allowed = !!role && FUNNEL_ROLES.has(role)
  const res = useQuery(
    analyticsFunnel,
    allowed
      ? { now, days: filters?.days, from: filters?.from, to: filters?.to, setterId: filters?.setterId, sector: filters?.sector }
      : 'skip',
  )
  return {
    data: allowed ? ((res ?? null) as AnalyticsFunnelResponse | null) : null,
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
  const allowed = !!role && DEBRIEF_ROLES.has(role)
  const res = useQuery(
    analyticsDebriefStats,
    allowed ? { from: filters?.from, to: filters?.to, commercialId: filters?.commercialId } : 'skip',
  )
  return {
    data: allowed ? ((res ?? null) as DebriefStats | null) : null,
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
  const rows = useQuery(callLogsListBySetter, setterId ? { setterId, limit: filters?.limit } : 'skip')
  const data = useMemo(() => {
    if (!setterId) return filters === null ? null : []
    if (rows === undefined) return null
    return rows.map(mapConvexCallLog)
  }, [setterId, rows, filters])
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
  const allowed = filters !== null && !!clientId && !!role && WORKFLOW_VIEW_ROLES.has(role)
  const rows = useQuery(substepsList, allowed ? { clientId } : 'skip')
  const data = useMemo(() => {
    if (!allowed) return filters === null || !clientId ? null : []
    if (rows === undefined) return null
    return rows.map(mapConvexSubstep)
  }, [allowed, rows, filters, clientId])
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
  const allowed = filters !== null && !!role && CLIENTS_VIEW_ROLES.has(role)
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
  const data = useMemo(() => {
    if (!allowed) return filters === null ? null : []
    if (rows === undefined) return null
    return rows.map(mapConvexClient)
  }, [allowed, rows, filters])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}

const USERS_LIST_ROLES = new Set(['admin', 'setter_lead', 'commercial_lead'])

export function useConvexUsers(): Async<UserResponse[]> {
  // users:list exige un rôle lead/admin côté serveur — pour les autres rôles
  // on ne lance pas la requête (useQuery propagerait l'erreur au rendu) et on
  // renvoie une liste vide : les pages tolèrent l'absence de noms.
  const role = useAuth((s) => s.realUser?.role)
  const allowed = role !== undefined && role !== null && USERS_LIST_ROLES.has(role)
  const rows = useQuery(usersList, allowed ? {} : 'skip')
  const data = useMemo(() => {
    if (!allowed) return []
    if (rows === undefined) return null
    return rows.map(mapConvexUser)
  }, [allowed, rows])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}
