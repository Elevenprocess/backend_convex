import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { notifyClipboardCopied } from './clipboardToast'
import { notifyRealtimeRefresh, REALTIME_REFRESH_EVENT, type RealtimeRefreshPayload } from './realtime'
import { useNetworkActivity } from './networkActivity'
import type {
  CallLogResponse,
  InvitationResponse,
  LeadResponse,
  LeadStatsResponse,
  LeadStatus,
  RdvLocation,
  RdvResponse,
  UserResponse,
  AnalyticsSummaryResponse,
  AnalyticsFunnelResponse,
  AnalyticsCommercialSummary,
  ProjectAttachmentResponse,
  ProjectDetailResponse,
  ProjectResponse,
} from './types'

type Async<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

// `backgroundLoading` = phase 2 (full hydration) still running, phase 1 data is already on screen.
type AsyncProgressive<T> = Async<T> & {
  backgroundLoading: boolean
}

type FetchCacheEntry = {
  data: unknown
  timestamp: number
}

const FETCH_CACHE_TTL_MS = 10 * 60 * 1000
const PERSISTED_CACHE_PREFIX = 'ecoi.fetchCache.v1:'
const PERSISTED_CACHE_PATHS = ['/leads', '/users', '/analytics/summary', '/analytics/funnel', '/ghl-calendar/events']
const fetchCache = new Map<string, FetchCacheEntry>()

function buildFetchCacheKey(path: string | null, queryKey: string): string | null {
  return path === null ? null : `${path}?${queryKey}`
}

function readCachedEntry(cacheKey: string | null): FetchCacheEntry | null {
  if (!cacheKey) return null
  const entry = fetchCache.get(cacheKey) ?? readPersistedCache(cacheKey)
  if (!entry) return null
  if (Date.now() - entry.timestamp > FETCH_CACHE_TTL_MS) {
    deleteCache(cacheKey)
    return null
  }
  fetchCache.set(cacheKey, entry)
  return entry
}

function readCachedData<T>(cacheKey: string | null): T | null {
  return (readCachedEntry(cacheKey)?.data as T | undefined) ?? null
}

function shouldPersistCache(cacheKey: string): boolean {
  return PERSISTED_CACHE_PATHS.some((path) => cacheKey.startsWith(`${path}?`))
}

function readPersistedCache(cacheKey: string): FetchCacheEntry | null {
  if (typeof window === 'undefined' || !shouldPersistCache(cacheKey)) return null
  try {
    const storageKey = `${PERSISTED_CACHE_PREFIX}${cacheKey}`
    const raw = window.sessionStorage.getItem(storageKey) ?? window.localStorage.getItem(storageKey)
    if (!raw) return null
    return JSON.parse(raw) as FetchCacheEntry
  } catch {
    return null
  }
}

function writeCache(cacheKey: string | null, entry: FetchCacheEntry) {
  if (!cacheKey) return
  fetchCache.set(cacheKey, entry)
  if (typeof window === 'undefined' || !shouldPersistCache(cacheKey)) return
  try {
    const storageKey = `${PERSISTED_CACHE_PREFIX}${cacheKey}`
    const serialized = JSON.stringify(entry)
    window.sessionStorage.setItem(storageKey, serialized)
    window.localStorage.setItem(storageKey, serialized)
  } catch {
    // Cache best-effort : si le navigateur refuse/limite le stockage, l'app continue.
  }
}

async function prefetchFetchCache<T>(
  path: string,
  query?: Record<string, string | number | undefined | null>,
  options?: { force?: boolean },
): Promise<T | null> {
  const queryKey = JSON.stringify(query ?? {})
  const cacheKey = buildFetchCacheKey(path, queryKey)
  if (!options?.force) {
    const cached = readCachedData<T>(cacheKey)
    if (cached !== null) return cached
  }
  const data = await api<T>(path, { query })
  writeCache(cacheKey, { data, timestamp: Date.now() })
  return data
}

function deleteCache(cacheKey: string) {
  fetchCache.delete(cacheKey)
  if (typeof window === 'undefined') return
  try {
    const storageKey = `${PERSISTED_CACHE_PREFIX}${cacheKey}`
    window.sessionStorage.removeItem(storageKey)
    window.localStorage.removeItem(storageKey)
  } catch {
    // best-effort
  }
}

