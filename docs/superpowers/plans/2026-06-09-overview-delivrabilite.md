# Refonte Overview Délivrabilité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la vue `OverviewSuivi` (overview délivrabilité) par un tableau de bord « pipeline funnel » branché sur les vraies données dossiers (`ClientResponse`).

**Architecture:** Logique de calcul pure et testée dans un nouveau module `src/lib/deliveryOverview.ts` ; `OverviewSuivi` (dans `src/pages/Overview.tsx`) ne porte que le JSX + le state de période. Données via `useClients()` (+ `useRdvList()` pour le CA).

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tailwind v4.

---

## ⚠️ PRÉREQUIS BLOQUANT — merge en cours

Le repo `ECOI_frontend` est **en merge non résolu** (`MERGE_HEAD` présent). Un `git commit` finaliserait ce merge — ce que l'utilisateur a explicitement demandé d'éviter.

**Tant que le merge n'est pas tranché par l'utilisateur :** dans chaque étape « Commit » ci-dessous, exécuter **uniquement le `git add`** (staging), **PAS le `git commit`**. Le commit consolidé se fera une fois la décision merge prise.

De plus, le typecheck global échoue déjà à cause de WIP concurrent inachevé (`ChatPanel.tsx` → deps `@ai-sdk/react`/`ai` absentes ; `Notifications.tsx:44` → `useNotifications().refresh`). **Ne pas chercher à corriger ces erreurs** : elles sont hors périmètre. Pour vérifier notre travail, lancer les tests Vitest ciblés et un typecheck ciblé sur nos fichiers (voir Task 6), pas `tsc -b` global.

---

## Structure des fichiers

- **Créer** `src/lib/deliveryOverview.ts` — fonctions pures : `isStepLate`, `buildDeliveryPipeline`, `selectDeliveryPriorities`, `selectRecentDeliveries` + types associés.
- **Créer** `src/lib/deliveryOverview.test.ts` — tests Vitest du module.
- **Modifier** `src/pages/Overview.tsx` — réécriture du corps de `OverviewSuivi` (~lignes 72-128) + imports.

Types et helpers réutilisés (déjà existants) :
- `ClientResponse`, `ClientPhaseStep`, `WorkflowPhase`, `WorkflowStatus` — `src/lib/types.ts`
- `PHASE_LABEL`, `PHASE_ICON` — `src/lib/suivi-board.ts`
- `SUIVI_PERIOD_OPTIONS`, `buildSuiviPeriodRange`, `SuiviPeriodState` — `src/lib/suivi.ts`
- `fmtKEur`, `fmtCompact`, `userInitials`, `AirKpi`, `CardHead` — déjà définis dans `src/pages/Overview.tsx`
- `useClients`, `useRdvList` — `src/lib/hooks.ts`

Rappel de forme des données :
```ts
ClientResponse = {
  id; leadId; rdvId: string | null
  lead: { fullName: string | null; city: string | null; phone: string | null }
  currentPhase: WorkflowPhase          // 'vt'|'dp'|'racco'|'consuel'|'installation'|'mes'
  blocked: boolean
  missingDocsCount: number
  signedAt: string | null
  steps: Partial<Record<WorkflowPhase, ClientPhaseStep>>
}
ClientPhaseStep = { status: WorkflowStatus; datePlanifiee: string|null; dateRealisee: string|null; problemReason: string|null; responsableId: string|null }
WorkflowStatus = 'a_faire'|'planifie'|'en_cours'|'fait'|'probleme'|'en_attente'|'annule'
RdvResponse.montantTotal: string | null   // ⚠️ string → Number(...)
```

---

## Task 1 : `isStepLate` (heuristique de retard)

