import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import { notifyClipboardCopied } from './clipboardToast'
import { REALTIME_REFRESH_EVENT, type RealtimeRefreshPayload } from './realtime'
import type {
  CallLogResponse,
  InvitationResponse,
  LeadResponse,
  LeadStatus,
  RdvLocation,
  RdvResponse,
  UserResponse,
  AnalyticsResponse,
} from './types'

type Async<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

type FetchCacheEntry = {
  data: unknown
  timestamp: number
}

const FETCH_CACHE_TTL_MS = 5 * 60 * 1000
const fetchCache = new Map<string, FetchCacheEntry>()

function buildFetchCacheKey(path: string | null, queryKey: string): string | null {
  return path === null ? null : `${path}?${queryKey}`
}

function readCachedEntry(cacheKey: string | null): FetchCacheEntry | null {
  if (!cacheKey) return null
  const entry = fetchCache.get(cacheKey)
  if (!entry) return null
  if (Date.now() - entry.timestamp > FETCH_CACHE_TTL_MS) {
    fetchCache.delete(cacheKey)
    return null
  }
  return entry
}

function readCachedData<T>(cacheKey: string | null): T | null {
  return (readCachedEntry(cacheKey)?.data as T | undefined) ?? null
}

// useFetch: passe `path = null` pour désactiver le fetch (utile quand l'id n'existe pas encore).
// Les réponses récentes restent en mémoire pour réafficher instantanément les pages lourdes
// après une navigation, puis l'API est rafraîchie en arrière-plan.
function useFetch<T>(
  path: string | null,
  query?: Record<string, string | number | undefined | null>,
): Async<T> {
  const queryKey = JSON.stringify(query ?? {})
  const cacheKey = buildFetchCacheKey(path, queryKey)
  const cachedData = readCachedData<T>(cacheKey)
  const [data, setData] = useState<T | null>(cachedData)
  const [loading, setLoading] = useState(path !== null && cachedData === null)
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
    if (latestCachedEntry && tick === 0) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(latestCachedData === undefined)
    setError(null)
    api<T>(path, { query, signal: ctrl.signal })
      .then((d) => {
        if (ctrl.signal.aborted) return
        if (cacheKey) fetchCache.set(cacheKey, { data: d, timestamp: Date.now() })
        setData(d)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        const msg = e instanceof ApiError ? `${e.status} — ${e.message}` : (e as Error).message
        setError(msg)
        if (latestCachedData === undefined) setData(null)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, queryKey, tick])

  useEffect(() => {
    if (path === null) return
    const onRealtimeRefresh = (event: Event) => {
      const detail = (event as CustomEvent<RealtimeRefreshPayload>).detail
      if (!detail?.paths?.some((prefix) => path.startsWith(prefix))) return
      for (const key of Array.from(fetchCache.keys())) {
        if (detail.paths.some((prefix) => key.startsWith(`${prefix}?`))) fetchCache.delete(key)
      }
      setTick((t) => t + 1)
    }
    window.addEventListener(REALTIME_REFRESH_EVENT, onRealtimeRefresh)
    return () => window.removeEventListener(REALTIME_REFRESH_EVENT, onRealtimeRefresh)
  }, [path])

  return { data, loading, error, refetch: () => setTick((t) => t + 1) }
}

// ─── Leads ─────────────────────────────────────────────────
export function useLeads(filters?: {
  status?: LeadStatus
  setterId?: string
  assignedToId?: string
  city?: string
  limit?: number
  offset?: number
}): Async<LeadResponse[]> {
  return useFetch<LeadResponse[]>('/leads', { ...filters, limit: filters?.limit ?? 1500 })
}

export function useLead(id: string | undefined): Async<LeadResponse> {
  return useFetch<LeadResponse>(id ? `/leads/${id}` : null)
}

// ─── RDV ───────────────────────────────────────────────────
export function useRdvList(filters?: {
  leadId?: string
  commercialId?: string
  setterId?: string
  fromDate?: string
  toDate?: string
  limit?: number
}): Async<RdvResponse[]> {
  return useFetch<RdvResponse[]>('/rdv', { ...filters, limit: filters?.limit ?? 200 })
}

export function useRdv(id: string | undefined): Async<RdvResponse> {
  return useFetch<RdvResponse>(id ? `/rdv/${id}` : null)
}

// ─── Users ─────────────────────────────────────────────────
export function useUsers(): Async<UserResponse[]> {
  return useFetch<UserResponse[]>('/users')
}

export function useInvitations(): Async<InvitationResponse[]> {
  return useFetch<InvitationResponse[]>('/users/invitations')
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

export function useUser(id: string | undefined): Async<UserResponse> {
  return useFetch<UserResponse>(id ? `/users/${id}` : null)
}

// ─── Analytics ─────────────────────────────────────────────
export function useAnalyticsSummary(filters: {
  from: string
  to: string
}): Async<AnalyticsResponse> {
  return useFetch<AnalyticsResponse>('/analytics/summary', filters)
}

// ─── Call logs ─────────────────────────────────────────────
export function useCallLogs(filters?: {
  leadId?: string
  setterId?: string
  limit?: number
  offset?: number
}): Async<CallLogResponse[]> {
  return useFetch<CallLogResponse[]>('/call-logs', { ...filters, limit: filters?.limit ?? 50 })
}

export type CreateCallLogInput = {
  leadId: string
  result: CallLogResponse['result']
  nextCallbackAt?: string | null
  notes?: string | null
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

export async function updateLead(id: string, input: UpdateLeadInput): Promise<LeadResponse> {
  return api<LeadResponse>(`/leads/${id}`, { method: 'PATCH', body: input })
}

export type CreateRdvInput = {
  leadId: string
  commercialId?: string | null
  scheduledAt: string
  locationType?: RdvLocation
  notes?: string | null
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
