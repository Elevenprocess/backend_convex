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
  timeoutMs?: number
}

export async function api<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const { method = 'GET', body, query, signal, timeoutMs = 25_000 } = opts
  const timeoutController = new AbortController()
  const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs)
  const combinedSignal = signal ? anySignal([signal, timeoutController.signal]) : timeoutController.signal

  const url = new URL(buildApiUrl(path))
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }

  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: combinedSignal,
    headers: { Accept: 'application/json' },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetch(url.toString(), init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(408, 'La requête a expiré. Réessaie dans quelques secondes.', 'TIMEOUT')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  const text = await res.text()
  const data = text ? safeParse(text) : null

  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'message' in data && (data as { message?: string }).message) ||
      `${res.status} ${res.statusText}`
    const code = data && typeof data === 'object' && 'code' in data ? (data as { code?: string }).code : undefined
    throw new ApiError(res.status, String(msg), code)
  }
  return data as T
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()

  const abort = () => controller.abort()
  for (const signal of signals) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }

  return controller.signal
}

export { API_BASE }
