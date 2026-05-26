# Suivi Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre la page `/suivi` (Délivrabilité) en deux écrans glass warm — index grille de dossiers signés + détail split (sidebar dossier + timeline verticale avec accordion inline) — avec support light/dark via tokens existants.

**Architecture:** Split de la page actuelle `Suivi.tsx` en `SuiviIndex` (grille) + `SuiviDetail` (split layout). Extraction des types/constantes/helpers vers `src/lib/suivi.ts` pour réutilisation. Composants atomiques `DossierCard`, `DossierSidebar`, `WorkflowTimeline`, `WorkflowStep` sous `src/components/suivi/`. CSS sous préfixe transitoire `.suivi-v2-*` puis renommé `.suivi-*` en fin de plan. Aucun changement de modèle de données (`StepId` × 12, `SuiviState`, clé localStorage `ecoi.suivi.workflow.v1:<leadId>`).

**Tech Stack:** React 19 + Vite + TypeScript strict (tsc -b), react-router-dom v6 (createHashRouter), zustand (theme + auth), hooks maison `useLeads`/`useRdvList`/`useUsers`. Pas de tests unitaires — vérification = `npm run build` + `npm run lint` + manuel browser (cf. mémoire `saas-ecoi-build-verification.md`).

**Référence design:** `docs/SPEC-suivi-redesign.md`

---

## File Structure

| Fichier | Action | Responsabilité |
|---|---|---|
| `src/lib/suivi.ts` | **Create** | Types (`StepId`, `WorkflowStep`, `SuiviState`, `Dossier`, `NodeStatus`, `PayMode`, `PrimeMode`, `SuiviPeriodState`, `SuiviPeriodRange`, `SuiviPeriodMode`), constantes (`WORKFLOW`, `STORAGE_PREFIX`, `DEFAULT_STATE`, `DEFAULT_SUIVI_PERIOD`, `SUIVI_PERIOD_OPTIONS`), helpers (`buildDossiers`, `buildDossier`, `inferActiveStep`, `readWorkflowState`, `writeWorkflowState`, `statusForStep`, `statusForId`, `stepIndex`, `stepLabel`, `nodeDetail`, `buildSuiviPeriodRange`, `isDateInRange`, `toDateInputValue`, `formatCurrency`, `formatDate`, `avg`). Pure extraction du code actuel de `Suivi.tsx`. |
| `src/components/suivi/DossierCard.tsx` | **Create** | Carte glass d'un dossier (index). Props: `dossier`, `onClick`. Avatar initiales + nom + ville + montant + progress bar + badge étape. |
| `src/components/suivi/DossierSidebar.tsx` | **Create** | Panneau sticky 380px (détail). Identité, contact, financier, progress global, actions (tel/mail/GHL). |
| `src/components/suivi/WorkflowStep.tsx` | **Create** | Item de timeline : cercle d'état + bloc contenu + accordion inline d'édition. Props: `step`, `status`, `state`, `expanded`, `onToggle`, `onChange`. |
| `src/components/suivi/WorkflowTimeline.tsx` | **Create** | Conteneur vertical des 12 étapes + ligne connectrice. Gère l'état "quelle étape est expandée" et l'autosave debounced 500ms. |
| `src/pages/SuiviDetail.tsx` | **Create** | Page `/suivi/:id` : guard role, fetch lead par id, layout split sidebar + timeline. |
| `src/pages/Suivi.tsx` | **Rewrite** | Devient `SuiviIndex` : grille de cartes. Garde l'export `Suivi` pour ne pas casser l'import dans `main.tsx`. |
| `src/main.tsx` | **Modify** | Ajout route `/suivi/:id` + composant inline `SuiviLegacyRedirect` pour `/suivi?lead=X` → `/suivi/X`. |
| `src/index.css` | **Modify** | Ajout bloc `.suivi-v2-*` (light) après la dernière règle. Ajout overrides `[data-theme="dark"] .suivi-v2-*` dans le bloc dark. Suppression bloc legacy `.suivi-*` (lignes ~3581-3744) en dernière task. |

---

## Pre-flight

- [ ] **Step 0.1 : Vérifier l'état git**

Run: `cd /root/ECOI_frontend && git status && git log --oneline -3`
Attendu : branche `main` propre, dernier commit `a1e2f55 Remove deliverability page` (ou plus récent). Si dirty : stash ou commit avant de commencer.

- [ ] **Step 0.2 : Vérifier que le build actuel passe**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0, `dist/` généré. Si ça casse, fix avant de continuer.

- [ ] **Step 0.3 : Lancer dev server en arrière-plan pour QA continue**

Run: `cd /root/ECOI_frontend && npm run dev`
Attendu : `Local: http://localhost:5173/`. Garder le serveur en arrière-plan pendant toute l'exécution.

---

### Task 1 : Extraire types + constantes + helpers vers `src/lib/suivi.ts`

**Files:**
- Create: `src/lib/suivi.ts`
- Référence (lecture seule) : `src/pages/Suivi.tsx:11-92, 380-484`

- [ ] **Step 1.1 : Créer `src/lib/suivi.ts` avec le code ci-dessous**

```ts
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
  const leadMap = new Map(leads.map((l) => [l.id, l]))
  const userMap = new Map(users.map((u) => [u.id, u]))
  const signedRdv = rdvs.filter((r) => r.result === 'signe' || Boolean(r.signatureAt))
  const rows = signedRdv.map((rdv) => {
    const lead = leadMap.get(rdv.leadId)
    if (!lead) return null
    return buildDossier(lead, rdv, rdv.commercialId ? userMap.get(rdv.commercialId) : undefined, states[lead.id] ?? readWorkflowState(lead.id))
  }).filter(Boolean) as Dossier[]
  for (const lead of leads.filter((l) => l.status === 'signe')) {
    if (!rows.some((r) => r.id === lead.id)) {
      rows.push(buildDossier(lead, undefined, lead.assignedToId ? userMap.get(lead.assignedToId) : undefined, states[lead.id] ?? readWorkflowState(lead.id)))
    }
  }
  return rows.sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime())
}

export function buildDossier(
  lead: LeadResponse,
  rdv: RdvResponse | undefined,
  commercial: UserResponse | undefined,
  state: SuiviState,
): Dossier {
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
  const from = new Date(period.customFrom + 'T00:00:00')
  const to = new Date(period.customTo + 'T23:59:59')
  return { from, to, label: `${period.customFrom} → ${period.customTo}` }
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
```

- [ ] **Step 1.2 : Vérifier que le build passe**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0. Pas d'erreur d'import circulaire ni de type manquant.

- [ ] **Step 1.3 : Vérifier le lint**

Run: `cd /root/ECOI_frontend && npm run lint`
Attendu : exit 0 ou warnings preexistants seulement.