function deleteCachesForPrefixes(prefixes: string[]) {
  for (const key of Array.from(fetchCache.keys())) {
    if (prefixes.some((prefix) => key.startsWith(`${prefix}?`))) deleteCache(key)
  }
  if (typeof window === 'undefined') return
  try {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      for (let i = storage.length - 1; i >= 0; i--) {
        const storageKey = storage.key(i)
        if (!storageKey?.startsWith(PERSISTED_CACHE_PREFIX)) continue
        const cacheKey = storageKey.slice(PERSISTED_CACHE_PREFIX.length)
        if (prefixes.some((prefix) => cacheKey.startsWith(`${prefix}?`))) {
          storage.removeItem(storageKey)
        }
      }
    }
  } catch {
    // best-effort
  }
}

// useFetch: passe `path = null` pour désactiver le fetch (utile quand l'id n'existe pas encore).
// Les réponses récentes restent en mémoire pour réafficher instantanément les pages lourdes
// après une navigation, puis l'API est rafraîchie en arrière-plan.
function useFetch<T>(
  path: string | null,
  query?: Record<string, string | number | undefined | null>,
  options?: { refreshCachedOnMount?: boolean; silentInitialLoading?: boolean },
): Async<T> {
  const queryKey = JSON.stringify(query ?? {})
  const cacheKey = buildFetchCacheKey(path, queryKey)
  const cachedData = readCachedData<T>(cacheKey)
  const [data, setData] = useState<T | null>(cachedData)
  const [loading, setLoading] = useState(path !== null && cachedData === null && !options?.silentInitialLoading)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (path === null) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const latestCachedEntry = readCachedEntry(cacheKey)
    const latestCachedData = latestCachedEntry?.data as T | undefined
    if (latestCachedData !== undefined) {
      setData(latestCachedData)
      setLoading(false)
      setError(null)
    }

    // Si la page revient rapidement sur une liste déjà chargée, on réutilise le cache
    // sans relancer l'API. Le bouton/flow qui appelle refetch() force toujours un refresh.
    if (latestCachedEntry && tick === 0 && !options?.refreshCachedOnMount) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(latestCachedData === undefined && !options?.silentInitialLoading)
    setError(null)
    useNetworkActivity.getState().start()
    api<T>(path, { query, signal: ctrl.signal })
      .then((d) => {
        if (ctrl.signal.aborted) return
        writeCache(cacheKey, { data: d, timestamp: Date.now() })
        setData(d)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        const msg = e instanceof ApiError ? `${e.status} — ${e.message}` : (e as Error).message
        setError(msg)
        if (latestCachedData === undefined) setData(null)
      })
      .finally(() => {
        useNetworkActivity.getState().stop()
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => {
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, queryKey, tick])

  useEffect(() => {
    if (path === null) return
    const onRealtimeRefresh = (event: Event) => {
      const detail = (event as CustomEvent<RealtimeRefreshPayload>).detail
      if (!detail?.paths?.some((prefix) => path.startsWith(prefix))) return
      deleteCachesForPrefixes(detail.paths)
      setTick((t) => t + 1)
    }
    window.addEventListener(REALTIME_REFRESH_EVENT, onRealtimeRefresh)
    return () => window.removeEventListener(REALTIME_REFRESH_EVENT, onRealtimeRefresh)
  }, [path])

  return { data, loading, error, refetch: () => setTick((t) => t + 1) }
}

const LEADS_LIMIT_MAX = 500
const CALL_LOGS_LIMIT_MAX = 200
const RDV_LIMIT_MAX = 200

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  return Math.min(limit ?? fallback, max)
}

// ─── Leads ─────────────────────────────────────────────────
export function useLeads(filters?: {
  status?: LeadStatus
  setterId?: string
  assignedToId?: string
  city?: string
  search?: string
  limit?: number
  offset?: number
  notInAirtable?: boolean
} | null): Async<LeadResponse[]> {
  const query = filters === null ? undefined : (() => {
    const { notInAirtable, ...rest } = filters ?? {}
    return {
      ...rest,
      limit: clampLimit(filters?.limit, 250, LEADS_LIMIT_MAX),
      notInAirtable: notInAirtable ? 'true' : undefined,
    }
  })()
  return useFetch<LeadResponse[]>(filters === null ? null : '/leads', query)
}

