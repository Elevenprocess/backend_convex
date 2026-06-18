import type {
  AcompteResponse,
  AdChannel,
  AdsLevel,
  AdsReport,
  RecordEcheancePatch,
  ClientResponse,
  CommercialObjectiveResponse,
  DebriefResponse,
  Devis,
  LeadResponse,
  NotificationResponse,
  ProjectAttachmentKind,
  ProjectAttachmentResponse,
  ProjectDetailResponse,
  ProjectResponse,
  ProjectStatus,
  SourceMapEntry,
  SubstepResponse,
  SubstepDocument,
  UnmappedSource,
  UpdateSubstepPatch,
  UpsertCommercialObjectivePayload,
} from './types'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export function buildApiUrl(path: string): string {
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
  meta?: { projectName?: string; installationAddress?: string; projectId?: string },
): Promise<Devis> {
  const fd = new FormData()
  fd.append('leadId', leadId)
  if (rdvId) fd.append('rdvId', rdvId)
  if (meta?.projectId) fd.append('projectId', meta.projectId)
  const name = meta?.projectName?.trim()
  const addr = meta?.installationAddress?.trim()
  const parts = ([name, addr].filter(Boolean) as string[]).map(sanitizeFileName)
  const renamed = parts.length
    ? new File([file], `${parts.join(' — ')} — ${file.name}`, { type: file.type })
    : file
  fd.append('file', renamed)
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

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'Projet'
}

// Parse "Nom — Adresse — fichier.pdf" produit par uploadDevis() ci-dessus.
export function parseProjectMeta(filename: string): { name: string; address: string | null; rawFilename: string } {
  const parts = filename.split(' — ')
  if (parts.length >= 3) {
    return { name: parts[0], address: parts[1] || null, rawFilename: parts.slice(2).join(' — ') }
  }
  if (parts.length === 2) {
    return { name: parts[0], address: null, rawFilename: parts[1] }
  }
  return { name: filename.replace(/\.pdf$/i, ''), address: null, rawFilename: filename }
}

// ─── Leads : attribution / partage ───────────────────────
// « Donner » un client à un commercial = transfert de propriété (leads.assignedToId).
// Côté backend, les RDV à venir suivent le client (cf. spec attribution-partage-client).
// Réservé admin / commercial_lead (garde @Roles côté API).
export function assignLeadToCommercial(leadId: string, commercialId: string): Promise<LeadResponse> {
  return api<LeadResponse>(`/leads/${leadId}/assign`, { method: 'POST', body: { commercialId } })
}

export function assignTechnicienVt(
  clientId: string,
  technicienVtId: string | null,
): Promise<ClientResponse> {
  return api<ClientResponse>(`/clients/${clientId}`, {
    method: 'PATCH',
    body: { technicienVtId },
  })
}

/** Initialise un dossier (client + workflow) pour un lead signé sans client. */
export function bootstrapClient(leadId: string): Promise<ClientResponse> {
  return api<ClientResponse>('/clients/bootstrap', {
    method: 'POST',
    body: { leadId },
  })
}

/**
 * Initialise un dossier indépendant scopé à un PROJET précis (workflow propre
 * à ce projet, distinct des autres projets du même lead).
 */
export function bootstrapClientForProject(projectId: string): Promise<ClientResponse> {
  return api<ClientResponse>('/clients/bootstrap', {
    method: 'POST',
    body: { projectId },
  })
}

export function getSubsteps(clientId: string): Promise<SubstepResponse[]> {
  return api<SubstepResponse[]>('/substeps', { query: { clientId } })
}

export function updateSubstep(
  substepId: string,
  patch: UpdateSubstepPatch,
): Promise<SubstepResponse> {
  return api<SubstepResponse>(`/substeps/${substepId}`, { method: 'PATCH', body: patch })
}

export function resolveSubstepProblem(
  substepId: string,
  status: SubstepResponse['status'],
): Promise<SubstepResponse> {
  return api<SubstepResponse>(`/substeps/${substepId}/resolve-problem`, { method: 'POST', body: { status } })
}

// ─── Finances : acomptes ─────────────────────────────────────
export function listAcomptes(): Promise<AcompteResponse[]> {
  return api<AcompteResponse[]>('/payments/acomptes')
}