- [ ] **Step 1.4 : Commit**

```bash
cd /root/ECOI_frontend && git add src/lib/suivi.ts
git commit -m "refactor(suivi): extract types and helpers to lib/suivi.ts"
```

---

### Task 2 : Ajouter route `/suivi/:id` + redirect compat `?lead=`

**Files:**
- Modify: `src/main.tsx:21-22, 47`
- Create: `src/pages/SuiviDetail.tsx` (placeholder minimal)

- [ ] **Step 2.1 : Créer placeholder `src/pages/SuiviDetail.tsx`**

```tsx
import { Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'

export function SuiviDetail() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()

  if (role && role !== 'admin' && role !== 'delivrabilite') {
    return <Navigate to="/overview" replace />
  }
  if (!id) return <Navigate to="/suivi" replace />

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI" title="Détail dossier" />
      <main className="suivi-v2-detail flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <p>Placeholder dossier {id}</p>
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 2.2 : Modifier `src/main.tsx` — ajouter import + route + redirect**

Repérer la ligne `import { Suivi } from './pages/Suivi'` puis remplacer par :

```tsx
import { Suivi } from './pages/Suivi'
import { SuiviDetail } from './pages/SuiviDetail'
```

Repérer la ligne `{ path: '/suivi', element: <Suivi /> },` puis remplacer par :

```tsx
          { path: '/suivi', element: <Suivi /> },
          { path: '/suivi/:id', element: <SuiviDetail /> },
```

- [ ] **Step 2.3 : Build + manual test**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

Dans le browser sur `http://localhost:5173/#/suivi/test-id` : doit afficher "Placeholder dossier test-id".

- [ ] **Step 2.4 : Commit**

```bash
cd /root/ECOI_frontend && git add src/main.tsx src/pages/SuiviDetail.tsx
git commit -m "feat(suivi): add /suivi/:id route with placeholder detail page"
```

---

### Task 3 : Composant `DossierCard` (carte index)

**Files:**
- Create: `src/components/suivi/DossierCard.tsx`

- [ ] **Step 3.1 : Créer `src/components/suivi/DossierCard.tsx`**

```tsx
import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatRelativeDate, stepLabel } from '../../lib/suivi'
import { fullName, initials } from '../../lib/types'

type Props = {
  dossier: Dossier
  onClick: () => void
}

export function DossierCard({ dossier, onClick }: Props) {
  const status = dossier.state.statuses[dossier.activeStep] ?? 'active'
  const statusColor =
    status === 'blocked' ? 'var(--color-rouille)'
    : status === 'lost' ? 'var(--color-rouille)'
    : status === 'done' ? 'var(--color-or)'
    : 'var(--color-cuivre)'

  return (
    <button type="button" className="suivi-v2-card glass-card" onClick={onClick}>
      <header className="suivi-v2-card-head">
        <span className="suivi-v2-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div className="suivi-v2-card-id">
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{dossier.lead.city || '—'} · {formatCurrency(dossier.amount)}</span>
        </div>
      </header>
      <div className="suivi-v2-card-progress" aria-label={`Progression ${dossier.progress}%`}>
        <div className="suivi-v2-card-progress-track">
          <div className="suivi-v2-card-progress-fill" style={{ width: `${dossier.progress}%` }} />
        </div>
        <span>{dossier.progress}%</span>
      </div>
      <footer className="suivi-v2-card-foot">
        <span className="suivi-v2-card-dot" style={{ background: statusColor }} aria-hidden />
        <span className="suivi-v2-card-step">{stepLabel(dossier.activeStep)}</span>
        <span className="suivi-v2-card-time">· {formatRelativeDate(dossier.signedAt)}</span>
      </footer>
    </button>
  )
}
```

- [ ] **Step 3.2 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0 (composant non encore utilisé mais doit compiler).

- [ ] **Step 3.3 : Commit**

```bash
cd /root/ECOI_frontend && git add src/components/suivi/DossierCard.tsx
git commit -m "feat(suivi): add DossierCard component for index grid"
```

---

### Task 4 : Refonte `Suivi.tsx` en index grille

**Files:**
- Rewrite: `src/pages/Suivi.tsx`

- [ ] **Step 4.1 : Remplacer entièrement `src/pages/Suivi.tsx` par le code ci-dessous**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers } from '../lib/hooks'
import { fullName } from '../lib/types'
import {
  buildDossiers,
  buildSuiviPeriodRange,
  getDefaultSuiviPeriod,
  isDateInRange,
  readWorkflowState,
  SUIVI_PERIOD_OPTIONS,
  type SuiviPeriodState,
  type SuiviState,
  avg,
} from '../lib/suivi'
import { DossierCard } from '../components/suivi/DossierCard'

