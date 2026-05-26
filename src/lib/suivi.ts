import type { IconName } from '../components/Icon'
import type { LeadResponse, RdvResponse, UserResponse } from './types'

// ---- Types ----
export type NodeStatus = 'todo' | 'active' | 'done' | 'blocked' | 'lost'
export type PayMode = 'comptant' | 'financement'
export type PrimeMode = 'revente_edf' | 'region'
export type SuiviPeriodMode = 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom'
export type SuiviPeriodState = { mode: SuiviPeriodMode; customFrom: string; customTo: string }
export type SuiviPeriodRange = { from: Date; to: Date; label: string }

export type StepId =
  | 'signed'
  | 'prime'
  | 'vt_plan'
  | 'vt_done'
  | 'vt_valid'
  | 'payment_1'
  | 'mandat_dp'
  | 'cno'
  | 'payment_final'
  | 'install'
  | 'satisfaction'
  | 'upsell'

export type WorkflowStep = {
  id: StepId
  label: string
  short: string
  detail: string
  owner: 'AD' | 'Technique' | 'Technicien' | 'Commercial'
  icon: IconName
}

export type SuiviState = {
  payMode: PayMode
  primeMode: PrimeMode
  statuses: Partial<Record<StepId, NodeStatus>>
  dates: Partial<Record<StepId, string>>
  notes: Partial<Record<StepId, string>>
}

export type Dossier = {
  id: string
  lead: LeadResponse
  rdv?: RdvResponse
  commercial?: UserResponse
  setter?: UserResponse
  amount: number
  signedAt: string
  state: SuiviState
  activeStep: StepId
  progress: number
}

// ---- Constantes ----
export const STORAGE_PREFIX = 'ecoi.suivi.workflow.v1:'

export const WORKFLOW: WorkflowStep[] = [
  { id: 'signed', label: 'Devis signé', short: 'START', detail: 'Dossier commercial validé, suivi livraison ouvert.', owner: 'Commercial', icon: 'trophy' },
  { id: 'prime', label: 'Prime / T0', short: 'EDF / Région', detail: 'Revente EDF : demande T0 + prime PK. Région : dossier prime à remplir et signer.', owner: 'AD', icon: 'shield' },
  { id: 'vt_plan', label: 'Planifier VT', short: '72h', detail: 'Planifier la visite technique si possible sous 72h et prévenir le technicien.', owner: 'Technique', icon: 'calendar' },
  { id: 'vt_done', label: 'VT réalisée', short: 'Terrain', detail: 'Le technicien appelle avant la VT puis réalise la visite technique.', owner: 'Technicien', icon: 'home' },
  { id: 'vt_valid', label: 'VT validée ?', short: 'Go / perdu', detail: 'Si non validée : fin devis perdu. Si oui : point WhatsApp + suite administrative.', owner: 'Technique', icon: 'check' },
  { id: 'payment_1', label: 'Acomptes', short: '40% + 20%', detail: 'Comptant : 40% acompte puis 20% après VT. Financement : demande financement, sans acomptes.', owner: 'AD', icon: 'tag' },
  { id: 'mandat_dp', label: 'Mandat + DP mairie', short: 'Admin', detail: 'Faire demande de mandat puis déclaration préalable auprès de la mairie concernée.', owner: 'AD', icon: 'mail' },
  { id: 'cno', label: 'CNO validé ?', short: 'Validation', detail: 'Réception certificat de non-opposition. Si refus DP : fin devis perdu.', owner: 'AD', icon: 'shield' },
  { id: 'payment_final', label: 'Paiements finaux', short: '20% + 20%', detail: 'Après CNO : 20%. Avant installation : 20% restant. Financement : non applicable.', owner: 'AD', icon: 'tag' },
  { id: 'install', label: 'Installation', short: 'Pose', detail: "Planifier l'installation, début pose, fin pose, point WhatsApp.", owner: 'Technique', icon: 'settings' },
  { id: 'satisfaction', label: 'Satisfaction client', short: 'Enquête', detail: 'Enquête satisfaction après installation et clôture qualité.', owner: 'AD', icon: 'message' },
  { id: 'upsell', label: 'Upsell possible', short: 'FIN', detail: 'Dossier terminé, opportunité upsell ou recommandation.', owner: 'Commercial', icon: 'sparkles' },
]

export const DEFAULT_STATE: SuiviState = {
  payMode: 'comptant',
  primeMode: 'revente_edf',
  statuses: { signed: 'done', prime: 'active' },
  dates: {},
  notes: {},
}

export const SUIVI_PERIOD_OPTIONS: { id: SuiviPeriodMode; label: string }[] = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'this_week', label: 'Cette semaine' },
  { id: 'this_month', label: 'Ce mois-ci' },
  { id: 'this_year', label: 'Cette année' },
]

export function getDefaultSuiviPeriod(): SuiviPeriodState {
  const today = toDateInputValue(new Date())
  return { mode: 'this_month', customFrom: today, customTo: today }
}