// Two-phase fetch (Facebook News-Feed style):
//   phase 1 → quickFetch (defaults to 50 leads) renvoie vite, on peint l'écran
//   phase 2 → fullFetch (defaults to 500) tourne en parallèle, remplace phase 1 dès qu'il arrive
// Pendant la phase 2, `backgroundLoading` = true → le composant peut afficher un badge subtil.
export function useLeadsProgressive(filters?: {
  status?: LeadStatus
  setterId?: string
  assignedToId?: string
  city?: string
  search?: string
  quickLimit?: number
  fullLimit?: number
  notInAirtable?: boolean
} | null): AsyncProgressive<LeadResponse[]> {
  const quickLimit = clampLimit(filters?.quickLimit, 50, LEADS_LIMIT_MAX)
  const fullLimit = clampLimit(filters?.fullLimit, 500, LEADS_LIMIT_MAX)
  const { notInAirtable, quickLimit: _q, fullLimit: _f, ...rest } = filters ?? {}
  const baseFilters = filters === null ? undefined : {
    ...rest,
    notInAirtable: notInAirtable ? 'true' : undefined,
  }
  const endpoint = filters === null ? null : '/leads'
  const quick = useFetch<LeadResponse[]>(endpoint, baseFilters ? { ...baseFilters, limit: quickLimit } : undefined)
  const full = useFetch<LeadResponse[]>(endpoint, baseFilters ? { ...baseFilters, limit: fullLimit } : undefined)
  return {
    data: full.data ?? quick.data,
    loading: !quick.data && !full.data && (quick.loading || full.loading),
    backgroundLoading: !!quick.data && !full.data && full.loading,
    error: full.error ?? quick.error,
    refetch: () => { quick.refetch(); full.refetch() },
  }
}

export function useLead(id: string | undefined): Async<LeadResponse> {
  return useFetch<LeadResponse>(id ? `/leads/${id}` : null)
}

export function useLeadStats(): Async<LeadStatsResponse> {
  return useFetch<LeadStatsResponse>('/leads/stats', undefined, {
    refreshCachedOnMount: true,
    silentInitialLoading: true,
  })
}

// ─── RDV ───────────────────────────────────────────────────
export function useRdvList(filters?: {
  leadId?: string
  commercialId?: string
  setterId?: string
  fromDate?: string
  toDate?: string
  limit?: number
} | null): Async<RdvResponse[]> {
  return useFetch<RdvResponse[]>(
    filters === null ? null : '/rdv',
    filters === null ? undefined : { ...filters, limit: clampLimit(filters?.limit, 200, RDV_LIMIT_MAX) },
    { refreshCachedOnMount: true, silentInitialLoading: true },
  )
}

// Cf. useLeadsProgressive — même pattern pour les RDV.
export function useRdvListProgressive(filters?: {
  leadId?: string
  commercialId?: string
  setterId?: string
  fromDate?: string
  toDate?: string
  quickLimit?: number
  fullLimit?: number
}): AsyncProgressive<RdvResponse[]> {
  const quickLimit = clampLimit(filters?.quickLimit, 100, RDV_LIMIT_MAX)
  const fullLimit = clampLimit(filters?.fullLimit, 200, RDV_LIMIT_MAX)
  const baseFilters = { ...filters, quickLimit: undefined, fullLimit: undefined }
  const quick = useFetch<RdvResponse[]>('/rdv', { ...baseFilters, limit: quickLimit })
  const full = useFetch<RdvResponse[]>('/rdv', { ...baseFilters, limit: fullLimit })
  return {
    data: full.data ?? quick.data,
    loading: !quick.data && !full.data && (quick.loading || full.loading),
    backgroundLoading: !!quick.data && !full.data && full.loading,
    error: full.error ?? quick.error,
    refetch: () => { quick.refetch(); full.refetch() },
  }
}

export function useRdv(id: string | undefined): Async<RdvResponse> {
  return useFetch<RdvResponse>(id ? `/rdv/${id}` : null)
}

export type UpdateRdvPayload = {
  commercialId?: string | null
  scheduledAt?: string
  locationType?: RdvLocation
  status?: RdvResponse['status']
  result?: RdvResponse['result'] | null
  signatureAt?: string | null
  montantTotal?: number | string | null
  financingType?: RdvResponse['financingType'] | null
  objections?: string | null
  nonSaleReason?: string | null
  kits?: string | null
  notes?: string | null
  debriefFilledAt?: string | null
}