export function Suivi() {
  const role = useAuth((s) => s.user?.role)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()
  const [query, setQuery] = useState('')
  const [states, setStates] = useState<Record<string, SuiviState>>({})
  const [period, setPeriod] = useState<SuiviPeriodState>(getDefaultSuiviPeriod)
  const periodRange = useMemo(() => buildSuiviPeriodRange(period), [period])

  const allSignedDossiers = useMemo(
    () => buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states),
    [leads, rdvs, users, states],
  )
  const signedDossiers = useMemo(
    () => allSignedDossiers.filter((d) => isDateInRange(d.signedAt, periodRange.from, periodRange.to)),
    [allSignedDossiers, periodRange],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return signedDossiers
    return signedDossiers.filter((d) => [fullName(d.lead), d.lead.phone, d.lead.email, d.lead.city, d.commercial?.name].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [signedDossiers, query])

  // Compat redirect : /suivi?lead=X → /suivi/X
  const legacyLead = params.get('lead')
  useEffect(() => {
    if (legacyLead) navigate(`/suivi/${legacyLead}`, { replace: true })
  }, [legacyLead, navigate])

  useEffect(() => {
    const loaded: Record<string, SuiviState> = {}
    for (const d of signedDossiers) loaded[d.id] = readWorkflowState(d.id)
    setStates((prev) => ({ ...loaded, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedDossiers.map((d) => d.id).join('|')])

  if (role && role !== 'admin' && role !== 'delivrabilite') return <Navigate to="/overview" replace />

  const isLoading = leadsLoading || rdvLoading
  const blockedCount = signedDossiers.filter((d) => d.state.statuses[d.activeStep] === 'blocked').length
  const progressAvg = Math.round(avg(signedDossiers.map((d) => d.progress)))
  const deliveredCount = signedDossiers.filter((d) => d.progress >= 100).length

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Dossiers signés" />
      <main className="suivi-v2-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <header className="suivi-v2-hero">
          <div>
            <span className="eyebrow">Pipeline post-signature</span>
            <h1>Suivi des installations</h1>
            <p>Vue d'ensemble des dossiers signés et de leur avancement workflow.</p>
          </div>
          <div className="suivi-v2-hero-actions">
            <div className="suivi-v2-period" role="group" aria-label="Période">
              {SUIVI_PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={period.mode === option.id ? 'active' : ''}
                  onClick={() => setPeriod((current) => ({ ...current, mode: option.id }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              placeholder="Rechercher un dossier…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="suivi-v2-search"
            />
          </div>
        </header>

        <section className="suivi-v2-kpis">
          <div className="kpi-card suivi-v2-kpi"><strong>{signedDossiers.length}</strong><span>Dossiers signés</span></div>
          <div className="kpi-card suivi-v2-kpi"><strong>{progressAvg}%</strong><span>Progression moyenne</span></div>
          <div className="kpi-card suivi-v2-kpi"><strong>{blockedCount}</strong><span>Bloqués</span></div>
          <div className="kpi-card suivi-v2-kpi"><strong>{deliveredCount}</strong><span>Livrés</span></div>
        </section>

        {isLoading ? (
          <LoadingBlock label="Chargement des dossiers signés…" />
        ) : filtered.length === 0 ? (
          <div className="suivi-v2-empty">
            <p>{query ? 'Aucun dossier ne correspond à votre recherche.' : 'Aucun dossier signé pour cette période.'}</p>
            {query && <button type="button" onClick={() => setQuery('')}>Effacer la recherche</button>}
          </div>
        ) : (
          <section className="suivi-v2-grid">
            {filtered.map((d) => (
              <DossierCard key={d.id} dossier={d} onClick={() => navigate(`/suivi/${d.id}`)} />
            ))}
          </section>
        )}
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 4.2 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 4.3 : Test manuel browser**

Naviguer vers `http://localhost:5173/#/suivi` → doit afficher la grille de cartes (style non encore appliqué, layout brut OK). Vérifier qu'un click sur une carte navigue vers `/suivi/<id>` placeholder.

Vérifier aussi : `http://localhost:5173/#/suivi?lead=test-id` → doit rediriger vers `/suivi/test-id`.

- [ ] **Step 4.4 : Commit**

```bash
cd /root/ECOI_frontend && git add src/pages/Suivi.tsx
git commit -m "feat(suivi): rewrite Suivi.tsx as index grid of dossier cards"
```

---

### Task 5 : Composant `DossierSidebar` (détail, panneau gauche)

**Files:**
- Create: `src/components/suivi/DossierSidebar.tsx`

- [ ] **Step 5.1 : Créer `src/components/suivi/DossierSidebar.tsx`**

```tsx
import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { fullName, initials } from '../../lib/types'

type Props = {
  dossier: Dossier
}

export function DossierSidebar({ dossier }: Props) {
  const tel = dossier.lead.phone
  const mail = dossier.lead.email
  const ghlId = dossier.lead.ghlContactId

  return (
    <aside className="suivi-v2-side glass-card">
      <header className="suivi-v2-side-head">
        <span className="suivi-v2-side-avatar" aria-hidden>{initials(dossier.lead)}</span>
        <div>
          <strong>{fullName(dossier.lead) || 'Client sans nom'}</strong>
          <span>{dossier.lead.city || '—'}</span>
        </div>
      </header>

      <dl className="suivi-v2-side-list">
        {tel && (<><dt>Téléphone</dt><dd><a href={`tel:${tel}`}>{tel}</a></dd></>)}
        {mail && (<><dt>Email</dt><dd><a href={`mailto:${mail}`}>{mail}</a></dd></>)}
        <dt>Montant</dt><dd>{formatCurrency(dossier.amount)}</dd>
        <dt>Financement</dt><dd>{dossier.state.payMode === 'financement' ? 'Financement' : 'Comptant'}</dd>
        <dt>Signé le</dt><dd>{formatDate(dossier.signedAt)}</dd>
        {dossier.commercial && (<><dt>Commercial</dt><dd>{dossier.commercial.name}</dd></>)}
      </dl>

      <div className="suivi-v2-side-progress" aria-label={`Avancement global ${dossier.progress} pour cent`}>
        <div className="suivi-v2-side-progress-head">
          <span>Avancement</span>
          <strong>{dossier.progress}%</strong>
        </div>
        <div className="suivi-v2-side-progress-track">
          <div className="suivi-v2-side-progress-fill" style={{ width: `${dossier.progress}%` }} />
        </div>
      </div>

      <div className="suivi-v2-side-actions">
        {tel && <a className="suivi-v2-side-cta" href={`tel:${tel}`}>Appeler</a>}
        {mail && <a className="suivi-v2-side-cta" href={`mailto:${mail}`}>Email</a>}
        {ghlId && (
          <a
            className="suivi-v2-side-cta secondary"
            href={`https://app.gohighlevel.com/v2/location/_/contacts/detail/${ghlId}`}
            target="_blank"
            rel="noreferrer"
          >
            Voir dans GHL
          </a>
        )}
      </div>
    </aside>
  )
}
```

> Note : vérifier que `LeadResponse` a bien le champ `ghlContactId`. Si ce n'est pas le cas, remplacer par `dossier.lead.id` et lien interne, ou retirer le bouton GHL.

- [ ] **Step 5.2 : Vérifier le champ `ghlContactId` dans `LeadResponse`**

Run: `cd /root/ECOI_frontend && grep -n "ghlContactId\|ghlId" src/lib/types.ts | head -5`
- Si présent : OK, garder le code tel quel.
- Si absent : éditer `DossierSidebar.tsx` ligne `const ghlId = dossier.lead.ghlContactId` → remplacer par `const ghlId: string | undefined = undefined` et retirer le bouton (ou utiliser un champ existant si trouvé).

- [ ] **Step 5.3 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 5.4 : Commit**

```bash
cd /root/ECOI_frontend && git add src/components/suivi/DossierSidebar.tsx
git commit -m "feat(suivi): add DossierSidebar for detail page left panel"
```

---

### Task 6 : Composant `WorkflowStep` (cercle + accordion inline)

**Files:**
- Create: `src/components/suivi/WorkflowStep.tsx`

- [ ] **Step 6.1 : Créer `src/components/suivi/WorkflowStep.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import type { NodeStatus, StepId, SuiviState, WorkflowStep as WorkflowStepDef } from '../../lib/suivi'
import { nodeDetail, stepIndex } from '../../lib/suivi'

type Props = {
  step: WorkflowStepDef
  status: NodeStatus
  state: SuiviState
  expanded: boolean
  isLast: boolean
  onToggle: () => void
  onChange: (next: SuiviState) => void
  onCommit: () => void
  savedAgo: number | null
}

export function WorkflowStep({ step, status, state, expanded, isLast, onToggle, onChange, onCommit, savedAgo }: Props) {
  const [localNotes, setLocalNotes] = useState(state.notes[step.id] ?? '')
  const [localDate, setLocalDate] = useState(state.dates[step.id] ?? '')
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setLocalNotes(state.notes[step.id] ?? '')
    setLocalDate(state.dates[step.id] ?? '')
  }, [step.id, state.notes, state.dates])

  const persistDebounced = (updater: (s: SuiviState) => SuiviState) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      onChange(updater(state))
    }, 500)
  }

  const handleNotes = (value: string) => {
    setLocalNotes(value)
    persistDebounced((s) => ({ ...s, notes: { ...s.notes, [step.id]: value } }))
  }

  const handleDate = (value: string) => {
    setLocalDate(value)
    persistDebounced((s) => ({ ...s, dates: { ...s.dates, [step.id]: value } }))
  }

  const toggleDone = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    const nextStatus: NodeStatus = status === 'done' ? 'active' : 'done'
    onChange({ ...state, statuses: { ...state.statuses, [step.id]: nextStatus } })
    onCommit()
  }

  return (
    <li className={`suivi-v2-step suivi-v2-step-${status} ${expanded ? 'is-expanded' : ''} ${isLast ? 'is-last' : ''}`}>
      <button
        type="button"
        className="suivi-v2-step-circle"
        aria-expanded={expanded}
        aria-controls={`suivi-step-${step.id}`}
        onClick={onToggle}
      >
        {status === 'done' ? <Icon name="check" size={18} strokeWidth={2.4} />
          : status === 'blocked' || status === 'lost' ? <span aria-hidden>!</span>
          : <span aria-hidden>{stepIndex(step.id) + 1}</span>}
      </button>

      <div className="suivi-v2-step-body" id={`suivi-step-${step.id}`}>
        <button type="button" className="suivi-v2-step-head" onClick={onToggle}>
          <div>
            <strong>{step.label}</strong>
            <span>{step.short} · {step.owner}</span>
          </div>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} strokeWidth={2} />
        </button>

        {expanded && (
          <div className="suivi-v2-step-panel">
            <p className="suivi-v2-step-detail">{nodeDetail(step, state)}</p>

            <div className="suivi-v2-step-fields">
              <label>
                <span>Date prévue / réalisation</span>
                <input type="date" value={localDate} onChange={(e) => handleDate(e.target.value)} />
              </label>
              <label>
                <span>Notes</span>
                <textarea
                  value={localNotes}
                  onChange={(e) => handleNotes(e.target.value)}
                  rows={3}
                  placeholder="Notes internes, blocages, contact…"
                />
              </label>
            </div>

            <footer className="suivi-v2-step-foot">
              <button type="button" className="suivi-v2-step-cta" onClick={toggleDone}>
                {status === 'done' ? 'Réouvrir' : 'Marquer terminé'}
              </button>
              {savedAgo !== null && <span className="suivi-v2-step-saved">Enregistré il y a {savedAgo}s ✓</span>}
            </footer>
          </div>
        )}
      </div>
    </li>
  )
}
```

> Note : le composant utilise les icônes `check`, `chevron-up`, `chevron-down`. Vérifier qu'elles existent.

- [ ] **Step 6.2 : Vérifier les icônes utilisées**

Run: `cd /root/ECOI_frontend && grep -E "'check'|'chevron-up'|'chevron-down'" src/components/Icon.tsx | head -10`
- Si toutes présentes : OK.
- Si manquantes : utiliser une icône existante équivalente (`x`, `plus`, etc.) ou ajouter au registre Icon.

- [ ] **Step 6.3 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 6.4 : Commit**

```bash
cd /root/ECOI_frontend && git add src/components/suivi/WorkflowStep.tsx
git commit -m "feat(suivi): add WorkflowStep with inline accordion edit"
```

---

### Task 7 : Composant `WorkflowTimeline` (conteneur 12 étapes)

**Files:**
- Create: `src/components/suivi/WorkflowTimeline.tsx`

- [ ] **Step 7.1 : Créer `src/components/suivi/WorkflowTimeline.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { WorkflowStep } from './WorkflowStep'
import {
  readWorkflowState,
  statusForId,
  WORKFLOW,
  writeWorkflowState,
  type StepId,
  type SuiviState,
} from '../../lib/suivi'