// ---- LocalStorage ----
export function readWorkflowState(id: string): SuiviState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`)
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } as SuiviState : DEFAULT_STATE
  } catch {
    return DEFAULT_STATE
  }
}

export function writeWorkflowState(id: string, state: SuiviState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(state))
}

// ---- Helpers dossier ----
export function buildDossiers(
  leads: LeadResponse[],
  rdvs: RdvResponse[],
  users: UserResponse[],
  states: Record<string, SuiviState>,
): Dossier[] {
  const userMap = new Map(users.map((u) => [u.id, u]))
  const rdvsByLead = new Map<string, RdvResponse[]>()
  for (const rdv of rdvs) {
    const list = rdvsByLead.get(rdv.leadId) ?? []
    list.push(rdv)
    rdvsByLead.set(rdv.leadId, list)
  }
  for (const list of rdvsByLead.values()) {
    list.sort((a, b) => new Date(b.signatureAt ?? b.scheduledAt ?? b.updatedAt).getTime() - new Date(a.signatureAt ?? a.scheduledAt ?? a.updatedAt).getTime())
  }

  const rows = leads
    .filter((lead) => isQualifiedForSuivi(lead, rdvsByLead.get(lead.id)))
    .map((lead) => {
      const rdv = rdvsByLead.get(lead.id)?.[0]
      const commercialId = rdv?.commercialId ?? lead.latestRdvCommercialId ?? lead.assignedToId
      const setter = lead.setterId ? userMap.get(lead.setterId) : undefined
      return buildDossier(lead, rdv, commercialId ? userMap.get(commercialId) : undefined, setter, states[lead.id] ?? readWorkflowState(lead.id))
    })

  return rows.sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime())
}

function isQualifiedForSuivi(lead: LeadResponse, rdvs: RdvResponse[] | undefined): boolean {
  if (lead.status === 'signe') return true
  return Boolean(rdvs?.some((rdv) => rdv.result === 'signe' || Boolean(rdv.signatureAt)))
}

export function buildDossier(
  lead: LeadResponse,
  rdv: RdvResponse | undefined,
  commercial: UserResponse | undefined,
  setter: UserResponse | undefined,
  state: SuiviState,
): Dossier {
  const activeStep = inferActiveStep(state)
  return {
    id: lead.id,
    lead,
    rdv,
    commercial,
    setter,
    amount: Number(rdv?.montantTotal ?? lead.monetaryValue ?? 0) || 0,
    signedAt: rdv?.signatureAt ?? lead.latestRdvAt ?? lead.lastStageChangeAt ?? lead.updatedAt,
    state,
    activeStep,
    progress: Math.round((WORKFLOW.filter((s) => (state.statuses[s.id] ?? statusForId(activeStep, s.id)) === 'done').length / WORKFLOW.length) * 100),
  }
}

export function inferActiveStep(state: SuiviState): StepId {
  const lost = WORKFLOW.find((s) => state.statuses[s.id] === 'lost')
  if (lost) return lost.id
  const blocked = WORKFLOW.find((s) => state.statuses[s.id] === 'blocked')
  if (blocked) return blocked.id
  return WORKFLOW.find((s) => (state.statuses[s.id] ?? 'todo') !== 'done')?.id ?? 'upsell'
}

export function statusForStep(dossier: Dossier | null, step: StepId): NodeStatus {
  if (!dossier) return 'todo'
  return statusForId(dossier.activeStep, step)
}

export function statusForId(active: StepId, step: StepId): NodeStatus {
  const activeIndex = stepIndex(active)
  const index = stepIndex(step)
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'todo'
}

export function stepIndex(id: StepId): number {
  return Math.max(0, WORKFLOW.findIndex((s) => s.id === id))
}

export function stepLabel(id: StepId): string {
  return WORKFLOW.find((s) => s.id === id)?.label ?? id
}

export function nodeDetail(step: WorkflowStep, state: SuiviState): string {
  if (step.id === 'prime') return state.primeMode === 'region' ? 'Dossier Région : faire remplir la prime Région, signature client, prévenir responsable technique.' : 'Revente EDF : demande T0 à EDF, déclenchement prime PK, prévenir responsable technique.'
  if (step.id === 'payment_1' || step.id === 'payment_final') return state.payMode === 'financement' ? "Financement : process identique, sans les appels d'acomptes." : step.detail
  return step.detail
}

// ---- Helpers date / format ----
export function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function buildSuiviPeriodRange(period: SuiviPeriodState): SuiviPeriodRange {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
  if (period.mode === 'today') {
    start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999)
    return { from: start, to: end, label: "Aujourd'hui" }
  }
  if (period.mode === 'this_week') {
    const monday = startOfWeek(now)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 999)
    return { from: monday, to: sunday, label: 'Cette semaine' }
  }
  if (period.mode === 'this_month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { from: first, to: last, label: 'Ce mois-ci' }
  }
  if (period.mode === 'this_year') {
    const first = new Date(now.getFullYear(), 0, 1)
    const last = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    return { from: first, to: last, label: 'Cette année' }
  }
  let from = new Date(period.customFrom + 'T00:00:00')
  let to = new Date(period.customTo + 'T23:59:59')
  if (from > to) {
    const swapped = from
    from = new Date(to); from.setHours(0, 0, 0, 0)
    to = new Date(swapped); to.setHours(23, 59, 59, 999)
  }
  return { from, to, label: `${formatDate(from.toISOString())} → ${formatDate(to.toISOString())}` }
}

export function isDateInRange(value: string, from: Date, to: Date): boolean {
  const t = new Date(value).getTime()
  return !Number.isNaN(t) && t >= from.getTime() && t <= to.getTime()
}

function startOfWeek(d: Date): Date {
  const next = new Date(d); next.setHours(0, 0, 0, 0)
  const day = next.getDay() || 7
  next.setDate(next.getDate() - day + 1)
  return next
}

export function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

export function formatRelativeDate(value: string): string {
  const now = Date.now()
  const t = new Date(value).getTime()
  const days = Math.floor((now - t) / (1000 * 60 * 60 * 24))
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} j`
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem`
  return formatDate(value)
}