export async function updateRdv(id: string, input: UpdateRdvPayload): Promise<RdvResponse> {
  const updated = await api<RdvResponse>(`/rdv/${id}`, { method: 'PATCH', body: input })
  notifyRealtimeRefresh({ event: 'rdv:updated', paths: ['/rdv', '/leads', '/analytics/summary', '/analytics/funnel', '/ghl-calendar/events'] })
  return updated
}

// ─── Users ─────────────────────────────────────────────────
export function useUsers(): Async<UserResponse[]> {
  return useFetch<UserResponse[]>('/users')
}

export function useInvitations(enabled = true): Async<InvitationResponse[]> {
  return useFetch<InvitationResponse[]>(enabled ? '/users/invitations' : null)
}

export type InviteUserInput = {
  email: string
  name: string
  phone?: string | null
  role: UserResponse['role']
  team?: UserResponse['team']
}

export async function inviteUser(input: InviteUserInput): Promise<InvitationResponse> {
  return api<InvitationResponse>('/users/invitations', { method: 'POST', body: input })
}

export async function acceptInvitation(input: { token: string; password: string }): Promise<UserResponse> {
  return api<UserResponse>('/users/invitations/accept', { method: 'POST', body: input })
}

export type UpdateUserPayload = {
  name?: string
  phone?: string | null
  image?: string | null
  role?: UserResponse['role']
  team?: UserResponse['team']
  active?: boolean
  ghlUserId?: string | null
  ghlCalendarId?: string | null
  ghlLocationId?: string | null
}

export async function updateUser(id: string, input: UpdateUserPayload): Promise<UserResponse> {
  return api<UserResponse>(`/users/${id}`, { method: 'PATCH', body: input })
}

export type UpdateMyProfilePayload = Pick<UpdateUserPayload, 'name' | 'phone' | 'image'>

export async function updateMyProfile(input: UpdateMyProfilePayload): Promise<UserResponse> {
  return api<UserResponse>('/users/me', { method: 'PATCH', body: input })
}

export type RenewUserPayload = {
  email?: string
  name?: string
  phone?: string | null
  role?: UserResponse['role']
  team?: UserResponse['team']
}

export type RenewUserResponse = {
  user: UserResponse
  inviteUrl: string
  emailSent: boolean
}

export async function renewUser(id: string, input: RenewUserPayload): Promise<RenewUserResponse> {
  return api<RenewUserResponse>(`/users/${id}/renew`, { method: 'POST', body: input })
}