**Files:**
- Create: `src/lib/deliveryOverview.ts`
- Test: `src/lib/deliveryOverview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/deliveryOverview.test.ts
import { describe, it, expect } from 'vitest'
import type { ClientPhaseStep } from './types'
import { isStepLate } from './deliveryOverview'

const NOW = new Date('2026-06-09T12:00:00Z')

function step(partial: Partial<ClientPhaseStep>): ClientPhaseStep {
  return { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null, ...partial }
}

describe('isStepLate', () => {
  it('true quand le statut est probleme', () => {
    expect(isStepLate(step({ status: 'probleme' }), NOW)).toBe(true)
  })
  it('true quand planifie avec date passée', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: '2026-06-01' }), NOW)).toBe(true)
  })
  it('false quand planifie avec date future', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: '2026-07-01' }), NOW)).toBe(false)
  })
  it('false quand planifie sans date', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: null }), NOW)).toBe(false)
  })
  it('false pour les autres statuts (a_faire, fait, en_cours)', () => {
    expect(isStepLate(step({ status: 'a_faire' }), NOW)).toBe(false)
    expect(isStepLate(step({ status: 'fait', datePlanifiee: '2026-06-01' }), NOW)).toBe(false)
    expect(isStepLate(step({ status: 'en_cours', datePlanifiee: '2026-06-01' }), NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: FAIL — `isStepLate` introuvable (module `./deliveryOverview` inexistant).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/deliveryOverview.ts
import type { ClientPhaseStep } from './types'

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Généralise isVtEnRetard (technicienStats.ts) à n'importe quelle phase. */
export function isStepLate(step: ClientPhaseStep, now: Date): boolean {
  if (step.status === 'probleme') return true
  if (step.status !== 'planifie') return false
  const planned = parseDate(step.datePlanifiee)
  return planned != null && planned.getTime() < now.getTime()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit** (⚠️ voir PRÉREQUIS : `git add` seul, pas de commit)

```bash
git add src/lib/deliveryOverview.ts src/lib/deliveryOverview.test.ts
# git commit -m "feat(overview): isStepLate pour le pipeline délivrabilité"   # DIFFÉRÉ (merge en cours)
```

---

## Task 2 : `buildDeliveryPipeline` (compteurs par phase + KPIs)

**Files:**
- Modify: `src/lib/deliveryOverview.ts`
- Test: `src/lib/deliveryOverview.test.ts`

- [ ] **Step 1: Write the failing test**

Ajouter en haut du fichier de test l'import et un helper fixture client :

```ts
import { buildDeliveryPipeline } from './deliveryOverview'
import type { ClientResponse, WorkflowPhase } from './types'