// Enregistre l'encaissement d'une tranche de l'échéancier (ordre dans le body).
export function recordEcheance(
  debriefId: string,
  patch: RecordEcheancePatch,
): Promise<AcompteResponse> {
  return api<AcompteResponse>(`/payments/acomptes/${debriefId}/echeances`, { method: 'PATCH', body: patch })
}

export function getDevis(devisId: string): Promise<Devis> {
  return api<Devis>(`/devis/${devisId}`)
}

export function listDevisByLead(leadId: string): Promise<Devis[]> {
  return api<Devis[]>(`/devis/lead/${leadId}`)
}

export function markDevisSigned(devisId: string): Promise<Devis> {
  return api<Devis>(`/devis/${devisId}/mark-signed`, { method: 'POST' })
}

// Patch partiel. Tous les champs sont optionnels ; `null` efface une valeur.
export function updateDevis(
  devisId: string,
  patch: import('./types').UpdateDevisPatch,
): Promise<Devis> {
  return api<Devis>(`/devis/${devisId}`, { method: 'PATCH', body: patch })
}

export function retryDevisOcr(devisId: string): Promise<Devis> {
  return api<Devis>(`/devis/${devisId}/retry-ocr`, { method: 'POST' })
}

export function deleteDevis(devisId: string): Promise<{ id: string; deleted: true }> {
  return api(`/devis/${devisId}`, { method: 'DELETE' })
}

/**
 * Suit l'avancement de l'OCR d'un devis fraîchement déposé : interroge
 * GET /devis/:id jusqu'à ce que l'OCR soit terminé (`done`) ou en échec
 * (`failed`), ou jusqu'au timeout. Renvoie le devis final. `onTick` permet de
 * rafraîchir l'UI à chaque sondage (ex. réafficher la fiche projet).
 */
