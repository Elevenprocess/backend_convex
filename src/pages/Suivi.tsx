import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon, type IconName } from '../components/Icon'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers } from '../lib/hooks'
import { fullName, initials, type LeadResponse, type RdvResponse, type UserResponse } from '../lib/types'

type NodeStatus = 'todo' | 'active' | 'done' | 'blocked' | 'lost'
type PayMode = 'comptant' | 'financement'
type PrimeMode = 'revente_edf' | 'region'
type SuiviPeriodMode = 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom'
type SuiviPeriodState = { mode: SuiviPeriodMode; customFrom: string; customTo: string }
type SuiviPeriodRange = { from: Date; to: Date; label: string }
type StepId =
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

type WorkflowStep = {
  id: StepId
  label: string
  short: string
  detail: string
  owner: 'AD' | 'Technique' | 'Technicien' | 'Commercial'
  icon: IconName
}

type SuiviState = {
  payMode: PayMode
  primeMode: PrimeMode
  statuses: Partial<Record<StepId, NodeStatus>>
  dates: Partial<Record<StepId, string>>
  notes: Partial<Record<StepId, string>>
}

type Dossier = {
  id: string
  lead: LeadResponse
  rdv?: RdvResponse
  commercial?: UserResponse
  amount: number
  signedAt: string
  state: SuiviState
  activeStep: StepId
  progress: number
}

const STORAGE_PREFIX = 'ecoi.suivi.workflow.v1:'
const suiviTodayInput = toDateInputValue(new Date())
const DEFAULT_SUIVI_PERIOD: SuiviPeriodState = { mode: 'this_month', customFrom: suiviTodayInput, customTo: suiviTodayInput }
const SUIVI_PERIOD_OPTIONS: { id: SuiviPeriodMode; label: string }[] = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'this_week', label: 'Cette semaine' },
  { id: 'this_month', label: 'Ce mois-ci' },
  { id: 'this_year', label: 'Cette année' },
]

const WORKFLOW: WorkflowStep[] = [
  { id: 'signed', label: 'Devis signé', short: 'START', detail: 'Dossier commercial validé, suivi livraison ouvert.', owner: 'Commercial', icon: 'trophy' },
  { id: 'prime', label: 'Prime / T0', short: 'EDF / Région', detail: 'Revente EDF : demande T0 + prime PK. Région : dossier prime à remplir et signer.', owner: 'AD', icon: 'shield' },
  { id: 'vt_plan', label: 'Planifier VT', short: '72h', detail: 'Planifier la visite technique si possible sous 72h et prévenir le technicien.', owner: 'Technique', icon: 'calendar' },
  { id: 'vt_done', label: 'VT réalisée', short: 'Terrain', detail: 'Le technicien appelle avant la VT puis réalise la visite technique.', owner: 'Technicien', icon: 'home' },
  { id: 'vt_valid', label: 'VT validée ?', short: 'Go / perdu', detail: 'Si non validée : fin devis perdu. Si oui : point WhatsApp + suite administrative.', owner: 'Technique', icon: 'check' },
  { id: 'payment_1', label: 'Acomptes', short: '40% + 20%', detail: 'Comptant : 40% acompte puis 20% après VT. Financement : demande financement, sans acomptes.', owner: 'AD', icon: 'tag' },
  { id: 'mandat_dp', label: 'Mandat + DP mairie', short: 'Admin', detail: 'Faire demande de mandat puis déclaration préalable auprès de la mairie concernée.', owner: 'AD', icon: 'mail' },
  { id: 'cno', label: 'CNO validé ?', short: 'Validation', detail: 'Réception certificat de non-opposition. Si refus DP : fin devis perdu.', owner: 'AD', icon: 'shield' },
  { id: 'payment_final', label: 'Paiements finaux', short: '20% + 20%', detail: 'Après CNO : 20%. Avant installation : 20% restant. Financement : non applicable.', owner: 'AD', icon: 'tag' },
  { id: 'install', label: 'Installation', short: 'Pose', detail: 'Planifier l’installation, début pose, fin pose, point WhatsApp.', owner: 'Technique', icon: 'settings' },
  { id: 'satisfaction', label: 'Satisfaction client', short: 'Enquête', detail: 'Enquête satisfaction après installation et clôture qualité.', owner: 'AD', icon: 'message' },
  { id: 'upsell', label: 'Upsell possible', short: 'FIN', detail: 'Dossier terminé, opportunité upsell ou recommandation.', owner: 'Commercial', icon: 'sparkles' },
]