export async function deleteUser(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/users/${id}`, { method: 'DELETE' })
}

export function useUser(id: string | undefined): Async<UserResponse> {
  return useFetch<UserResponse>(id ? `/users/${id}` : null)
}

// ─── Analytics ─────────────────────────────────────────────
export function useAnalyticsSummary(filters?: {
  days?: number
  from?: string
  to?: string
}): Async<AnalyticsSummaryResponse> {
  return useFetch<AnalyticsSummaryResponse>('/analytics/summary', filters, {
    refreshCachedOnMount: true,
    silentInitialLoading: true,
  })
}

export function prefetchAnalyticsSummary(filters?: {
  days?: number
  from?: string
  to?: string
}, options?: { force?: boolean }): Promise<AnalyticsSummaryResponse | null> {
  return prefetchFetchCache<AnalyticsSummaryResponse>('/analytics/summary', filters, options)
}

export function useAnalyticsFunnel(filters?: {
  days?: number
  from?: string
  to?: string
  setterId?: string
  sector?: string
}): Async<AnalyticsFunnelResponse> {
  return useFetch<AnalyticsFunnelResponse>('/analytics/funnel', filters, {
    refreshCachedOnMount: true,
    silentInitialLoading: true,
  })
}

export function prefetchAnalyticsFunnel(filters?: {
  days?: number
  from?: string
  to?: string
  setterId?: string
  sector?: string
}, options?: { force?: boolean }): Promise<AnalyticsFunnelResponse | null> {
  return prefetchFetchCache<AnalyticsFunnelResponse>('/analytics/funnel', filters, options)
}

// ─── Debrief analytics ──────────────────────────────────────
// Agrégation des débriefs réels (table debriefs) — alimente les cartes
// « Débrief qualifié » et « Raisons non-vente » de l'Overview.
export type DebriefAnalyticsResponse = {
  outcomeCounts: { vente: number; non_vente: number; en_reflexion: number; suivi_prevu: number }
  acceptanceFactorCounts: Record<string, number>
  nonSaleReasonCounts: Record<string, number>
  total: number
}

export function useDebriefAnalytics(filters?: {
  from?: string
  to?: string
  commercialId?: string
}): Async<DebriefAnalyticsResponse> {
  return useFetch<DebriefAnalyticsResponse>('/analytics/debriefs', filters, {
    refreshCachedOnMount: true,
    silentInitialLoading: true,
  })
}

// ─── Pipeline analytics (admin) ─────────────────────────────
export type PipelineDistributionEntry = {
  ghlStageName: string | null
  saasStatus: string | null
  count: number
  totalValue: number
}
export type PipelineDistributionResponse = {
  generatedAt: string
  totalOpenLeads: number
  totalOpenValue: number
  stages: PipelineDistributionEntry[]
}
export type PipelineCommercialKpi = {
  userId: string
  name: string
  ghlUserId: string | null
  openLeads: number
  rdvPlanned: number
  devisEnAttente: number
  signed: number
  ca: number
  closingRate: number
}
export type PipelineByCommercialResponse = {
  generatedAt: string
  commercials: PipelineCommercialKpi[]
}
export type PipelineStuckLead = {
  leadId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  ghlStageName: string | null
  saasStatus: string
  assignedToId: string | null
  assignedToName: string | null
  monetaryValue: number | null
  lastStageChangeAt: string | null
  daysSinceLastChange: number
}
export type PipelineStuckResponse = {
  generatedAt: string
  thresholdDays: number
  total: number
  leads: PipelineStuckLead[]
}

export function usePipelineDistribution(): Async<PipelineDistributionResponse> {
  return useFetch<PipelineDistributionResponse>('/analytics/pipeline/distribution')
}

export function usePipelineByCommercial(): Async<PipelineByCommercialResponse> {
  return useFetch<PipelineByCommercialResponse>('/analytics/pipeline/by-commercial')
}

export function usePipelineStuck(days = 30): Async<PipelineStuckResponse> {
  return useFetch<PipelineStuckResponse>('/analytics/pipeline/stuck', { days })
}

export type PipelineBackfillSummary = {
  pipelineName: string
  pipelineId: string
  stagesInPipeline: number
  processed: number
  created: number
  updated: number
  skipped: number
  failed: number
  unknownStages: string[]
  samples: { contactId: string; stageName: string; assignedTo: string | null; value: number }[]
  durationMs: number
}

export async function runPipelineBackfill(opts: { dryRun: boolean; limit?: number }): Promise<PipelineBackfillSummary> {
  return api<PipelineBackfillSummary>('/analytics/pipeline/backfill', {
    method: 'POST',
    query: { dryRun: opts.dryRun ? 'true' : 'false', limit: opts.limit },
  })
}

// ─── Call logs ─────────────────────────────────────────────
export function useCallLogs(filters?: {
  leadId?: string
  setterId?: string
  limit?: number
  offset?: number
} | null): Async<CallLogResponse[]> {
  return useFetch<CallLogResponse[]>(filters === null ? null : '/call-logs', filters === null ? undefined : { ...filters, limit: clampLimit(filters?.limit, 50, CALL_LOGS_LIMIT_MAX) })
}

export type CreateCallLogInput = {
  leadId: string
  result: CallLogResponse['result']
  nextCallbackAt?: string | null
  notes?: string | null
  contactName?: string | null
  contactFirstName?: string | null
  contactLastName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  contactCity?: string | null
  contactPostalCode?: string | null
}

export async function createCallLog(input: CreateCallLogInput): Promise<CallLogResponse> {
  return api<CallLogResponse>('/call-logs', { method: 'POST', body: input })
}

export type UpdateLeadInput = Partial<Pick<LeadResponse,
  | 'status'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'addressLine'
  | 'city'
  | 'postalCode'
  | 'revenuFiscal'
  | 'typeLogement'
  | 'datePassageRelance'
  | 'assignedToId'
>>

function updateLeadInCachedData(data: unknown, updated: LeadResponse): unknown {
  if (Array.isArray(data)) {
    let changed = false
    const rows = data.map((item) => {
      if (!item || typeof item !== 'object' || (item as LeadResponse).id !== updated.id) return item
      changed = true
      return { ...(item as LeadResponse), ...updated }
    })
    return changed ? rows : data
  }
  if (data && typeof data === 'object' && (data as LeadResponse).id === updated.id) {
    return { ...(data as LeadResponse), ...updated }
  }
  return data
}

function updateLeadCaches(updated: LeadResponse) {
  const now = Date.now()
  for (const [cacheKey, entry] of Array.from(fetchCache.entries())) {
    if (!cacheKey.startsWith('/leads?') && !cacheKey.startsWith(`/leads/${updated.id}?`)) continue
    const nextData = updateLeadInCachedData(entry.data, updated)
    if (nextData !== entry.data) writeCache(cacheKey, { data: nextData, timestamp: now })
  }
  writeCache(`/leads/${updated.id}?{}`, { data: updated, timestamp: now })
}

export async function updateLead(id: string, input: UpdateLeadInput): Promise<LeadResponse> {
  const updated = await api<LeadResponse>(`/leads/${id}`, { method: 'PATCH', body: input })
  updateLeadCaches(updated)
  if (input.status === 'qualifie') {
    void syncLeadGhlCalendarEvents(id)
      .then((result) => {
        if ((result.created + result.updated) > 0 || result.matched > 0) {
          notifyRealtimeRefresh({ event: 'ghl-calendar:lead-sync', paths: ['/rdv', '/leads', '/ghl-calendar/events', '/analytics/summary', '/analytics/funnel'] })
        }
      })
      .catch(() => undefined)
  }
  return updated
}

export async function deleteLead(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/leads/${id}`, { method: 'DELETE' })
}