function client(partial: Partial<ClientResponse> & { currentPhase: WorkflowPhase }): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', rdvId: null,
    lead: { fullName: 'Test', city: 'Lyon', phone: null },
    technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'en_cours', blocked: false, missingDocsCount: 0,
    signedAt: '2026-06-05', steps: {}, ...partial,
  } as ClientResponse
}
```

Puis le bloc de test :

```ts
describe('buildDeliveryPipeline', () => {
  const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z'), label: 'Année' }

  it('compte les dossiers par currentPhase', () => {
    const clients = [
      client({ currentPhase: 'vt' }),
      client({ currentPhase: 'vt' }),
      client({ currentPhase: 'installation' }),
    ]
    const p = buildDeliveryPipeline(clients, range, NOW)
    expect(p.phases.vt.count).toBe(2)
    expect(p.phases.installation.count).toBe(1)
    expect(p.phases.dp.count).toBe(0)
  })

  it('exclut les dossiers signés hors période (cohorte par signedAt)', () => {
    const clients = [
      client({ currentPhase: 'vt', signedAt: '2026-06-05' }),
      client({ currentPhase: 'vt', signedAt: '2020-01-01' }),
      client({ currentPhase: 'vt', signedAt: null }),
    ]
    const p = buildDeliveryPipeline(clients, range, NOW)
    expect(p.phases.vt.count).toBe(1)
    expect(p.activeCount).toBe(1)
  })

  it('compte retards et docs manquants par phase et au global', () => {
    const clients = [
      client({ currentPhase: 'vt', steps: { vt: { status: 'probleme', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ currentPhase: 'consuel', missingDocsCount: 2 }),
    ]
    const p = buildDeliveryPipeline(clients, range, NOW)
    expect(p.phases.vt.late).toBe(1)
    expect(p.phases.consuel.missingDocs).toBe(1)
    expect(p.lateCount).toBe(1)
    expect(p.missingDocsCount).toBe(1)
  })

  it('compte les dossiers à livrer cette semaine (installation/mes non livrés)', () => {
    const clients = [
      client({ currentPhase: 'installation' }),
      client({ currentPhase: 'mes', steps: { mes: { status: 'en_cours', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ currentPhase: 'mes', steps: { mes: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-08', problemReason: null, responsableId: null } } }),
      client({ currentPhase: 'vt' }),
    ]
    const p = buildDeliveryPipeline(clients, range, NOW)
    expect(p.toDeliverThisWeek).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: FAIL — `buildDeliveryPipeline` introuvable.

- [ ] **Step 3: Write minimal implementation**

Ajouter à `src/lib/deliveryOverview.ts` :

```ts
import type { ClientResponse, WorkflowPhase } from './types'

export const DELIVERY_PHASES: WorkflowPhase[] = ['vt', 'dp', 'racco', 'consuel', 'installation', 'mes']

export type PhaseCounts = { count: number; late: number; missingDocs: number }
export type DeliveryPipeline = {
  phases: Record<WorkflowPhase, PhaseCounts>
  activeCount: number
  lateCount: number
  missingDocsCount: number
  toDeliverThisWeek: number
}

type DateRange = { from: Date; to: Date }

function inRange(signedAt: string | null, range: DateRange): boolean {
  const d = parseDate(signedAt)
  return d != null && d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime()
}

function clientIsLate(c: ClientResponse, now: Date): boolean {
  return Object.values(c.steps).some((s) => s != null && isStepLate(s, now))
}

export function buildDeliveryPipeline(clients: ClientResponse[], range: DateRange, now: Date): DeliveryPipeline {
  const phases = Object.fromEntries(
    DELIVERY_PHASES.map((p) => [p, { count: 0, late: 0, missingDocs: 0 }]),
  ) as Record<WorkflowPhase, PhaseCounts>

  let activeCount = 0
  let lateCount = 0
  let missingDocsCount = 0
  let toDeliverThisWeek = 0

  for (const c of clients) {
    if (!inRange(c.signedAt, range)) continue
    activeCount += 1
    const bucket = phases[c.currentPhase]
    if (bucket) bucket.count += 1

    const late = clientIsLate(c, now)
    if (late) { lateCount += 1; if (bucket) bucket.late += 1 }
    if (c.missingDocsCount > 0) { missingDocsCount += 1; if (bucket) bucket.missingDocs += 1 }

    const isDelivered = c.steps.mes?.status === 'fait'
    if ((c.currentPhase === 'installation' || c.currentPhase === 'mes') && !isDelivered) {
      toDeliverThisWeek += 1
    }
  }

  return { phases, activeCount, lateCount, missingDocsCount, toDeliverThisWeek }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: PASS (Task 1 + Task 2).

- [ ] **Step 5: Commit** (⚠️ `git add` seul)

```bash
git add src/lib/deliveryOverview.ts src/lib/deliveryOverview.test.ts
# git commit -m "feat(overview): buildDeliveryPipeline"   # DIFFÉRÉ
```

---

## Task 3 : `selectDeliveryPriorities` (file triée par urgence)

**Files:**
- Modify: `src/lib/deliveryOverview.ts`
- Test: `src/lib/deliveryOverview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { selectDeliveryPriorities } from './deliveryOverview'

describe('selectDeliveryPriorities', () => {
  it('met les dossiers bloqués en tête, puis retard le plus ancien, puis docs manquants', () => {
    const clients = [
      client({ id: 'docs', currentPhase: 'consuel', missingDocsCount: 1 }),
      client({ id: 'late-old', currentPhase: 'racco', steps: { racco: { status: 'planifie', datePlanifiee: '2026-05-01', dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ id: 'blocked', currentPhase: 'vt', blocked: true }),
      client({ id: 'late-recent', currentPhase: 'vt', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-08', dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ id: 'clean', currentPhase: 'installation' }),
    ]
    const rows = selectDeliveryPriorities(clients, NOW)
    expect(rows.map((r) => r.client.id)).toEqual(['blocked', 'late-old', 'late-recent', 'docs'])
  })

  it('exclut les dossiers sans problème (ni bloqué, ni retard, ni docs manquants)', () => {
    const rows = selectDeliveryPriorities([client({ id: 'clean', currentPhase: 'mes' })], NOW)
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: FAIL — `selectDeliveryPriorities` introuvable.

- [ ] **Step 3: Write minimal implementation**

Ajouter à `src/lib/deliveryOverview.ts` :

```ts
export type PriorityReason = 'blocked' | 'late' | 'missing_docs'
export type PriorityRow = { client: ClientResponse; reason: PriorityReason; lateSince: number | null }

function earliestLateTime(c: ClientResponse, now: Date): number | null {
  let earliest: number | null = null
  for (const s of Object.values(c.steps)) {
    if (s == null || !isStepLate(s, now)) continue
    const d = parseDate(s.datePlanifiee)
    const t = d != null ? d.getTime() : now.getTime()
    if (earliest == null || t < earliest) earliest = t
  }
  return earliest
}

export function selectDeliveryPriorities(clients: ClientResponse[], now: Date): PriorityRow[] {
  const rows: PriorityRow[] = []
  for (const c of clients) {
    const lateSince = earliestLateTime(c, now)
    if (c.blocked) rows.push({ client: c, reason: 'blocked', lateSince })
    else if (lateSince != null) rows.push({ client: c, reason: 'late', lateSince })
    else if (c.missingDocsCount > 0) rows.push({ client: c, reason: 'missing_docs', lateSince: null })
  }
  const rank: Record<PriorityReason, number> = { blocked: 0, late: 1, missing_docs: 2 }
  return rows.sort((a, b) => {
    if (rank[a.reason] !== rank[b.reason]) return rank[a.reason] - rank[b.reason]
    if (a.lateSince != null && b.lateSince != null) return a.lateSince - b.lateSince
    return b.client.missingDocsCount - a.client.missingDocsCount
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (⚠️ `git add` seul)

```bash
git add src/lib/deliveryOverview.ts src/lib/deliveryOverview.test.ts
# git commit -m "feat(overview): selectDeliveryPriorities"   # DIFFÉRÉ
```

---

## Task 4 : `selectRecentDeliveries` (mises en service récentes)

**Files:**
- Modify: `src/lib/deliveryOverview.ts`
- Test: `src/lib/deliveryOverview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { selectRecentDeliveries } from './deliveryOverview'

describe('selectRecentDeliveries', () => {
  const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z'), label: 'Année' }
  const mesStep = (dateRealisee: string | null) => ({ mes: { status: 'fait' as const, datePlanifiee: null, dateRealisee, problemReason: null, responsableId: null } })

  it('ne garde que les dossiers en mes avec dateRealisee dans la période, triés desc', () => {
    const clients = [
      client({ id: 'old', currentPhase: 'mes', steps: mesStep('2026-03-01') }),
      client({ id: 'recent', currentPhase: 'mes', steps: mesStep('2026-06-08') }),
      client({ id: 'out', currentPhase: 'mes', steps: mesStep('2020-01-01') }),
      client({ id: 'notmes', currentPhase: 'installation', steps: {} }),
      client({ id: 'nodate', currentPhase: 'mes', steps: mesStep(null) }),
    ]
    const res = selectRecentDeliveries(clients, range)
    expect(res.map((c) => c.id)).toEqual(['recent', 'old'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: FAIL — `selectRecentDeliveries` introuvable.

- [ ] **Step 3: Write minimal implementation**

Ajouter à `src/lib/deliveryOverview.ts` :

```ts
export function selectRecentDeliveries(clients: ClientResponse[], range: DateRange): ClientResponse[] {
  return clients
    .filter((c) => {
      if (c.currentPhase !== 'mes') return false
      const d = parseDate(c.steps.mes?.dateRealisee ?? null)
      return d != null && d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime()
    })
    .sort((a, b) => {
      const da = parseDate(a.steps.mes?.dateRealisee ?? null)?.getTime() ?? 0
      const db = parseDate(b.steps.mes?.dateRealisee ?? null)?.getTime() ?? 0
      return db - da
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: PASS (toutes les tâches 1-4).

- [ ] **Step 5: Commit** (⚠️ `git add` seul)

```bash
git add src/lib/deliveryOverview.ts src/lib/deliveryOverview.test.ts
# git commit -m "feat(overview): selectRecentDeliveries"   # DIFFÉRÉ
```

---

## Task 5 : Réécriture du JSX de `OverviewSuivi`

**Files:**
- Modify: `src/pages/Overview.tsx` (corps de `OverviewSuivi`, ~lignes 72-128 ; imports en tête)

> Pas de test unitaire RTL ici (la vue est de la composition pure au-dessus de fonctions déjà testées + hooks réseau). La vérification se fait au Task 6 (typecheck ciblé + lint + rendu manuel).

- [ ] **Step 1: Ajouter les imports nécessaires en tête de `Overview.tsx`**

Ajouter après les imports existants (vérifier qu'aucun doublon n'est introduit) :

```ts
import { useClients } from '../lib/hooks'   // si absent de l'import hooks existant, l'ajouter à la liste existante
import { PHASE_LABEL, PHASE_ICON } from '../lib/suivi-board'
import { buildDeliveryPipeline, selectDeliveryPriorities, selectRecentDeliveries, DELIVERY_PHASES } from '../lib/deliveryOverview'
import type { ClientResponse } from '../lib/types'   // si absent
```

`useRdvList`, `SUIVI_PERIOD_OPTIONS`, `buildSuiviPeriodRange`, `SuiviPeriodState`, `useState`, `useMemo`, `useNavigate` sont déjà importés (vérifier).

- [ ] **Step 2: Remplacer entièrement le corps de la fonction `OverviewSuivi`**

Remplacer de la ligne `function OverviewSuivi() {` jusqu'à son `}` fermant (juste avant `function OverviewResponsableTechnique() {`) par :

```tsx
function OverviewSuivi() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<SuiviPeriodState>({
    mode: 'this_year',
    customFrom: '',
    customTo: '',
  })
  const range = useMemo(() => buildSuiviPeriodRange(period), [period])
  const now = useMemo(() => new Date(), [])

  const { data: clientsData } = useClients()
  const { data: rdvsData } = useRdvList({ limit: 500 })
  const clients = clientsData ?? []
  const rdvs = rdvsData ?? []

  const pipeline = useMemo(() => buildDeliveryPipeline(clients, range, now), [clients, range, now])
  const priorities = useMemo(() => selectDeliveryPriorities(clients, now).slice(0, 6), [clients, now])
  const recent = useMemo(() => selectRecentDeliveries(clients, range).slice(0, 5), [clients, range])

  // CA en livraison : somme des montants RDV des dossiers de la cohorte (jointure par leadId).
  const cohortLeadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of clients) {
      const d = c.signedAt ? new Date(c.signedAt) : null
      if (d && d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime()) ids.add(c.leadId)
    }
    return ids
  }, [clients, range])
  const caEnLivraison = useMemo(
    () => rdvs.filter((r) => cohortLeadIds.has(r.leadId)).reduce((sum, r) => sum + (Number(r.montantTotal ?? 0) || 0), 0),
    [rdvs, cohortLeadIds],
  )

  const badgeFor = (row: (typeof priorities)[number]): { text: string; cls: string } => {
    if (row.reason === 'blocked') return { text: 'Bloqué', cls: 'bg-danger/10 text-danger' }
    if (row.reason === 'late') {
      const days = row.lateSince != null ? Math.max(0, Math.round((now.getTime() - row.lateSince) / 86_400_000)) : 0
      return { text: `Retard J+${days}`, cls: 'bg-danger/10 text-danger' }
    }
    return { text: 'Doc manquant', cls: 'bg-warning/10 text-warning' }
  }

  return (
    <AppShell flat>
      <Topbar eyebrow="DÉLIVRABILITÉ" title="Pipeline livraison" />
      <main className="overview-shot-page flex-grow overflow-auto">
        <div className="overview-air-header">
          <div>
            <span className="shot-eyebrow">Post-signature · pilotage</span>
            <h1>Pipeline de livraison des dossiers</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            {SUIVI_PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod((p) => ({ ...p, mode: opt.id }))}
                className={`rounded-full px-3 py-1.5 text-xs font-black border transition ${period.mode === opt.id ? 'bg-text text-white border-text' : 'border-line-soft text-muted'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zone 1 — Tunnel des 6 phases (cliquable) */}
        <section className="overview-delivery-funnel">
          {DELIVERY_PHASES.map((phase, i) => {
            const c = pipeline.phases[phase]
            return (
              <div key={phase} className="overview-delivery-funnel-step">
                <button type="button" onClick={() => navigate(`/suivi?phase=${phase}`)} className="overview-delivery-phase">
                  <Icon name={PHASE_ICON[phase]} size={16} />
                  <strong>{fmtCompact(c.count)}</strong>
                  <small>{PHASE_LABEL[phase]}</small>
                  <span className="overview-delivery-phase-mini">
                    {c.late > 0 && <em className="text-danger">{c.late} ret.</em>}
                    {c.missingDocs > 0 && <em className="text-warning">{c.missingDocs} doc</em>}
                  </span>
                </button>
                {i < DELIVERY_PHASES.length - 1 && <span className="overview-delivery-arrow" aria-hidden>›</span>}
              </div>
            )
          })}
        </section>

        {/* Zone 2 — KPIs de santé */}
        <section className="overview-air-grid">
          <AirKpi icon="grid" label="Dossiers actifs" value={fmtCompact(pipeline.activeCount)} sub="en livraison" />
          <AirKpi icon="shield" label="Retards SLA" value={fmtCompact(pipeline.lateCount)} sub="à débloquer" />
          <AirKpi icon="inbox" label="Docs manquants" value={fmtCompact(pipeline.missingDocsCount)} sub="à compléter" />
          <AirKpi icon="check" label="À livrer cette sem." value={fmtCompact(pipeline.toDeliverThisWeek)} sub="installation / MES" />
          <AirKpi icon="tag" label="CA en livraison" value={fmtKEur(caEnLivraison)} sub="base RDV signés" />
        </section>

        <div className="overview-delivery-lists">
          {/* Zone 3 — File de priorités */}
          <div className="overview-air-card">
            <CardHead title="À traiter en priorité" icon="bell" />
            <div className="overview-role-list">
              {priorities.map((row) => {
                const badge = badgeFor(row)
                return (
                  <div key={row.client.id} className="overview-role-row">
                    <div className="overview-role-avatar">{userInitials(row.client.lead.fullName)}</div>
                    <div>
                      <strong>{row.client.lead.fullName || row.client.lead.phone || '—'}</strong>
                      <small>{row.client.lead.city ?? '—'} · {PHASE_LABEL[row.client.currentPhase]}</small>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
                    <button onClick={() => navigate(`/suivi?lead=${row.client.leadId}`)}>Suivi</button>
                  </div>
                )
              })}
              {priorities.length === 0 && <div className="text-xs text-faint">Aucun dossier à traiter.</div>}
            </div>
          </div>

          {/* Zone 4 — Dernières livraisons */}
          <div className="overview-air-card">
            <CardHead title="Dernières livraisons" icon="trophy" />
            <div className="overview-role-list">
              {recent.map((c) => (
                <div key={c.id} className="overview-role-row">
                  <div className="overview-role-avatar">{userInitials(c.lead.fullName)}</div>
                  <div>
                    <strong>{c.lead.fullName || c.lead.phone || '—'}</strong>
                    <small>Mise en service · {c.steps.mes?.dateRealisee ?? '—'}</small>
                  </div>
                  <span className="text-[10px] font-black px-2 py-1 rounded-full bg-success/10 text-success">livré ✓</span>
                </div>
              ))}
              {recent.length === 0 && <div className="text-xs text-faint">Aucune livraison récente.</div>}
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 3: Ajouter le CSS des nouvelles classes**

Dans `src/index.css`, à la suite des autres règles `overview-*` (rechercher `overview-air-grid` pour situer la zone), ajouter :

```css
.overview-delivery-funnel { display: flex; align-items: stretch; gap: 6px; margin: 18px 0; flex-wrap: wrap; }
.overview-delivery-funnel-step { display: flex; align-items: center; flex: 1; min-width: 120px; }
.overview-delivery-phase { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px; border: 1px solid var(--line-soft); border-radius: 16px; background: rgba(255,255,255,.7); cursor: pointer; transition: border-color .15s; text-align: center; }
.overview-delivery-phase:hover { border-color: rgba(31,120,87,.5); }
.overview-delivery-phase strong { font-size: 22px; line-height: 1.1; }
.overview-delivery-phase small { font-size: 10px; color: var(--muted); }
.overview-delivery-phase-mini { display: flex; gap: 6px; font-size: 9px; font-style: normal; min-height: 12px; }
.overview-delivery-phase-mini em { font-weight: 800; font-style: normal; }
.overview-delivery-arrow { color: var(--line-soft); font-weight: 900; padding: 0 2px; }
.overview-delivery-lists { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; margin-top: 14px; }
@media (max-width: 860px) { .overview-delivery-lists { grid-template-columns: 1fr; } }
```

> Si une variable CSS (`--line-soft`, `--muted`) n'existe pas, reprendre celle utilisée par les classes `overview-air-*` voisines (les inspecter dans `index.css`).

- [ ] **Step 4: Commit** (⚠️ `git add` seul)

```bash
git add src/pages/Overview.tsx src/index.css
# git commit -m "feat(overview): refonte OverviewSuivi en pipeline délivrabilité"   # DIFFÉRÉ
```

---

## Task 6 : Vérification finale

**Files:** aucun changement — vérification seulement.

- [ ] **Step 1: Lancer tous les tests du module**

Run: `npx vitest run src/lib/deliveryOverview.test.ts`
Expected: PASS, tous les `describe` verts.

- [ ] **Step 2: Lint sur les fichiers touchés**

Run: `npx eslint src/lib/deliveryOverview.ts src/lib/deliveryOverview.test.ts src/pages/Overview.tsx`
Expected: aucune erreur (warnings préexistants tolérés).

- [ ] **Step 3: Typecheck — vérifier l'ABSENCE de nouvelles erreurs sur nos fichiers**

Run: `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E 'deliveryOverview|OverviewSuivi|Overview.tsx'`
Expected: **aucune ligne** (les seules erreurs `tsc` restantes doivent être les erreurs WIP préexistantes : `ChatPanel.tsx`, `Notifications.tsx:44`). Si une erreur mentionne nos fichiers, la corriger.

- [ ] **Step 4: Rendu manuel**

Lancer le dev server (`npm run dev`), se connecter avec un compte rôle `delivrabilite`, ouvrir `/overview`. Vérifier : le tunnel 6 phases s'affiche avec compteurs, les KPIs sont remplis, la file de priorités et les dernières livraisons se peuplent, le filtre de période réagit, un clic sur une phase navigue vers `/suivi`.

> ⚠️ Le dev server peut échouer à compiler tant que les deps WIP (`@ai-sdk/react`, `ai`) sont absentes. Si c'est le cas, c'est un blocage WIP/merge à lever d'abord (`npm install` + décision merge), hors périmètre de ce plan.

- [ ] **Step 5: Commit consolidé** (⚠️ UNIQUEMENT après décision merge de l'utilisateur)

```bash
git add docs/superpowers/specs/2026-06-09-overview-delivrabilite-design.md docs/superpowers/plans/2026-06-09-overview-delivrabilite.md src/lib/deliveryOverview.ts src/lib/deliveryOverview.test.ts src/pages/Overview.tsx src/index.css
# git commit  → seulement quand l'utilisateur a tranché le merge en cours
```

---

## Self-review (vérifié)

- **Couverture spec** : tunnel (Task 5 z1) · KPIs (z2) · file priorités (Task 3+5 z3) · dernières livraisons (Task 4+5 z4) · filtre période (Task 5) · `isStepLate` (Task 1) · `buildDeliveryPipeline` cohorte par `signedAt` (Task 2) · CA via jointure RDV (Task 5). ✓
- **Pas de placeholder** : code complet à chaque étape. ✓
- **Cohérence des types** : `DeliveryPipeline`, `PhaseCounts`, `PriorityRow`, `DELIVERY_PHASES`, `isStepLate`, `buildDeliveryPipeline`, `selectDeliveryPriorities`, `selectRecentDeliveries` — noms identiques entre définition (Tasks 1-4) et usage (Task 5). ✓
- **Contrainte merge** : commits différés explicitement à chaque tâche. ✓