const DEFAULT_STATE: SuiviState = {
  payMode: 'comptant',
  primeMode: 'revente_edf',
  statuses: { signed: 'done', prime: 'active' },
  dates: {},
  notes: {},
}

export function Suivi() {
  const role = useAuth((s) => s.user?.role)
  const [params, setParams] = useSearchParams()
  const { data: leads, loading: leadsLoading, error: leadsError } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()
  const [query, setQuery] = useState('')
  const [pulseKey, setPulseKey] = useState(0)
  const [states, setStates] = useState<Record<string, SuiviState>>({})
  const [focusStep, setFocusStep] = useState<StepId>('prime')
  const [modalStep, setModalStep] = useState<StepId | null>(null)
  const [period, setPeriod] = useState<SuiviPeriodState>(DEFAULT_SUIVI_PERIOD)
  const periodRange = useMemo(() => buildSuiviPeriodRange(period), [period])

  const allSignedDossiers = useMemo(() => buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states), [leads, rdvs, users, states])
  const signedDossiers = useMemo(() => allSignedDossiers.filter((d) => isDateInRange(d.signedAt, periodRange.from, periodRange.to)), [allSignedDossiers, periodRange])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return signedDossiers
    return signedDossiers.filter((d) => [fullName(d.lead), d.lead.phone, d.lead.email, d.lead.city, d.commercial?.name].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [signedDossiers, query])

  const selectedId = params.get('lead') || filtered[0]?.id || signedDossiers[0]?.id || null
  const selected = signedDossiers.find((d) => d.id === selectedId) ?? signedDossiers[0] ?? null

  useEffect(() => {
    const loaded: Record<string, SuiviState> = {}
    for (const d of signedDossiers) loaded[d.id] = readWorkflowState(d.id)
    setStates((prev) => ({ ...loaded, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedDossiers.map((d) => d.id).join('|')])

  useEffect(() => {
    if (selected) setFocusStep(selected.activeStep)
  }, [selected?.id, selected?.activeStep])

  if (role && role !== 'admin' && role !== 'delivrabilite') return <Navigate to="/overview" replace />

  const updateSelected = (updater: (state: SuiviState) => SuiviState) => {
    if (!selected) return
    setStates((prev) => {
      const nextState = updater(prev[selected.id] ?? readWorkflowState(selected.id))
      writeWorkflowState(selected.id, nextState)
      return { ...prev, [selected.id]: nextState }
    })
  }

  const selectDossier = (id: string) => {
    setParams({ lead: id })
    const dossier = signedDossiers.find((d) => d.id === id)
    if (dossier) setFocusStep(dossier.activeStep)
    setPulseKey((v) => v + 1)
  }

  const selectedStep = WORKFLOW.find((s) => s.id === focusStep) ?? WORKFLOW[0]
  const selectedStatus = selected?.state.statuses[focusStep] ?? statusForStep(selected, focusStep)
  const popupStep = modalStep ? WORKFLOW.find((s) => s.id === modalStep) ?? null : null
  const popupStatus = selected && modalStep ? selected.state.statuses[modalStep] ?? statusForStep(selected, modalStep) : 'todo'

  return (
    <AppShell flat>
      <Topbar eyebrow="DÉLIVRABILITÉ — SUIVI" title="Workflow dossiers signés" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <section className="suivi-hero">
          <div>
            <span className="eyebrow">Pipeline Jenkins · popup n8n</span>
            <h1>Suivi des dossiers signés</h1>
            <p>Choisis une période, clique un module du workflow, puis modifie son avancement dans le popup.</p>
          </div>
          <div className="suivi-hero-kpis">
            <SuiviKpi label="Dossiers signés" value={signedDossiers.length} />
            <SuiviKpi label="En retard / bloqués" value={signedDossiers.filter((d) => d.state.statuses[d.activeStep] === 'blocked').length} />
            <SuiviKpi label="Progression moy." value={`${Math.round(avg(signedDossiers.map((d) => d.progress)))}%`} />
          </div>
        </section>

        <section className="suivi-period-card">
          <div>
            <span className="eyebrow">Période</span>
            <strong>{periodRange.label}</strong>
          </div>
          <div className="suivi-period-actions">
            <div className="suivi-period-switch" aria-label="Période de suivi">
              {SUIVI_PERIOD_OPTIONS.map((option) => (
                <button key={option.id} type="button" className={period.mode === option.id ? 'active' : ''} onClick={() => setPeriod((current) => ({ ...current, mode: option.id }))}>
                  {option.label}
                </button>
              ))}
            </div>
            <label>
              Du
              <input type="date" value={toDateInputValue(periodRange.from)} onChange={(e) => setPeriod((current) => ({ ...current, mode: 'custom', customFrom: e.target.value, customTo: current.mode === 'custom' ? current.customTo : toDateInputValue(periodRange.to) }))} />
            </label>
            <label>
              Au
              <input type="date" value={toDateInputValue(periodRange.to)} onChange={(e) => setPeriod((current) => ({ ...current, mode: 'custom', customFrom: current.mode === 'custom' ? current.customFrom : toDateInputValue(periodRange.from), customTo: e.target.value }))} />
            </label>
          </div>
        </section>

        <section className="suivi-workflow-card">
          <div className="suivi-workflow-head">
            <div className="min-w-0">
              <span className="eyebrow">Workflow actif</span>
              <h2>{selected ? fullName(selected.lead) || selected.lead.phone || 'Prospect signé' : 'Aucun dossier signé'}</h2>
              {selected && <p>{selected.lead.city ?? 'Ville inconnue'} · {formatCurrency(selected.amount)} · {selected.commercial?.name ?? 'Commercial non assigné'}</p>}
            </div>
            {selected && (
              <div className="suivi-switches">
                <label>
                  Prime
                  <select value={selected.state.primeMode} onChange={(e) => updateSelected((s) => ({ ...s, primeMode: e.target.value as PrimeMode }))}>
                    <option value="revente_edf">Revente EDF / T0</option>
                    <option value="region">Dossier Région</option>
                  </select>
                </label>
                <label>
                  Paiement
                  <select value={selected.state.payMode} onChange={(e) => updateSelected((s) => ({ ...s, payMode: e.target.value as PayMode }))}>
                    <option value="comptant">Comptant</option>
                    <option value="financement">Financement</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {leadsLoading || rdvLoading ? <LoadingBlock label="Chargement des dossiers signés…" /> : leadsError ? (
            <div className="py-10 text-center text-rouille text-sm">Erreur : {leadsError}</div>
          ) : selected ? (
            <>
              <div className="suivi-workflow-rail" key={`${selected.id}-${pulseKey}`}>
                {WORKFLOW.map((step, index) => {
                  const status = selected.state.statuses[step.id] ?? statusForStep(selected, step.id)
                  const focused = step.id === focusStep
                  const passed = stepIndex(selected.activeStep) >= index
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => {
                        setFocusStep(step.id)
                        setModalStep(step.id)
                      }}
                      className={`suivi-node is-${status} ${focused ? 'is-focused' : ''} ${passed ? 'is-passed' : ''}`}
                    >
                      <span className="suivi-node-dot"><Icon name={step.icon} size={15} /></span>
                      <span className="suivi-node-copy">
                        <strong>{step.label}</strong>
                        <small>{step.short}</small>
                      </span>
                    </button>
                  )
                })}
                <span className="suivi-position" style={{ left: `${workflowLeft(selected.activeStep)}%` }} />
              </div>

              <div className="suivi-selected-node">
                <span className={`suivi-mini-dot is-${selectedStatus}`}><Icon name={selectedStep.icon} size={14} /></span>
                <span><strong>{selectedStep.label}</strong><small>{nodeDetail(selectedStep, selected.state)}</small></span>
                <button type="button" onClick={() => setModalStep(focusStep)}>Modifier ce module</button>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-muted">Aucun devis signé trouvé pour ouvrir un suivi.</div>
          )}
        </section>

        <section className="suivi-list-card">
          <div className="suivi-list-head">
            <div>
              <span className="eyebrow">Liste dossiers</span>
              <h3>Prospects signés à suivre</h3>
            </div>
            <div className="suivi-search"><Icon name="search" size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher nom, ville, commercial…" /></div>
          </div>
          <div className="suivi-table">
            {filtered.map((d) => (
              <button key={d.id} type="button" onClick={() => selectDossier(d.id)} className={`suivi-row ${selected?.id === d.id ? 'is-selected' : ''}`}>
                <span className="suivi-avatar">{initials(d.lead)}</span>
                <span className="suivi-row-main"><strong>{fullName(d.lead) || d.lead.phone || 'Prospect'}</strong><small>{d.lead.city ?? '—'} · signé {formatDate(d.signedAt)}</small></span>
                <span>{d.commercial?.name ?? '—'}</span>
                <span>{stepLabel(d.activeStep)}</span>
                <span className="suivi-progress"><i style={{ width: `${d.progress}%` }} />{d.progress}%</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="py-10 text-center text-sm text-muted">Aucun dossier pour cette recherche.</div>}
          </div>
        </section>

        {selected && popupStep && modalStep && (
          <div className="suivi-node-modal-backdrop" role="presentation" onMouseDown={() => setModalStep(null)}>
            <section className="suivi-node-modal" role="dialog" aria-modal="true" aria-labelledby="suivi-node-modal-title" onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="suivi-node-modal-close" onClick={() => setModalStep(null)} aria-label="Fermer le module">×</button>
              <div className="suivi-node-modal-head">
                <span className={`suivi-modal-icon is-${popupStatus}`}><Icon name={popupStep.icon} size={18} /></span>
                <div>
                  <span className="eyebrow">Module workflow · {popupStep.owner}</span>
                  <h3 id="suivi-node-modal-title">{popupStep.label}</h3>
                  <p>{nodeDetail(popupStep, selected.state)}</p>
                </div>
              </div>

              <div className="suivi-node-modal-client">
                <strong>{fullName(selected.lead) || selected.lead.phone || 'Prospect signé'}</strong>
                <span>{selected.lead.city ?? 'Ville inconnue'} · {formatCurrency(selected.amount)} · {selected.commercial?.name ?? 'Commercial non assigné'}</span>
              </div>

              <div className="suivi-editor-fields suivi-modal-fields">
                <label>
                  Statut
                  <select value={popupStatus} onChange={(e) => updateSelected((s) => ({ ...s, statuses: { ...s.statuses, [modalStep]: e.target.value as NodeStatus } }))}>
                    <option value="todo">À faire</option>
                    <option value="active">En cours</option>
                    <option value="done">Fait</option>
                    <option value="blocked">Bloqué</option>
                    <option value="lost">Devis perdu</option>
                  </select>
                </label>
                <label>
                  Date prévue / réalisée
                  <input type="date" value={selected.state.dates[modalStep] ?? ''} onChange={(e) => updateSelected((s) => ({ ...s, dates: { ...s.dates, [modalStep]: e.target.value } }))} />
                </label>
                <label className="suivi-note-field">
                  Notes internes
                  <textarea value={selected.state.notes[modalStep] ?? ''} onChange={(e) => updateSelected((s) => ({ ...s, notes: { ...s.notes, [modalStep]: e.target.value } }))} placeholder="Point WhatsApp, blocage mairie, technicien attribué…" />
                </label>
              </div>
            </section>
          </div>
        )}
      </main>
    </AppShell>
  )
}

function buildSuiviPeriodRange(period: SuiviPeriodState): SuiviPeriodRange {
  const today = startOfDay(new Date())
  let from = today
  let to = endOfDay(today)
  if (period.mode === 'this_week') {
    from = startOfWeek(today)
  } else if (period.mode === 'this_month') {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
  } else if (period.mode === 'this_year') {
    from = new Date(today.getFullYear(), 0, 1)
  } else if (period.mode === 'custom') {
    from = parseDateInput(period.customFrom)
    to = endOfDay(parseDateInput(period.customTo))
    if (from > to) [from, to] = [startOfDay(to), endOfDay(from)]
  }
  const label = `${formatDate(from.toISOString())} → ${formatDate(to.toISOString())}`
  return { from: startOfDay(from), to: endOfDay(to), label }
}

function isDateInRange(value: string, from: Date, to: Date): boolean {
  const date = new Date(value)
  return date >= from && date <= to
}

function parseDateInput(value: string): Date {
  if (!value) return startOfDay(new Date())
  const [year, month, day] = value.split('-').map(Number)
  return startOfDay(new Date(year, (month || 1) - 1, day || 1))
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function startOfWeek(date: Date): Date {
  const next = startOfDay(date)
  const day = next.getDay() || 7
  next.setDate(next.getDate() - day + 1)
  return next
}

function buildDossiers(leads: LeadResponse[], rdvs: RdvResponse[], users: UserResponse[], states: Record<string, SuiviState>): Dossier[] {
  const leadMap = new Map(leads.map((l) => [l.id, l]))
  const userMap = new Map(users.map((u) => [u.id, u]))
  const signedRdv = rdvs.filter((r) => r.result === 'signe' || Boolean(r.signatureAt))
  const rows = signedRdv.map((rdv) => {
    const lead = leadMap.get(rdv.leadId)
    if (!lead) return null
    return buildDossier(lead, rdv, rdv.commercialId ? userMap.get(rdv.commercialId) : undefined, states[lead.id] ?? readWorkflowState(lead.id))
  }).filter(Boolean) as Dossier[]
  for (const lead of leads.filter((l) => l.status === 'signe')) {
    if (!rows.some((r) => r.id === lead.id)) rows.push(buildDossier(lead, undefined, lead.assignedToId ? userMap.get(lead.assignedToId) : undefined, states[lead.id] ?? readWorkflowState(lead.id)))
  }
  return rows.sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime())
}

function buildDossier(lead: LeadResponse, rdv: RdvResponse | undefined, commercial: UserResponse | undefined, state: SuiviState): Dossier {
  const activeStep = inferActiveStep(state)
  return {
    id: lead.id,
    lead,
    rdv,
    commercial,
    amount: Number(rdv?.montantTotal ?? lead.monetaryValue ?? 0) || 0,
    signedAt: rdv?.signatureAt ?? lead.lastStageChangeAt ?? lead.updatedAt,
    state,
    activeStep,
    progress: Math.round((WORKFLOW.filter((s) => (state.statuses[s.id] ?? statusForId(activeStep, s.id)) === 'done').length / WORKFLOW.length) * 100),
  }
}

function inferActiveStep(state: SuiviState): StepId {
  const lost = WORKFLOW.find((s) => state.statuses[s.id] === 'lost')
  if (lost) return lost.id
  const blocked = WORKFLOW.find((s) => state.statuses[s.id] === 'blocked')
  if (blocked) return blocked.id
  return WORKFLOW.find((s) => (state.statuses[s.id] ?? 'todo') !== 'done')?.id ?? 'upsell'
}

function readWorkflowState(id: string): SuiviState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`)
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } as SuiviState : DEFAULT_STATE
  } catch {
    return DEFAULT_STATE
  }
}

function writeWorkflowState(id: string, state: SuiviState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(state))
}

function statusForStep(dossier: Dossier | null, step: StepId): NodeStatus {
  if (!dossier) return 'todo'
  return statusForId(dossier.activeStep, step)
}

function statusForId(active: StepId, step: StepId): NodeStatus {
  const activeIndex = stepIndex(active)
  const index = stepIndex(step)
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'todo'
}

function stepIndex(id: StepId): number {
  return Math.max(0, WORKFLOW.findIndex((s) => s.id === id))
}

function workflowLeft(id: StepId): number {
  return WORKFLOW.length <= 1 ? 0 : (stepIndex(id) / (WORKFLOW.length - 1)) * 100
}

function stepLabel(id: StepId): string {
  return WORKFLOW.find((s) => s.id === id)?.label ?? id
}

function nodeDetail(step: WorkflowStep, state: SuiviState): string {
  if (step.id === 'prime') return state.primeMode === 'region' ? 'Dossier Région : faire remplir la prime Région, signature client, prévenir responsable technique.' : 'Revente EDF : demande T0 à EDF, déclenchement prime PK, prévenir responsable technique.'
  if (step.id === 'payment_1' || step.id === 'payment_final') return state.payMode === 'financement' ? 'Financement : process identique, sans les appels d’acomptes.' : step.detail
  return step.detail
}

function SuiviKpi({ label, value }: { label: string; value: number | string }) {
  return <div className="suivi-kpi"><strong>{value}</strong><span>{label}</span></div>
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function formatCurrency(value: number): string {
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