export type CreateRdvInput = {
  leadId: string
  commercialId?: string | null
  scheduledAt: string
  locationType?: RdvLocation
  notes?: string | null
  contactName?: string | null
  contactFirstName?: string | null
  contactLastName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  contactCity?: string | null
  contactPostalCode?: string | null
}

export type GhlSectorConfig = {
  sector: string
  calendarId: string
  label: string
}

export type GhlCalendarConfig = {
  configured: boolean
  locationIdPresent: boolean
  sectorCalendarCount: number
  sectors: GhlSectorConfig[]
}

export type GhlFreeSlot = {
  startTime: string
  endTime?: string | null
  calendarId: string
  sector?: string | null
}

export type GhlCalendarEvent = {
  id: string
  calendarId: string
  sector?: string | null
  title: string | null
  startTime: string
  endTime?: string | null
  status?: string | null
  contactId?: string | null
  assignedUserId?: string | null
  commercialId?: string | null
  commercialName?: string | null
  isMappedCommercial?: boolean
  address?: string | null
  notes?: string | null
  contactName?: string | null
  contactFirstName?: string | null
  contactLastName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  contactCity?: string | null
  contactPostalCode?: string | null
}

export type GhlOpportunityStage = {
  id: string
  name: string
  position: number
  opportunities: number
  amount: number
}

export type GhlOpportunity = {
  id: string
  name: string
  monetaryValue: number
  pipelineId: string
  pipelineStageId: string
  assignedTo?: string | null
  assignedToName?: string | null
  mappedCommercialId?: string | null
  status?: string | null
  source?: string | null
  contactId?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  contactCity?: string | null
  contactPostalCode?: string | null
  contactAddress?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  lastStageChangeAt?: string | null
}

export type GhlOpportunitiesResponse = {
  configured: boolean
  pipeline: { id: string; name: string } | null
  stages: GhlOpportunityStage[]
  opportunities: GhlOpportunity[]
  total: number
  amount: number
  truncated: boolean
}

export type GhlUser = {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
}

export type GhlMySector = {
  configured: boolean
  linked: boolean
  userId: string
  ghlUserId: string | null
  primarySector: string | null
  primaryCalendarId: string | null
  sectors: Array<{ sector: string; calendarId: string; label: string; primary: boolean }>
}

export function useGhlCalendarConfig(enabled = true): Async<GhlCalendarConfig> {
  return useFetch<GhlCalendarConfig>(enabled ? '/ghl-calendar/config' : null)
}

export function useGhlUsers(): Async<GhlUser[]> {
  return useFetch<GhlUser[]>('/ghl-calendar/users')
}

export function useGhlMySector(enabled = true): Async<GhlMySector> {
  return useFetch<GhlMySector>(enabled ? '/ghl-calendar/my-sector' : null)
}

export function useGhlFreeSlots(filters?: {
  sector?: string
  calendarId?: string
  from?: string
  to?: string
  timezone?: string
}): Async<{ configured: boolean; slots: GhlFreeSlot[] }> {
  return useFetch<{ configured: boolean; slots: GhlFreeSlot[] }>(filters?.from && filters?.to ? '/ghl-calendar/free-slots' : null, filters)
}