type Props = {
  dossierId: string
  initialState: SuiviState
  activeStep: StepId
  onStateChange?: (state: SuiviState) => void
}

export function WorkflowTimeline({ dossierId, initialState, activeStep, onStateChange }: Props) {
  const [state, setState] = useState<SuiviState>(initialState)
  const [expandedStep, setExpandedStep] = useState<StepId>(activeStep)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setState(readWorkflowState(dossierId))
    setExpandedStep(activeStep)
  }, [dossierId, activeStep])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const persist = (next: SuiviState) => {
    setState(next)
    writeWorkflowState(dossierId, next)
    setSavedAt(Date.now())
    onStateChange?.(next)
  }

  const handleToggle = (id: StepId) => {
    setExpandedStep((current) => (current === id ? null as unknown as StepId : id))
  }

  const savedAgo = savedAt ? Math.max(0, Math.floor((now - savedAt) / 1000)) : null

  return (
    <ol className="suivi-v2-timeline">
      {WORKFLOW.map((step, idx) => {
        const status = state.statuses[step.id] ?? statusForId(activeStep, step.id)
        const expanded = expandedStep === step.id
        return (
          <WorkflowStep
            key={step.id}
            step={step}
            status={status}
            state={state}
            expanded={expanded}
            isLast={idx === WORKFLOW.length - 1}
            onToggle={() => handleToggle(step.id)}
            onChange={persist}
            onCommit={() => setSavedAt(Date.now())}
            savedAgo={expanded ? savedAgo : null}
          />
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 7.2 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 7.3 : Commit**

```bash
cd /root/ECOI_frontend && git add src/components/suivi/WorkflowTimeline.tsx
git commit -m "feat(suivi): add WorkflowTimeline with localStorage autosave"
```

---

### Task 8 : Compléter `SuiviDetail` avec layout split

**Files:**
- Rewrite: `src/pages/SuiviDetail.tsx`

- [ ] **Step 8.1 : Remplacer entièrement `src/pages/SuiviDetail.tsx`**

```tsx
import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers } from '../lib/hooks'
import { buildDossiers, readWorkflowState } from '../lib/suivi'
import { DossierSidebar } from '../components/suivi/DossierSidebar'
import { WorkflowTimeline } from '../components/suivi/WorkflowTimeline'

export function SuiviDetail() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()

  const dossier = useMemo(() => {
    if (!id || !leads) return null
    const states = id ? { [id]: readWorkflowState(id) } : {}
    return buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states).find((d) => d.id === id) ?? null
  }, [id, leads, rdvs, users])

  if (role && role !== 'admin' && role !== 'delivrabilite') return <Navigate to="/overview" replace />
  if (!id) return <Navigate to="/suivi" replace />

  const isLoading = leadsLoading || rdvLoading

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Détail dossier" />
      <main className="suivi-v2-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-v2-breadcrumb">
          <Link to="/suivi">← Tous les dossiers</Link>
        </nav>

        {isLoading ? (
          <LoadingBlock label="Chargement du dossier…" />
        ) : !dossier ? (
          <div className="suivi-v2-empty">
            <p>Dossier introuvable.</p>
            <Link to="/suivi">Retour à la liste</Link>
          </div>
        ) : (
          <div className="suivi-v2-split">
            <DossierSidebar dossier={dossier} />
            <section className="suivi-v2-timeline-wrap glass-card">
              <header className="suivi-v2-timeline-head">
                <h2>Workflow installation</h2>
                <p>Cliquez une étape pour éditer son avancement. Sauvegarde automatique.</p>
              </header>
              <WorkflowTimeline
                dossierId={dossier.id}
                initialState={dossier.state}
                activeStep={dossier.activeStep}
              />
            </section>
          </div>
        )}
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 8.2 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 8.3 : Test manuel browser**

Naviguer vers `http://localhost:5173/#/suivi` → cliquer une carte → doit afficher la page détail (layout brut sans style spécifique pour l'instant, mais fonctionnel : sidebar + timeline avec 12 items, accordion expand au click).

Tester l'autosave : ouvrir une étape, taper dans Notes, attendre 1s, rafraîchir la page → la note doit être conservée (vérification localStorage `ecoi.suivi.workflow.v1:<id>`).

- [ ] **Step 8.4 : Commit**

```bash
cd /root/ECOI_frontend && git add src/pages/SuiviDetail.tsx
git commit -m "feat(suivi): wire SuiviDetail with sidebar + timeline split layout"
```

---

### Task 9 : CSS `.suivi-v2-*` light mode

**Files:**
- Modify: `src/index.css` (ajout à la fin du fichier)

- [ ] **Step 9.1 : Repérer la fin du fichier `src/index.css`**

Run: `cd /root/ECOI_frontend && wc -l src/index.css`
Noter la dernière ligne. Le bloc s'ajoute APRÈS la dernière règle existante.

- [ ] **Step 9.2 : Ajouter le bloc CSS suivi-v2 light à la fin de `src/index.css`**

```css
/* === Suivi v2 — light mode === */
.suivi-v2-page { background:
    radial-gradient(circle at 18% 0%, var(--color-or-tint), transparent 38%),
    var(--color-cream); }

/* Hero */
.suivi-v2-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; margin-bottom: 18px; align-items: end; }
.suivi-v2-hero h1 { margin: 6px 0 4px; font-size: clamp(24px, 3vw, 38px); line-height: 1; font-weight: 950; letter-spacing: -.045em; color: var(--color-text); }
.suivi-v2-hero p { margin: 0; max-width: 640px; font-size: 13px; color: var(--color-muted); font-weight: 600; }
.suivi-v2-hero-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

.suivi-v2-period { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,.6); border: 1px solid var(--color-line); }
.suivi-v2-period button { border: none; background: transparent; padding: 7px 14px; border-radius: 999px; font-size: 12px; font-weight: 800; color: var(--color-muted); cursor: pointer; transition: all .18s ease; }
.suivi-v2-period button:hover { color: var(--color-text); }
.suivi-v2-period button.active { background: var(--color-or); color: #fff; box-shadow: 0 6px 18px rgba(31, 120, 87, .25); }

.suivi-v2-search { border: 1px solid var(--color-line); background: rgba(255,255,255,.7); border-radius: 999px; padding: 9px 16px; font-size: 13px; font-weight: 600; color: var(--color-text); width: 240px; outline: none; transition: border-color .18s, background .18s; }
.suivi-v2-search:focus { border-color: var(--color-or-light); background: #fff; }
.suivi-v2-search::placeholder { color: var(--color-faint); }

/* KPIs */
.suivi-v2-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.suivi-v2-kpi { padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; }
.suivi-v2-kpi strong { font-size: 28px; line-height: 1; font-weight: 950; color: var(--color-or); }
.suivi-v2-kpi span { font-size: 11px; font-weight: 800; letter-spacing: .04em; color: var(--color-muted); text-transform: uppercase; }
.suivi-v2-kpi:nth-child(3) strong { color: var(--color-rouille); }

/* Grille de cartes */
.suivi-v2-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }

.suivi-v2-card { text-align: left; cursor: pointer; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; transition: transform .18s ease, box-shadow .18s ease; border: 1px solid var(--color-line); background: rgba(255,255,255,.7); border-radius: 18px; }
.suivi-v2-card:hover { transform: translateY(-2px); box-shadow: 0 22px 48px rgba(20, 35, 28, .12); border-color: var(--color-or-light); }
.suivi-v2-card-head { display: flex; gap: 12px; align-items: center; }
.suivi-v2-avatar { width: 42px; height: 42px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900; background: var(--color-or-tint); color: var(--color-or-dark); }
.suivi-v2-card-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.suivi-v2-card-id strong { font-size: 14px; font-weight: 850; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.suivi-v2-card-id span { font-size: 12px; color: var(--color-muted); font-weight: 600; }
.suivi-v2-card-progress { display: flex; align-items: center; gap: 10px; }
.suivi-v2-card-progress-track { flex: 1; height: 4px; border-radius: 999px; background: var(--color-line); overflow: hidden; }
.suivi-v2-card-progress-fill { height: 100%; background: var(--color-or); border-radius: 999px; transition: width .35s ease; }
.suivi-v2-card-progress > span { font-size: 11px; font-weight: 900; color: var(--color-or-dark); min-width: 36px; text-align: right; }
.suivi-v2-card-foot { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-muted); font-weight: 700; }
.suivi-v2-card-dot { width: 8px; height: 8px; border-radius: 999px; }
.suivi-v2-card-step { color: var(--color-text); font-weight: 850; }
.suivi-v2-card-time { font-weight: 600; color: var(--color-faint); }

/* Empty state */
.suivi-v2-empty { padding: 48px 24px; text-align: center; color: var(--color-muted); border-radius: 18px; border: 1px dashed var(--color-line); background: rgba(255,255,255,.4); }
.suivi-v2-empty button, .suivi-v2-empty a { display: inline-block; margin-top: 12px; padding: 8px 16px; border-radius: 999px; background: var(--color-or); color: #fff; border: none; font-weight: 800; font-size: 12px; cursor: pointer; text-decoration: none; }

/* Détail */
.suivi-v2-breadcrumb { margin-bottom: 14px; }
.suivi-v2-breadcrumb a { color: var(--color-muted); font-size: 12px; font-weight: 800; text-decoration: none; }
.suivi-v2-breadcrumb a:hover { color: var(--color-or); }

.suivi-v2-split { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 18px; align-items: start; }

/* Sidebar dossier */
.suivi-v2-side { padding: 22px; position: sticky; top: 16px; display: flex; flex-direction: column; gap: 18px; }
.suivi-v2-side-head { display: flex; gap: 14px; align-items: center; }
.suivi-v2-side-avatar { width: 56px; height: 56px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 900; background: var(--color-or-tint); color: var(--color-or-dark); }
.suivi-v2-side-head strong { display: block; font-size: 17px; font-weight: 900; color: var(--color-text); }
.suivi-v2-side-head span { font-size: 12px; color: var(--color-muted); font-weight: 600; }
.suivi-v2-side-list { display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 12px; margin: 0; }
.suivi-v2-side-list dt { color: var(--color-faint); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; align-self: center; }
.suivi-v2-side-list dd { margin: 0; color: var(--color-text); font-weight: 700; }
.suivi-v2-side-list a { color: var(--color-or-dark); text-decoration: none; }
.suivi-v2-side-list a:hover { color: var(--color-or); }
.suivi-v2-side-progress-head { display: flex; justify-content: space-between; font-size: 11px; font-weight: 900; color: var(--color-muted); margin-bottom: 6px; }
.suivi-v2-side-progress-head strong { color: var(--color-or-dark); font-size: 14px; }
.suivi-v2-side-progress-track { height: 6px; border-radius: 999px; background: var(--color-line); overflow: hidden; }
.suivi-v2-side-progress-fill { height: 100%; background: linear-gradient(90deg, var(--color-or-light), var(--color-or)); border-radius: 999px; transition: width .4s ease; }
.suivi-v2-side-actions { display: flex; flex-direction: column; gap: 8px; }
.suivi-v2-side-cta { padding: 10px 14px; border-radius: 12px; background: var(--color-or); color: #fff; text-decoration: none; font-size: 12px; font-weight: 850; text-align: center; transition: background .18s; }
.suivi-v2-side-cta:hover { background: var(--color-or-dark); }
.suivi-v2-side-cta.secondary { background: transparent; color: var(--color-or-dark); border: 1px solid var(--color-line); }
.suivi-v2-side-cta.secondary:hover { background: var(--color-or-tint); }

/* Timeline */
.suivi-v2-timeline-wrap { padding: 22px; }
.suivi-v2-timeline-head { margin-bottom: 14px; }
.suivi-v2-timeline-head h2 { margin: 0 0 4px; font-size: 18px; font-weight: 900; color: var(--color-text); }
.suivi-v2-timeline-head p { margin: 0; font-size: 12px; color: var(--color-muted); font-weight: 600; }

.suivi-v2-timeline { list-style: none; padding: 0; margin: 0; position: relative; }
.suivi-v2-timeline::before { content: ''; position: absolute; left: 21px; top: 8px; bottom: 8px; width: 2px; background: var(--color-line); border-radius: 999px; }

.suivi-v2-step { display: grid; grid-template-columns: 44px 1fr; gap: 14px; align-items: start; padding: 6px 0; position: relative; }
.suivi-v2-step.is-last { padding-bottom: 0; }
.suivi-v2-step-circle { width: 44px; height: 44px; border-radius: 999px; border: 2px solid var(--color-line); background: var(--color-cream); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900; color: var(--color-muted); cursor: pointer; z-index: 1; transition: all .18s ease; padding: 0; }
.suivi-v2-step-done .suivi-v2-step-circle { background: var(--color-or); border-color: var(--color-or); color: #fff; }
.suivi-v2-step-active .suivi-v2-step-circle { border-color: var(--color-cuivre); box-shadow: 0 0 0 6px var(--color-or-tint); color: var(--color-or-dark); }
.suivi-v2-step-blocked .suivi-v2-step-circle, .suivi-v2-step-lost .suivi-v2-step-circle { background: var(--color-rouille); border-color: var(--color-rouille); color: #fff; }

.suivi-v2-step-body { border-radius: 14px; transition: background .18s; }
.suivi-v2-step.is-expanded .suivi-v2-step-body { background: var(--color-or-tint); }

.suivi-v2-step-head { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border: none; background: transparent; cursor: pointer; text-align: left; color: inherit; }
.suivi-v2-step-head strong { display: block; font-size: 14px; font-weight: 850; color: var(--color-text); }
.suivi-v2-step-head span { font-size: 11px; color: var(--color-muted); font-weight: 700; }

.suivi-v2-step-panel { padding: 0 14px 14px; }
.suivi-v2-step-detail { margin: 0 0 12px; font-size: 12px; color: var(--color-muted); font-weight: 600; line-height: 1.5; }
.suivi-v2-step-fields { display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 12px; }
.suivi-v2-step-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; font-weight: 900; color: var(--color-faint); }
.suivi-v2-step-fields input, .suivi-v2-step-fields textarea { border: 1px solid var(--color-line); background: rgba(255,255,255,.7); color: var(--color-text); border-radius: 10px; padding: 9px 11px; font-size: 12px; font-weight: 700; font-family: inherit; outline: none; resize: vertical; transition: border-color .18s, background .18s; }
.suivi-v2-step-fields input:focus, .suivi-v2-step-fields textarea:focus { border-color: var(--color-or-light); background: #fff; }
.suivi-v2-step-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.suivi-v2-step-cta { padding: 8px 14px; border-radius: 999px; background: var(--color-or); color: #fff; border: none; font-size: 12px; font-weight: 850; cursor: pointer; transition: background .18s; }
.suivi-v2-step-cta:hover { background: var(--color-or-dark); }
.suivi-v2-step-done .suivi-v2-step-cta { background: transparent; color: var(--color-or-dark); border: 1px solid var(--color-line); }
.suivi-v2-step-done .suivi-v2-step-cta:hover { background: var(--color-or-tint); }
.suivi-v2-step-saved { font-size: 11px; color: var(--color-or-dark); font-weight: 700; opacity: .8; }

/* Responsive */
@media (max-width: 1024px) {
  .suivi-v2-split { grid-template-columns: 320px minmax(0, 1fr); }
  .suivi-v2-kpis { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .suivi-v2-split { grid-template-columns: 1fr; }
  .suivi-v2-side { position: static; }
  .suivi-v2-hero { grid-template-columns: 1fr; }
  .suivi-v2-hero-actions { width: 100%; }
  .suivi-v2-search { width: 100%; }
  .suivi-v2-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 9.3 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 9.4 : Test manuel browser (light mode)**

Naviguer `/#/suivi` → vérifier hero + KPIs + grille stylisés. Cliquer carte → vérifier détail split avec timeline verticale + cercles d'état + click expand accordion. Vérifier responsive (resize window à 768px → 1 col).

- [ ] **Step 9.5 : Commit**

```bash
cd /root/ECOI_frontend && git add src/index.css
git commit -m "feat(suivi): add suivi-v2 light mode styles (glass warm)"
```

---

### Task 10 : CSS `.suivi-v2-*` dark mode overrides

**Files:**
- Modify: `src/index.css` — ajout dans le bloc `[data-theme="dark"]` ou immédiatement après les autres overrides dark existants

- [ ] **Step 10.1 : Trouver la fin du bloc dark mode**

Run: `cd /root/ECOI_frontend && grep -n "^\[data-theme=\"dark\"\]" src/index.css | tail -5`
Repérer la dernière règle `[data-theme="dark"]` et ajouter le bloc juste après.

- [ ] **Step 10.2 : Ajouter le bloc dark à `src/index.css`**

```css
/* === Suivi v2 — dark mode === */
[data-theme="dark"] .suivi-v2-page {
  background:
    radial-gradient(circle at 18% 0%, rgba(78, 150, 103, .12), transparent 42%),
    var(--color-cream-darker);
}

[data-theme="dark"] .suivi-v2-period {
  background: rgba(255, 255, 255, .04);
  border-color: var(--color-line);
}
[data-theme="dark"] .suivi-v2-period button { color: var(--color-muted); }
[data-theme="dark"] .suivi-v2-period button:hover { color: var(--color-text); }
[data-theme="dark"] .suivi-v2-period button.active {
  background: var(--color-or);
  color: #0E1A14;
  box-shadow: 0 6px 18px rgba(78, 150, 103, .35);
}

[data-theme="dark"] .suivi-v2-search {
  background: rgba(255, 255, 255, .04);
  border-color: var(--color-line);
  color: var(--color-text);
}
[data-theme="dark"] .suivi-v2-search:focus {
  background: rgba(255, 255, 255, .08);
  border-color: var(--color-or-light);
}

[data-theme="dark"] .suivi-v2-kpi strong { color: var(--color-or-dark); }
[data-theme="dark"] .suivi-v2-kpi:nth-child(3) strong { color: var(--color-rouille-light); }

[data-theme="dark"] .suivi-v2-card {
  background: rgba(8, 18, 13, .42);
  border-color: var(--color-line);
}
[data-theme="dark"] .suivi-v2-card:hover {
  border-color: var(--color-or);
  box-shadow: 0 24px 60px rgba(0, 0, 0, .42);
}
[data-theme="dark"] .suivi-v2-avatar,
[data-theme="dark"] .suivi-v2-side-avatar {
  background: var(--color-or-tint);
  color: var(--color-or-dark);
}
[data-theme="dark"] .suivi-v2-card-progress-track,
[data-theme="dark"] .suivi-v2-side-progress-track { background: rgba(255, 255, 255, .08); }
[data-theme="dark"] .suivi-v2-card-progress > span { color: var(--color-or-dark); }

[data-theme="dark"] .suivi-v2-empty {
  background: rgba(255, 255, 255, .03);
  border-color: var(--color-line);
}
[data-theme="dark"] .suivi-v2-empty button,
[data-theme="dark"] .suivi-v2-empty a { color: #0E1A14; }

[data-theme="dark"] .suivi-v2-side-list a { color: var(--color-or-dark); }
[data-theme="dark"] .suivi-v2-side-list a:hover { color: var(--color-or-light); }

[data-theme="dark"] .suivi-v2-side-cta { color: #0E1A14; }
[data-theme="dark"] .suivi-v2-side-cta:hover { background: var(--color-or-light); }
[data-theme="dark"] .suivi-v2-side-cta.secondary {
  color: var(--color-or-dark);
  border-color: var(--color-line);
}
[data-theme="dark"] .suivi-v2-side-cta.secondary:hover { background: var(--color-or-tint); }

[data-theme="dark"] .suivi-v2-timeline::before { background: var(--color-line); }
[data-theme="dark"] .suivi-v2-step-circle {
  background: rgba(8, 18, 13, .55);
  border-color: var(--color-line);
  color: var(--color-muted);
}
[data-theme="dark"] .suivi-v2-step-done .suivi-v2-step-circle {
  background: var(--color-or);
  border-color: var(--color-or);
  color: #0E1A14;
}
[data-theme="dark"] .suivi-v2-step-active .suivi-v2-step-circle {
  border-color: var(--color-cuivre);
  box-shadow: 0 0 0 6px var(--color-or-tint);
  color: var(--color-or-dark);
}
[data-theme="dark"] .suivi-v2-step-blocked .suivi-v2-step-circle,
[data-theme="dark"] .suivi-v2-step-lost .suivi-v2-step-circle {
  background: var(--color-rouille);
  border-color: var(--color-rouille);
  color: #0E1A14;
}

[data-theme="dark"] .suivi-v2-step.is-expanded .suivi-v2-step-body { background: var(--color-or-tint); }

[data-theme="dark"] .suivi-v2-step-fields input,
[data-theme="dark"] .suivi-v2-step-fields textarea {
  background: rgba(255, 255, 255, .04);
  border-color: var(--color-line);
  color: var(--color-text);
}
[data-theme="dark"] .suivi-v2-step-fields input:focus,
[data-theme="dark"] .suivi-v2-step-fields textarea:focus {
  background: rgba(255, 255, 255, .08);
  border-color: var(--color-or-light);
}
[data-theme="dark"] .suivi-v2-step-cta { color: #0E1A14; }
[data-theme="dark"] .suivi-v2-step-cta:hover { background: var(--color-or-light); }
[data-theme="dark"] .suivi-v2-step-done .suivi-v2-step-cta {
  background: transparent;
  color: var(--color-or-dark);
  border-color: var(--color-line);
}
[data-theme="dark"] .suivi-v2-step-saved { color: var(--color-or-dark); }
```

- [ ] **Step 10.3 : Build**

Run: `cd /root/ECOI_frontend && npm run build`
Attendu : exit 0.

- [ ] **Step 10.4 : Test manuel browser (dark mode)**

Toggle dark mode via la sidebar (lune/soleil) → vérifier que :
- Fond passe en cream-darker `#060F0B`
- Vert reste lisible : cercles done, progress bar, accents
- Cuivre pulsant reste visible sur étape active
- Cards glass dark s'affichent correctement
- Texte lisible (contraste OK)

Toggle de nouveau light → tout doit retrouver son apparence light originale.

- [ ] **Step 10.5 : Commit**

```bash
cd /root/ECOI_frontend && git add src/index.css
git commit -m "feat(suivi): add suivi-v2 dark mode overrides"
```

---

### Task 11 : Cleanup ancien CSS `.suivi-*` legacy

**Files:**
- Modify: `src/index.css` — suppression bloc legacy `.suivi-*` (lignes ~3581-3744)

- [ ] **Step 11.1 : Vérifier qu'aucun autre fichier que `Suivi.tsx` (refondu) n'utilise les anciennes classes**

Run: `cd /root/ECOI_frontend && grep -rn "suivi-page\|suivi-hero\|suivi-workflow\|suivi-list-card\|suivi-node\|suivi-position\|suivi-period-card\|suivi-period-switch\|suivi-period-actions\|suivi-kpi\b\|suivi-switches\|suivi-editor-fields" src/ --include="*.tsx" --include="*.ts"`
Attendu : aucun match (sinon, identifier le composant qui les utilise encore et NE PAS supprimer ces classes-là).

- [ ] **Step 11.2 : Identifier les lignes à supprimer**

Run: `cd /root/ECOI_frontend && grep -n "^\.suivi-" src/index.css | head -3 && grep -n "^\.suivi-" src/index.css | tail -3`
Noter la ligne de la première règle `.suivi-page` (≈ 3581) et la dernière règle legacy `.suivi-*` (avant le bloc `.suivi-v2-*` ajouté en task 9 — ≈ 3744).

- [ ] **Step 11.3 : Supprimer le bloc legacy**

Avec Edit, retirer toutes les règles `.suivi-*` qui ne sont PAS préfixées `.suivi-v2-*`. Si le bloc est contigu, supprimer d'un coup. Sinon, supprimer règle par règle.

Repère visuel : commencer à `.suivi-page {` (ligne ~3581) et terminer juste avant `/* === Suivi v2 — light mode === */` (ajouté en task 9).

- [ ] **Step 11.4 : Vérifier qu'il ne reste pas de styles `[data-theme="dark"] .suivi-...` legacy non-v2**

Run: `cd /root/ECOI_frontend && grep -n 'data-theme="dark"\] .suivi-' src/index.css | grep -v 'suivi-v2'`
Attendu : aucun match.
Si match : supprimer aussi ces overrides.

- [ ] **Step 11.5 : Build + test final**

Run: `cd /root/ECOI_frontend && npm run build && npm run lint`
Attendu : tous exit 0.

Test browser :
- `/#/suivi` index → toujours stylé
- Cliquer carte → détail toujours stylé
- Toggle dark → toujours OK

- [ ] **Step 11.6 : Commit**

```bash
cd /root/ECOI_frontend && git add src/index.css
git commit -m "chore(suivi): remove legacy .suivi-* CSS (superseded by v2)"
```

---

### Task 12 : Renommer `.suivi-v2-*` → `.suivi-*` (cleanup final)

**Files:**
- Modify: `src/index.css`, tous les composants sous `src/components/suivi/`, `src/pages/Suivi.tsx`, `src/pages/SuiviDetail.tsx`

> Cette task est OPTIONNELLE. Le préfixe `v2` peut rester si le user préfère garder un marqueur visible. Si elle est sautée, c'est OK — la refonte est complète et fonctionnelle sans renommage.

- [ ] **Step 12.1 : Demander confirmation utilisateur**

Demander : "Renommer `.suivi-v2-*` en `.suivi-*` maintenant que l'ancien CSS est supprimé ? Ou garder le préfixe v2 ?"

Si "garder v2" → sauter au step 12.6 (final QA).
Si "renommer" → continuer.

- [ ] **Step 12.2 : Renommer dans le CSS**

Run: `cd /root/ECOI_frontend && sed -i 's/suivi-v2-/suivi-/g' src/index.css`

- [ ] **Step 12.3 : Renommer dans les composants TypeScript**

Run: `cd /root/ECOI_frontend && grep -rln 'suivi-v2-' src/ | xargs sed -i 's/suivi-v2-/suivi-/g'`

- [ ] **Step 12.4 : Build + lint**

Run: `cd /root/ECOI_frontend && npm run build && npm run lint`
Attendu : tous exit 0.

- [ ] **Step 12.5 : Test browser final**

`/#/suivi` → tout doit fonctionner identique. Toggle dark/light → idem.

- [ ] **Step 12.6 : QA final**

Checklist (cf. SPEC section 12) :
- [ ] `/suivi` affiche grille cards
- [ ] `/suivi/:id` affiche split sidebar + timeline
- [ ] `/suivi?lead=X` redirige vers `/suivi/X`
- [ ] Role non-admin/non-delivrabilite est redirigé vers `/overview`
- [ ] Dark mode lisible, vert principal visible en light + dark
- [ ] Click étape → accordion expand (pas de modal)
- [ ] Notes/dates dans accordion → autosave après 500ms
- [ ] Refresh page après modif → données préservées (localStorage clé `ecoi.suivi.workflow.v1:<id>`)
- [ ] `npm run build` passe
- [ ] `npm run lint` passe

- [ ] **Step 12.7 : Commit final**

```bash
cd /root/ECOI_frontend && git add -A
git commit -m "refactor(suivi): rename .suivi-v2-* to .suivi-* now that legacy is removed"
```

---

## Self-Review checklist

**Couverture SPEC** :
- ✅ Section 3 (routes) → Task 2
- ✅ Section 4 (tokens light + dark) → Task 9 + 10
- ✅ Section 5 (index) → Task 3 + 4 + CSS dans 9
- ✅ Section 6 (détail split) → Task 5 + 7 + 8 + CSS dans 9
- ✅ Section 6.4 (accordion édition) → Task 6
- ✅ Section 7 (composants) → Tasks 3-8
- ✅ Section 8 (plan CSS) → Tasks 9-11
- ✅ Section 9 (routing) → Task 2
- ✅ Section 10 (a11y : aria-expanded, focus visible) → Task 6 + CSS focus dans Task 9
- ✅ Section 11 (responsive) → CSS @media dans Task 9
- ✅ Section 12 (critères d'acceptation) → checklist QA Task 12.6

**Risques mémoire** :
- ✅ `saas-ecoi-build-verification` → `npm run build` à chaque task
- ✅ `saas-ecoi-monorepo-wip-risk` → préflight git status + rappel à QA
- ✅ `feedback_saas_ecoi_design_first` → pas de tests unitaires, vérification design en browser

**Notes pour l'exécutant** :
- Garder le dev server `npm run dev` actif tout le long pour QA en continu.
- Si une icône `chevron-up`/`chevron-down`/`check` manque (Task 6.2), utiliser une icône équivalente ou ajouter au registre.
- Si `ghlContactId` n'existe pas sur `LeadResponse` (Task 5.2), retirer le bouton GHL.
- Ne PAS supprimer le préfixe `v2` avant la task 12 — il sert de marqueur de transition.
- Si l'exécution est interrompue : reprendre à la prochaine task non-checkée. Chaque task est commit-atomique et fonctionne en isolation.
