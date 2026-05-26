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

  const signedDossiers = useMemo(() => buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states), [leads, rdvs, users, states])
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

  return (
    <AppShell flat>
      <Topbar eyebrow="DÉLIVRABILITÉ — SUIVI" title="Workflow dossiers signés" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <section className="suivi-hero">
          <div>
            <span className="eyebrow">Jenkins pipeline × nodes n8n</span>
            <h1>Un prospect sélectionné, un point de position animé.</h1>
            <p>Chaque module est éditable : statut, date, notes, type de prime et paiement. Les modifications sont gardées localement jusqu’au branchement backend Lot 2.</p>
          </div>
          <div className="suivi-hero-kpis">
            <SuiviKpi label="Dossiers signés" value={signedDossiers.length} />
            <SuiviKpi label="En retard / bloqués" value={signedDossiers.filter((d) => d.state.statuses[d.activeStep] === 'blocked').length} />
            <SuiviKpi label="Progression moy." value={`${Math.round(avg(signedDossiers.map((d) => d.progress)))}%`} />
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
                      onClick={() => setFocusStep(step.id)}
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

              <div className="suivi-node-editor">
                <div className={`suivi-editor-card is-${selectedStatus}`}>
                  <div className="suivi-editor-icon"><Icon name={selectedStep.icon} size={20} /></div>
                  <div className="min-w-0">
                    <span className="eyebrow">Node éditable · {selectedStep.owner}</span>
                    <h3>{selectedStep.label}</h3>
                    <p>{nodeDetail(selectedStep, selected.state)}</p>
                  </div>
                </div>
                <div className="suivi-editor-fields">
                  <label>
                    Statut
                    <select value={selectedStatus} onChange={(e) => updateSelected((s) => ({ ...s, statuses: { ...s.statuses, [focusStep]: e.target.value as NodeStatus } }))}>
                      <option value="todo">À faire</option>
                      <option value="active">En cours</option>
                      <option value="done">Fait</option>
                      <option value="blocked">Bloqué</option>
                      <option value="lost">Devis perdu</option>
                    </select>
                  </label>
                  <label>
                    Date prévue / réalisée
                    <input type="date" value={selected.state.dates[focusStep] ?? ''} onChange={(e) => updateSelected((s) => ({ ...s, dates: { ...s.dates, [focusStep]: e.target.value } }))} />
                  </label>
                  <label className="suivi-note-field">
                    Notes internes
                    <textarea value={selected.state.notes[focusStep] ?? ''} onChange={(e) => updateSelected((s) => ({ ...s, notes: { ...s.notes, [focusStep]: e.target.value } }))} placeholder="Point WhatsApp, blocage mairie, technicien attribué…" />
                  </label>
                </div>
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
      </main>
    </AppShell>
  )
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