export async function pollDevisOcr(
  devisId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (d: Devis) => void } = {},
): Promise<Devis> {
  const intervalMs = opts.intervalMs ?? 1500
  const timeoutMs = opts.timeoutMs ?? 90_000
  const started = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const d = await getDevis(devisId)
    opts.onTick?.(d)
    if (d.ocrStatus === 'done' || d.ocrStatus === 'failed') return d
    if (Date.now() - started > timeoutMs) return d
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

export async function downloadDevisPdf(devisId: string, suggestedName?: string): Promise<void> {
  const res = await fetch(buildApiUrl(`/devis/${devisId}/pdf`), {
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Téléchargement échoué : ${res.status}`)
  }
  const blob = await res.blob()
  let filename = suggestedName ?? `devis-${devisId}.pdf`
  const cd = res.headers.get('content-disposition')
  if (cd) {
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match) filename = decodeURIComponent(utf8Match[1])
    else {
      const plain = cd.match(/filename="([^"]+)"/i)
      if (plain) filename = plain[1]
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Récupère le PDF d'un devis et renvoie un object URL (à révoquer par l'appelant
 * via URL.revokeObjectURL). On passe par le blob de la route /devis/:id/pdf (binaire
 * renvoyé directement) au lieu d'une URL signée, ce qui évite les URL file:// bloquées
 * par le navigateur en dev.
 */
export async function fetchDevisPdfObjectUrl(devisId: string): Promise<string> {
  const res = await fetch(buildApiUrl(`/devis/${devisId}/pdf`), {
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Chargement du PDF échoué : ${res.status}`)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// ─── Projects ─────────────────────────────────────────────
export function createProject(input: {
  leadId: string
  name: string
  addressLine?: string | null
  postalCode?: string | null
  city?: string | null
  notes?: string | null
}): Promise<ProjectResponse> {
  return api<ProjectResponse>('/projects', { method: 'POST', body: input })
}

export function listProjectsByLead(leadId: string): Promise<ProjectResponse[]> {
  return api<ProjectResponse[]>(`/projects/lead/${leadId}`)
}

export function getProjectDetail(projectId: string): Promise<ProjectDetailResponse> {
  return api<ProjectDetailResponse>(`/projects/${projectId}`)
}

export function updateProject(
  projectId: string,
  patch: { name?: string; status?: ProjectStatus; notes?: string | null; addressLine?: string | null; postalCode?: string | null; city?: string | null },
): Promise<ProjectResponse> {
  return api<ProjectResponse>(`/projects/${projectId}`, { method: 'PATCH', body: patch })
}

export function deleteProject(projectId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/projects/${projectId}`, { method: 'DELETE' })
}

// ─── Debriefs ─────────────────────────────────────────────
export function createDebrief(
  projectId: string,
  input: Partial<Omit<DebriefResponse, 'id' | 'projectId' | 'commercialId' | 'createdAt' | 'updatedAt'>> & { outcome: DebriefResponse['outcome'] },
): Promise<DebriefResponse> {
  return api<DebriefResponse>(`/projects/${projectId}/debriefs`, { method: 'POST', body: input })
}

export function createLeadDebrief(
  leadId: string,
  input: Partial<Omit<DebriefResponse, 'id' | 'commercialId' | 'createdAt' | 'updatedAt'>> & { outcome: DebriefResponse['outcome'] },
): Promise<DebriefResponse> {
  return api<DebriefResponse>(`/leads/${leadId}/debriefs`, { method: 'POST', body: input })
}

export function listDebriefsByProject(projectId: string): Promise<DebriefResponse[]> {
  return api<DebriefResponse[]>(`/projects/${projectId}/debriefs`)
}

export function listDebriefsByLead(leadId: string): Promise<DebriefResponse[]> {
  return api<DebriefResponse[]>(`/leads/${leadId}/debriefs`)
}

export function deleteDebrief(debriefId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/debriefs/${debriefId}`, { method: 'DELETE' })
}

// ─── Project attachments ──────────────────────────────────
export async function uploadProjectAttachment(
  projectId: string,
  file: File,
  opts: { kind: ProjectAttachmentKind; label?: string | null },
): Promise<ProjectAttachmentResponse> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', opts.kind)
  if (opts.label) fd.append('label', opts.label)
  const res = await fetch(buildApiUrl(`/projects/${projectId}/attachments`), {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Upload attachment failed: ${res.status}`)
  }
  return res.json() as Promise<ProjectAttachmentResponse>
}

export function listAttachmentsByProject(
  projectId: string,
): Promise<ProjectAttachmentResponse[]> {
  return api<ProjectAttachmentResponse[]>(`/projects/${projectId}/attachments`)
}

export function getAttachmentSignedUrl(
  attachmentId: string,
): Promise<{ url: string; filename: string; contentType: string }> {
  return api<{ url: string; filename: string; contentType: string }>(
    `/attachments/${attachmentId}/url`,
  )
}

/**
 * URL directe vers les octets de l'attachment, streamés par l'API (route
 * `/attachments/:id/raw`). Utilisable dans un <img src> ou window.open —
 * fonctionne en dev (local-FS) comme en prod (R2), contrairement à
 * getAttachmentSignedUrl qui renvoie un file:// inexploitable en local.
 */
// ─── Objectifs commerciaux (mensuels, par commercial) ─────
export async function listCommercialObjectives(period: string): Promise<CommercialObjectiveResponse[]> {
  return api('/commercial-objectives', { query: { period } })
}

export async function upsertCommercialObjective(
  payload: UpsertCommercialObjectivePayload,
): Promise<CommercialObjectiveResponse> {
  return api('/commercial-objectives', { method: 'PUT', body: payload })
}

export function attachmentRawUrl(attachmentId: string): string {
  return buildApiUrl(`/attachments/${attachmentId}/raw`)
}

/**
 * Récupère le binaire d'une pièce jointe (photo/document) via fetch authentifié
 * (cookie de session) et renvoie un object URL. Indispensable pour afficher une
 * image dans <img> : le endpoint /attachments/:id/raw est protégé, une URL brute
 * en src échouerait (401/403). À révoquer (URL.revokeObjectURL) au démontage.
 */
export async function fetchAttachmentObjectUrl(attachmentId: string): Promise<string> {
  const res = await fetch(buildApiUrl(`/attachments/${attachmentId}/raw`), {
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Chargement du fichier échoué : ${res.status}`)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

export function deleteProjectAttachment(attachmentId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/attachments/${attachmentId}`, { method: 'DELETE' })
}

// ─── Documents de sous-étape (pièces du workflow) ─────────
/** Upload multiple, tout type de fichier, sur une sous-étape. */
export async function uploadSubstepDocuments(
  substepId: string,
  files: File[],
): Promise<SubstepDocument[]> {
  const fd = new FormData()
  for (const file of files) fd.append('files', file)
  const res = await fetch(buildApiUrl(`/substeps/${substepId}/documents`), {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Upload document échoué : ${res.status}`)
  }
  return res.json() as Promise<SubstepDocument[]>
}

export function deleteSubstepDocument(documentId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/documents/${documentId}`, { method: 'DELETE' })
}

/** URL directe (streamée par l'API) pour ouvrir/télécharger un document. */
export function substepDocumentRawUrl(documentId: string): string {
  return buildApiUrl(`/documents/${documentId}/raw`)
}

/**
 * Détecte le type d'un fichier via ses octets magiques (signatures). Indispensable
 * quand le mimeType stocké est générique (`application/octet-stream`) ou que le nom
 * n'a pas d'extension : sans ça l'aperçu tombe en « type non supporté ».
 */
function sniffMimeFromBytes(b: Uint8Array): string | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf' // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp' // RIFF…WEBP
  return null
}

/**
 * Récupère le binaire d'un document de sous-étape via fetch authentifié (cookie
 * de session) et renvoie un object URL + le type MIME réel. On passe par un blob
 * (et non l'URL brute en src) car un `blob:` s'affiche toujours inline dans une
 * <img>/<iframe>, ce qui évite les soucis d'aperçu cross-origin ; et on renifle
 * les octets pour fiabiliser le type même si le mimeType en base est faux.
 * À révoquer (URL.revokeObjectURL) au démontage.
 */
export async function fetchSubstepDocumentObjectUrl(
  documentId: string,
): Promise<{ url: string; mimeType: string | null }> {
  const res = await fetch(buildApiUrl(`/documents/${documentId}/raw`), {
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Chargement du document échoué : ${res.status}`)
  }
  const blob = await res.blob()
  let sniffed: string | null = null
  try {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
    sniffed = sniffMimeFromBytes(head)
  } catch {
    // arrayBuffer indisponible → on retombe sur blob.type / mimeType en base
  }
  const fromBlob = blob.type && blob.type !== 'application/octet-stream' ? blob.type : null
  return { url: URL.createObjectURL(blob), mimeType: sniffed ?? fromBlob }
}