export function useGhlCalendarEvents(filters?: {
  sector?: string
  calendarId?: string
  from?: string
  to?: string
}): Async<{ configured: boolean; events: GhlCalendarEvent[] }> {
  return useFetch<{ configured: boolean; events: GhlCalendarEvent[] }>(filters?.from && filters?.to ? '/ghl-calendar/events' : null, filters, { silentInitialLoading: true })
}

export function useGhlOpportunities(filters?: {
  pipelineId?: string
  pipelineName?: string
  limit?: number
}): Async<GhlOpportunitiesResponse> {
  return useFetch<GhlOpportunitiesResponse>('/ghl-calendar/opportunities', { pipelineName: 'CRM Vente', limit: 300, ...filters })
}

export function syncGhlCalendarEvents(filters: { from: string; to: string; sector?: string; calendarId?: string }): Promise<{ configured: boolean; created: number; updated: number; skipped: number; events: GhlCalendarEvent[] }> {
  return api<{ configured: boolean; created: number; updated: number; skipped: number; events: GhlCalendarEvent[] }>('/ghl-calendar/sync-events', { method: 'POST', query: filters })
}

export function syncLeadGhlCalendarEvents(leadId: string): Promise<{ configured: boolean; created: number; updated: number; skipped: number; matched: number; events: GhlCalendarEvent[] }> {
  return api<{ configured: boolean; created: number; updated: number; skipped: number; matched: number; events: GhlCalendarEvent[] }>(`/ghl-calendar/leads/${leadId}/sync-events`, { method: 'POST' })
}

export function moveGhlOpportunity(
  opportunityId: string,
  payload: { pipelineStageId: string; stageName?: string },
): Promise<{ opportunity: unknown; synced: boolean }> {
  return api<{ opportunity: unknown; synced: boolean }>(
    `/ghl-calendar/opportunities/${encodeURIComponent(opportunityId)}/stage`,
    { method: 'PATCH', body: payload },
  )
}

export function useCommercialAnalytics(id: string | undefined, filters?: { days?: number; from?: string; to?: string }): Async<AnalyticsCommercialSummary> {
  return useFetch<AnalyticsCommercialSummary>(id ? `/analytics/commercials/${id}` : null, filters)
}

export type CreateGhlAppointmentInput = CreateRdvInput & {
  sector: string
  calendarId?: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  addressLine?: string | null
  city?: string | null
  postalCode?: string | null
  typeLogement?: string | null
  revenuFiscal?: number | null
}

export async function createGhlAppointment(input: CreateGhlAppointmentInput): Promise<{ rdv: RdvResponse; ghl: unknown }> {
  return api<{ rdv: RdvResponse; ghl: unknown }>('/ghl-calendar/appointments', {
    method: 'POST',
    body: input,
  })
}

export async function createRdv(input: CreateRdvInput): Promise<RdvResponse> {
  return api<RdvResponse>('/rdv', { method: 'POST', body: input })
}

/**
 * Hook centralisé pour l'action "Appeler".
 * Important: le SaaS ne déclenche aucun appel Ringover. Il copie seulement le
 * numéro pour que le setter le colle/appelle manuellement dans Ringover.
 */
export function useStartCall() {
  return useCallback(
    async (params: { leadId: string; leadName: string; toNumber: string }) => {
      void params.leadId
      void params.leadName
      await copyText(params.toNumber)
      notifyClipboardCopied()
    },
    [],
  )
}

// ─── Projects ─────────────────────────────────────────────
export function useProjectsByLead(
  leadId: string | undefined,
): Async<ProjectResponse[]> {
  return useFetch<ProjectResponse[]>(leadId ? `/projects/lead/${leadId}` : null)
}

export function useProjectDetail(
  projectId: string | undefined,
): Async<ProjectDetailResponse> {
  return useFetch<ProjectDetailResponse>(projectId ? `/projects/${projectId}` : null)
}

export function useProjectAttachments(
  projectId: string | undefined,
): Async<ProjectAttachmentResponse[]> {
  return useFetch<ProjectAttachmentResponse[]>(
    projectId ? `/projects/${projectId}/attachments` : null,
  )
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) throw new Error('Copie impossible depuis ce navigateur')
  } finally {
    document.body.removeChild(textarea)
  }
}
