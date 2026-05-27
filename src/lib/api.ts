import type { Devis } from './types'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

function buildApiUrl(path: string): string {
  if (path.startsWith('http')) return path

  const base = API_BASE.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  // In production, VITE_API_URL can point to the public /api prefix so SPA
  // routes like /leads keep rendering the React page instead of raw JSON.
  // Keep better-auth paths as /api/auth/*, not /api/api/auth/*.
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base.slice(0, -4)}${normalizedPath}`
  }

  return `${base}${normalizedPath}`
}

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type FetchOpts = {
  method?: string
  body?: unknown
  query?: Record<string, string | number | undefined | null>
  signal?: AbortSignal
}

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = opts

  const url = new URL(buildApiUrl(path))
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }

  const init: RequestInit = {
    method,
    credentials: 'include',
    signal,
    headers: { Accept: 'application/json' },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  // Impersonation : si un viewAsUserId est mémorisé (admin → quiconque,
  // commercial → setter en lecture seule), on l'envoie en header pour que
  // le back applique les permissions de l'overlay sur les GET.
  if (typeof window !== 'undefined') {
    const viewAsId = window.localStorage.getItem('ecoi.viewAsUserId')
    if (viewAsId) {
      ;(init.headers as Record<string, string>)['X-View-As-User-Id'] = viewAsId
    }
  }

  const res = await fetch(url.toString(), init)
  const text = await res.text()
  const data = text ? safeParse(text) : null

  if (!res.ok) {
    const msg = extractApiErrorMessage(data, `${res.status} ${res.statusText}`)
    const code = data && typeof data === 'object' && 'code' in data ? (data as { code?: string }).code : undefined
    throw new ApiError(res.status, msg, code)
  }
  return data as T
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

function extractApiErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string') return data || fallback
  if (!data || typeof data !== 'object') return fallback
  const obj = data as Record<string, unknown>
  const message = obj.message
  const fromMessage = formatUnknownErrorMessage(message)
  if (fromMessage) return fromMessage
  const fromErrors = formatUnknownErrorMessage(obj.errors)
  if (fromErrors) return fromErrors
  const fromDetails = formatUnknownErrorMessage(obj.details)
  if (fromDetails) return fromDetails
  return fallback
}

function formatUnknownErrorMessage(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.map(formatUnknownErrorMessage).filter(Boolean)
    return parts.length ? parts.join(' · ') : null
  }
  if (typeof value !== 'object') return String(value)

  const obj = value as Record<string, unknown>
  if (Array.isArray(obj.issues)) return formatZodIssues(obj.issues)
  if (Array.isArray(obj.errors)) return formatZodIssues(obj.errors)
  if (typeof obj.message === 'string') return obj.message
  return JSON.stringify(obj)
}

function formatZodIssues(issues: unknown[]): string | null {
  const parts = issues.map((issue) => {
    if (!issue || typeof issue !== 'object') return String(issue)
    const obj = issue as Record<string, unknown>
    const path = Array.isArray(obj.path) ? obj.path.join('.') : ''
    const message = typeof obj.message === 'string' ? obj.message : 'valeur invalide'
    return path ? `${path}: ${message}` : message
  })
  return parts.length ? parts.join(' · ') : null
}

// ─── Devis (Solteo PDF integration) ──────────────────────
// Upload uses FormData (multipart), so we bypass the generic `api<T>` helper
// which assumes JSON. The other two endpoints use the standard helper.
export async function uploadDevis(
  leadId: string,
  rdvId: string | undefined,
  file: File,
): Promise<Devis> {
  const fd = new FormData()
  fd.append('leadId', leadId)
  if (rdvId) fd.append('rdvId', rdvId)
  fd.append('file', file)
  const url = buildApiUrl('/devis')
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Upload devis failed: ${res.status}`)
  }
  return res.json() as Promise<Devis>
}

export function listDevisByLead(leadId: string): Promise<Devis[]> {
  return api<Devis[]>(`/devis/lead/${leadId}`)
}

export function markDevisSigned(devisId: string): Promise<Devis> {
  return api<Devis>(`/devis/${devisId}/mark-signed`, { method: 'POST' })
}

export { API_BASE }