// ─── Ads / ROAS (Meta tracking) ───────────────────────────
// Rapport ROAS cohorte par campagne/adset/ad. Réservé admin + commercial_lead
// (garde @Roles côté API). `level` pilote le niveau de drill-down.
export function fetchAdsReport(params: {
  from: string
  to: string
  level?: AdsLevel
  channel?: AdChannel
}): Promise<AdsReport> {
  return api<AdsReport>('/analytics/ads', {
    query: {
      from: params.from,
      to: params.to,
      level: params.level ?? 'campaign',
      channel: params.channel ?? 'meta',
    },
  })
}

/** Resync / backfill de la dépense publicitaire (admin). */
export function resyncAdSpend(body: { from: string; to: string }): Promise<{
  synced: number
  totalSpend: string
  skipped: boolean
}> {
  return api('/ad-spend/sync', { method: 'POST', body })
}

/** Liste du mapping source brute → canal (admin). */
export function fetchSourceMap(): Promise<SourceMapEntry[]> {
  return api<SourceMapEntry[]>('/source-map')
}

/** Sources GHL brutes non encore classées (canal = other), avec leur volume (admin). */
export function fetchUnmappedSources(): Promise<UnmappedSource[]> {
  return api<UnmappedSource[]>('/source-map/unmapped')
}

/** Crée/met à jour un mapping. `reapply` rejoue le classifieur sur les leads existants (admin). */
export function upsertSourceMap(body: {
  rawSource: string
  channel: AdChannel
  label: string
  reapply?: boolean
}): Promise<SourceMapEntry> {
  return api<SourceMapEntry>('/source-map', { method: 'POST', body })
}

// ─── Notifications ─────────────────────────────────────────
export function markNotificationRead(id: string): Promise<NotificationResponse> {
  return api<NotificationResponse>(`/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead(): Promise<{ ok: true }> {
  return api<{ ok: true }>('/notifications/read-all', { method: 'POST' })
}

export { API_BASE }
