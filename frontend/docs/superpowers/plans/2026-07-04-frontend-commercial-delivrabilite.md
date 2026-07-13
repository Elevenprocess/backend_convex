# Frontend commercial & délivrabilité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de l'accueil de chaque rôle (commercial, délivrabilité) son poste de pilotage quotidien : stats/RDV/leads pour le commercial, file de travail priorisée + guide des phases pour la délivrabilité.

**Architecture:** Tout est frontend (React 19 + Vite + Tailwind/custom CSS, state via hooks maison `useFetch`). Les endpoints backend nécessaires existent déjà (`GET /rdv` auto-scopé commercial, `GET /analytics/commercials/:id` auto-scopé, `GET /clients`). On ajoute deux modules de logique pure testables (`phase-guide.ts`, `commercialHome.ts`), trois composants (`PhaseHelp`, `DeliveryWorkQueue`, blocs commercial), et on modifie `Overview.tsx`, `WorkflowBoard.tsx`, `Suivi.tsx`.

**Tech Stack:** React 19, TypeScript, vitest + @testing-library/react (jsdom), CSS custom dans `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-07-04-frontend-commercial-delivrabilite-design.md`

## Global Constraints

- Répertoire de travail : `/workspace/Desktop/SaaS ecoi/ECOI_frontend` (repo git, branche `main`, NE PAS pousser).
- **Repo partagé** : des fichiers WIP tiers existent (`src/lib/api.ts` modifié, `src/components/suivi/NewClientModal.tsx`/`.test.tsx` non suivis). `git add` avec chemins explicites UNIQUEMENT, jamais `git add -A` ni `git commit -a`. Ne jamais committer `src/lib/api.ts`.
- Validation TypeScript : `npx tsc -b` (PAS `tsc --noEmit` — le build Render utilise `tsc -b`). Ne jamais lancer tsc sur ECOI_backend (OOM).
- Tests : `npx vitest run <fichier>` ; suite complète `npx vitest run`.
- Aucun changement backend, aucune route, aucun guard, aucune permission modifiés. `RdvCalendarGuard` reste en place.
- Textes UI en français. Commits en français, format `feat(scope): …`, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Note spec vs réalité : le mode « dépôt seul » est porté par les **sous-étapes** (`SubstepResponse.depositOnly`, il masque Date/Notes/Technicien dans le pop-up) — les 6 phases restent présentes sur tous les dossiers (`client.steps`). Le guide des phases n'a donc PAS de filtrage par dossier ; il mentionne simplement le cas dépôt-seul dans son texte.

---

### Task 1: Guide des phases — logique pure (`phase-guide.ts`)

**Files:**
- Create: `src/lib/phase-guide.ts`
- Test: `src/lib/phase-guide.test.ts`

**Interfaces:**
- Consumes: `WorkflowPhase` (`src/lib/types.ts`), `PHASE_LABEL` (`src/lib/suivi-board.ts`), `PriorityRow` (`src/lib/deliveryOverview.ts`, forme `{ client: ClientResponse; reason: 'blocked'|'late'|'missing_docs'; lateSince: number|null }`).
- Produces: `PHASE_GUIDE: Record<WorkflowPhase, PhaseGuideEntry>` avec `PhaseGuideEntry = { objectif: string; docs: string[]; cloture: string; action: string; suivante: WorkflowPhase | null }`, et `nextActionLabel(row: PriorityRow): string`. Tasks 2, 4, 5 en dépendent.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/lib/phase-guide.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { PHASE_GUIDE, nextActionLabel } from './phase-guide'
import { DELIVERY_PHASES } from './deliveryOverview'
import type { ClientResponse, WorkflowPhase } from './types'

function makeClient(over: Partial<ClientResponse> = {}): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', projectId: null, rdvId: null,
    lead: { fullName: 'Jean Test', city: 'Pau', phone: null },
    technicienVtId: null, techniciens: [], poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'actif', currentPhase: 'vt', blocked: false, missingDocsCount: 0,
    signedAt: null, steps: {},
    ...over,
  }
}

describe('PHASE_GUIDE', () => {
  it('couvre les 6 phases avec un contenu complet', () => {
    for (const phase of DELIVERY_PHASES) {
      const g = PHASE_GUIDE[phase]
      expect(g, phase).toBeDefined()
      expect(g.objectif.length, `${phase}.objectif`).toBeGreaterThan(10)
      expect(g.cloture.length, `${phase}.cloture`).toBeGreaterThan(5)
      expect(g.action.length, `${phase}.action`).toBeGreaterThan(5)
    }
  })

  it('chaîne les phases dans l’ordre du pipeline (vt → … → mes → null)', () => {
    const chain: WorkflowPhase[] = ['vt']
    while (chain.length < 10) {
      const next = PHASE_GUIDE[chain[chain.length - 1]].suivante
      if (next == null) break
      chain.push(next)
    }
    expect(chain).toEqual(DELIVERY_PHASES)
  })
})

describe('nextActionLabel', () => {
  it('bloqué → « Débloquer — <phase> »', () => {
    const row = { client: makeClient({ currentPhase: 'racco', blocked: true }), reason: 'blocked' as const, lateSince: null }
    expect(nextActionLabel(row)).toBe('Débloquer — Raccordement')
  })

  it('docs manquants → « Compléter N document(s) » (singulier/pluriel)', () => {
    const one = { client: makeClient({ missingDocsCount: 1 }), reason: 'missing_docs' as const, lateSince: null }
    const three = { client: makeClient({ missingDocsCount: 3 }), reason: 'missing_docs' as const, lateSince: null }
    expect(nextActionLabel(one)).toBe('Compléter 1 document')
    expect(nextActionLabel(three)).toBe('Compléter 3 documents')
  })

  it('retard → action du guide pour la phase courante', () => {
    const row = { client: makeClient({ currentPhase: 'consuel' }), reason: 'late' as const, lateSince: Date.now() }
    expect(nextActionLabel(row)).toBe(PHASE_GUIDE.consuel.action)
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx vitest run src/lib/phase-guide.test.ts`
Expected: FAIL — `Cannot find module './phase-guide'` (ou équivalent).

- [ ] **Step 3: Implémenter `src/lib/phase-guide.ts`**

```ts
import type { WorkflowPhase } from './types'
import { PHASE_LABEL } from './suivi-board'
import type { PriorityRow } from './deliveryOverview'

export type PhaseGuideEntry = {
  /** Ce que la phase accomplit, en une phrase. */
  objectif: string
  /** Pièces attendues pendant la phase (libellés lisibles, cf. DOC_TYPE_LABEL). */
  docs: string[]
  /** Ce qui clôture la phase. */
  cloture: string
  /** Prochaine action attendue quand un dossier est à cette phase (file de travail). */
  action: string
  suivante: WorkflowPhase | null
}

/**
 * Guide statique du workflow délivrabilité, à destination des nouveaux :
 * alimente les popovers « ? » (tunnel Overview, sections WorkflowBoard) et les
 * libellés « prochaine action » de la file de travail. L'ordre des phases reste
 * porté par DELIVERY_PHASES / PHASE_ORDER — ici uniquement du texte.
 */
export const PHASE_GUIDE: Record<WorkflowPhase, PhaseGuideEntry> = {
  vt: {
    objectif: 'Vérifier la faisabilité technique du projet chez le client (visite technique).',
    docs: ['Rapport de VT'],
    cloture: 'VT validée par le technicien — sinon dossier bloqué / vente annulée.',
    action: 'Planifier ou valider la VT',
    suivante: 'dp',
  },
  dp: {
    objectif: "Obtenir l'accord d'urbanisme de la mairie (déclaration préalable), en parallèle du raccordement.",
    docs: ['Récépissé de DP', 'Certificat de non-opposition'],
    cloture: 'DP validée : certificat de non-opposition reçu.',
    action: 'Faire avancer la DP en mairie',
    suivante: 'racco',
  },
  racco: {
    objectif: "Demander le raccordement de l'installation au réseau Enedis, en parallèle de la DP.",
    docs: ['Récépissé de raccordement', 'CRAE'],
    cloture: 'Raccordement validé : CRAE reçu (en mode dépôt seul, cette étape est simplifiée).',
    action: 'Faire avancer le raccordement',
    suivante: 'installation',
  },
  installation: {
    objectif: 'Poser le matériel chez le client — date, heure et technicien(s) planifiés.',
    docs: [],
    cloture: "Installation effectuée — déclenche l'alerte du solde à encaisser.",
    action: "Planifier ou réaliser l'installation",
    suivante: 'consuel',
  },
  consuel: {
    objectif: "Faire certifier la conformité électrique de l'installation (après la pose).",
    docs: ['Attestation Consuel'],
    cloture: 'Attestation Consuel reçue.',
    action: 'Envoyer ou relancer le Consuel',
    suivante: 'mes',
  },
  mes: {
    objectif: "Mettre l'installation en service : le dossier est livré.",
    docs: [],
    cloture: 'Mise en service réalisée — le dossier passe en livré.',
    action: 'Réaliser la mise en service',
    suivante: null,
  },
}

/** Libellé « prochaine action » d'une ligne de la file de travail délivrabilité. */
export function nextActionLabel(row: PriorityRow): string {
  const phase = row.client.currentPhase
  if (row.reason === 'blocked') return `Débloquer — ${PHASE_LABEL[phase]}`
  if (row.reason === 'missing_docs') {
    const n = Math.max(1, row.client.missingDocsCount)
    return n > 1 ? `Compléter ${n} documents` : 'Compléter 1 document'
  }
  return PHASE_GUIDE[phase].action
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/phase-guide.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/phase-guide.ts src/lib/phase-guide.test.ts
git commit -m "feat(delivrabilite): guide statique des phases + libellé « prochaine action »

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Icône `help` + composant `PhaseHelp` + intégration WorkflowBoard

**Files:**
- Modify: `src/components/Icon.tsx` (union `IconName` ~ligne 8-49 + objet `PATHS`)
- Create: `src/components/suivi/PhaseHelp.tsx`
- Test: `src/components/suivi/PhaseHelp.test.tsx`
- Modify: `src/components/suivi/WorkflowBoard.tsx`
- Modify: `src/index.css` (ajout en fin de fichier)

**Interfaces:**
- Consumes: `PHASE_GUIDE` (Task 1), `PHASE_LABEL` (`suivi-board.ts`), `Icon`.
- Produces: `<PhaseHelp phase={WorkflowPhase} />` — bouton « ? » ouvrant un popover. Task 5 l'utilise dans le tunnel Overview.

- [ ] **Step 1: Ajouter l'icône `help` à `Icon.tsx`**

Dans l'union `IconName`, ajouter `| 'help'` après `| 'download'`. Dans `PATHS`, ajouter l'entrée (chemins lucide `help-circle`) :

```tsx
  help: (<><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>),
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `src/components/suivi/PhaseHelp.test.tsx` :

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PhaseHelp } from './PhaseHelp'

describe('PhaseHelp', () => {
  it('ouvre le popover au clic avec le contenu du guide', () => {
    render(<PhaseHelp phase="racco" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Raccordement/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Enedis/)).toBeInTheDocument()
    expect(screen.getByText(/CRAE/)).toBeInTheDocument()
  })

  it('affiche la phase suivante quand elle existe', () => {
    render(<PhaseHelp phase="consuel" />)
    fireEvent.click(screen.getByRole('button', { name: /Consuel/ }))
    expect(screen.getByText('Mise en service')).toBeInTheDocument()
  })

  it('se referme au second clic', () => {
    render(<PhaseHelp phase="vt" />)
    const btn = screen.getByRole('button', { name: /Visite technique/ })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
```

- [ ] **Step 3: Vérifier que le test échoue**

Run: `npx vitest run src/components/suivi/PhaseHelp.test.tsx`
Expected: FAIL — module `./PhaseHelp` introuvable.

- [ ] **Step 4: Implémenter `src/components/suivi/PhaseHelp.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { PHASE_GUIDE } from '../../lib/phase-guide'
import { PHASE_LABEL } from '../../lib/suivi-board'
import type { WorkflowPhase } from '../../lib/types'

/**
 * Icône « ? » + popover expliquant une phase du workflow délivrabilité
 * (objectif, documents attendus, condition de clôture, phase suivante).
 * Utilisée sur le tunnel de l'Overview délivrabilité et les sections du
 * WorkflowBoard — pour qu'un nouveau n'ait jamais à demander « c'est quoi RACCO ? ».
 */
export function PhaseHelp({ phase }: { phase: WorkflowPhase }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const guide = PHASE_GUIDE[phase]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <span className="phase-help" ref={ref}>
      <button
        type="button"
        aria-label={`Aide — ${PHASE_LABEL[phase]}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        <Icon name="help" size={13} />
      </button>
      {open && (
        <div className="phase-help-pop" role="dialog" aria-label={PHASE_LABEL[phase]}>
          <strong>{PHASE_LABEL[phase]}</strong>
          <p>{guide.objectif}</p>
          {guide.docs.length > 0 && <p><b>Documents :</b> {guide.docs.join(', ')}</p>}
          <p><b>Se clôture quand :</b> {guide.cloture}</p>
          {guide.suivante && <p><b>Phase suivante :</b> {PHASE_LABEL[guide.suivante]}</p>}
        </div>
      )}
    </span>
  )
}
```

- [ ] **Step 5: Ajouter le CSS en fin de `src/index.css`**

```css
/* ── PhaseHelp : popover d'aide des phases délivrabilité ─────────────────── */
.phase-help { position: relative; display: inline-flex; }
.phase-help > button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 999px; padding: 0;
  color: rgba(42, 37, 32, 0.42); background: none; border: none; cursor: pointer;
}
.phase-help > button:hover { color: var(--color-text); }
.phase-help-pop {
  position: absolute; z-index: 40; top: calc(100% + 6px); left: 50%; transform: translateX(-50%);
  width: 260px; padding: 12px 14px; border-radius: 12px; text-align: left;
  background: var(--color-surface, #fff); border: 1px solid var(--color-line, #e7e2db);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.14); font-size: 12px; line-height: 1.45;
}
.phase-help-pop strong { display: block; margin-bottom: 4px; font-size: 12px; }
.phase-help-pop p { margin: 4px 0 0; color: rgba(42, 37, 32, 0.62); }
.phase-help-pop b { color: var(--color-text); font-weight: 650; }
[data-theme="dark"] .phase-help > button { color: rgba(255, 255, 255, 0.45); }
[data-theme="dark"] .phase-help-pop p { color: rgba(255, 255, 255, 0.6); }
```

Note : vérifier que `--color-surface` / `--color-line` existent dans `:root` de `index.css` ; sinon garder les fallbacks tels quels (déjà présents ci-dessus).

- [ ] **Step 6: Vérifier que les tests passent**

Run: `npx vitest run src/components/suivi/PhaseHelp.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Intégrer PhaseHelp dans `WorkflowBoard.tsx`**

a) Ajouter les imports :

```tsx
import { PhaseHelp } from './PhaseHelp'
```

b) `CollapsibleWfSection` : ajouter une prop `helpPhases` et rendre les « ? » entre le bouton toggle et la progression (PAS à l'intérieur du bouton — pas de bouton dans un bouton) :

```tsx
function CollapsibleWfSection({
  section, sectionList, helpPhases, children,
}: { section: typeof SUIVI_SECTIONS[number]; sectionList: SubstepResponse[]; helpPhases: WorkflowPhase[]; children: ReactNode }) {
  const [collapsed, toggle] = useCollapsibleState(`wf.section.${section.key}`, allDone(sectionList))
  return (
    <section className={`wf-section wf-section-${section.key}`}>
      <header className="wf-section-head">
        <button type="button" className="wf-section-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={15} className="wf-section-chev" />
          <span className="wf-section-badge" aria-hidden><Icon name={SECTION_ICON[section.key]} size={15} /></span>
          <span className="wf-section-titles">
            <span className="wf-section-eyebrow">{section.eyebrow}</span>
            <span className="wf-section-title-text">{section.title}</span>
          </span>
        </button>
        {helpPhases.map((p) => <PhaseHelp key={p} phase={p} />)}
        <Progress list={sectionList} />
      </header>
      {!collapsed && children}
    </section>
  )
}
```

c) À l'appel dans `WorkflowBoard` : sections `single` → leurs phases ; section `parallel` (back-office) → pas de help au niveau section, mais un help par colonne :

```tsx
<CollapsibleWfSection key={section.key} section={section} sectionList={sectionList}
  helpPhases={section.layout === 'single' ? (section.phases ?? []) : []}>
```

et dans le rendu des colonnes parallèles, dans `.wf-col-head` après le titre :

```tsx
<div className="wf-col-head">
  <span className="wf-col-title">{col.title}</span>
  <PhaseHelp phase={col.phases[0]} />
  <Progress list={colList} />
</div>
```

- [ ] **Step 8: Valider TypeScript + suite de tests**

Run: `npx tsc -b && npx vitest run src/components/suivi`
Expected: tsc sans erreur ; tests suivi PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/Icon.tsx src/components/suivi/PhaseHelp.tsx src/components/suivi/PhaseHelp.test.tsx src/components/suivi/WorkflowBoard.tsx src/index.css
git commit -m "feat(delivrabilite): popover « ? » d'aide par phase (tunnel + workflow)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Sélecteurs de l'accueil commercial (`commercialHome.ts`)

**Files:**
- Create: `src/lib/commercialHome.ts`
- Test: `src/lib/commercialHome.test.ts`

**Interfaces:**
- Consumes: `LeadResponse`, `RdvResponse` (`src/lib/types.ts`).
- Produces: `selectUpcomingRdvs(rdvs: RdvResponse[], nowIso: string, limit?: number): RdvResponse[]` et `selectMyActiveLeads(leads: LeadResponse[], meId: string, limit?: number): LeadResponse[]`. Task 4 en dépend.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/lib/commercialHome.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { selectUpcomingRdvs, selectMyActiveLeads } from './commercialHome'
import type { LeadResponse, RdvResponse } from './types'

function makeRdv(over: Partial<RdvResponse>): RdvResponse {
  return {
    id: 'r1', externalId: null, leadId: 'l1', commercialId: 'me',
    scheduledAt: '2026-07-10T10:00:00.000Z', locationType: 'domicile' as RdvResponse['locationType'],
    status: 'planifie', result: null, signatureAt: null, montantTotal: null,
    financingType: null, objections: null, nonSaleReason: null, kits: null, notes: null,
    debriefFilledAt: null, debriefDueAt: null, hasDevisEnAttente: false,
    createdAt: '', updatedAt: '', lead: null,
    ...over,
  }
}

function makeLead(over: Partial<LeadResponse>): LeadResponse {
  return {
    id: 'l1', externalId: null, source: 'meta' as LeadResponse['source'], status: 'rdv_pris',
    firstName: 'Jean', lastName: 'Test', email: null, phone: null, addressLine: null,
    city: null, postalCode: null, localisationMap: null, revenuFiscal: null, typeLogement: null,
    utmSource: null, utmMedium: null, utmCampaign: null, campaign: null, adset: null, ad: null,
    canalAcquisition: null, setterId: null, assignedToId: 'me', referrerId: null,
    lastContactAt: null, latestCallAt: null, firstCallAt: null, latestCallComment: null,
    latestCallSetterId: null, assignedSetterIds: [], latestRdvAt: null, latestRdvStatus: null,
    latestRdvCommercialId: null, jauge11Jours: null,
    ...over,
  } as LeadResponse
}

const NOW = '2026-07-04T12:00:00.000Z'

describe('selectUpcomingRdvs', () => {
  it('garde les RDV planifiés à venir, triés du plus proche au plus lointain', () => {
    const rdvs = [
      makeRdv({ id: 'past', scheduledAt: '2026-07-01T10:00:00.000Z' }),
      makeRdv({ id: 'far', scheduledAt: '2026-07-20T10:00:00.000Z' }),
      makeRdv({ id: 'near', scheduledAt: '2026-07-05T09:00:00.000Z' }),
      makeRdv({ id: 'honored', scheduledAt: '2026-07-06T09:00:00.000Z', status: 'honore' }),
    ]
    expect(selectUpcomingRdvs(rdvs, NOW).map((r) => r.id)).toEqual(['near', 'far'])
  })

  it('respecte la limite', () => {
    const rdvs = ['a', 'b', 'c'].map((id, i) =>
      makeRdv({ id, scheduledAt: `2026-07-1${i}T10:00:00.000Z` }))
    expect(selectUpcomingRdvs(rdvs, NOW, 2)).toHaveLength(2)
  })
})

describe('selectMyActiveLeads', () => {
  it('filtre sur mes leads actifs et trie par dernier RDV décroissant', () => {
    const leads = [
      makeLead({ id: 'mine-old', latestRdvAt: '2026-06-01T10:00:00.000Z' }),
      makeLead({ id: 'mine-new', latestRdvAt: '2026-07-01T10:00:00.000Z', status: 'rdv_honore' }),
      makeLead({ id: 'not-mine', assignedToId: 'other' }),
      makeLead({ id: 'lost', status: 'perdu' }),
      makeLead({ id: 'signed', status: 'signe' }),
    ]
    expect(selectMyActiveLeads(leads, 'me').map((l) => l.id)).toEqual(['mine-new', 'mine-old'])
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run src/lib/commercialHome.test.ts`
Expected: FAIL — module `./commercialHome` introuvable.

- [ ] **Step 3: Implémenter `src/lib/commercialHome.ts`**

```ts
import type { LeadResponse, LeadStatus, RdvResponse } from './types'

/**
 * Sélecteurs purs de l'accueil commercial (« Mon espace »).
 * Les listes brutes viennent des hooks (`useRdvList` déjà auto-scopé commercial
 * côté backend, `useLeads`) ; ici uniquement du filtrage/tri testable.
 */

/** RDV à venir : planifiés, du plus proche au plus lointain (comparaison ISO). */
export function selectUpcomingRdvs(rdvs: RdvResponse[], nowIso: string, limit = 6): RdvResponse[] {
  return rdvs
    .filter((r) => r.status === 'planifie' && r.scheduledAt >= nowIso)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, limit)
}

/** Statuts « en cours » côté closing : le pipeline actif du commercial. */
const ACTIVE_STATUSES = new Set<LeadStatus>(['rdv_pris', 'rdv_honore', 'signature_en_cours'])

/** Mes leads encore actifs, du dernier RDV le plus récent au plus ancien. */
export function selectMyActiveLeads(leads: LeadResponse[], meId: string, limit = 8): LeadResponse[] {
  return leads
    .filter((l) => l.assignedToId === meId && ACTIVE_STATUSES.has(l.status))
    .sort((a, b) => (b.latestRdvAt ?? '').localeCompare(a.latestRdvAt ?? ''))
    .slice(0, limit)
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/commercialHome.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commercialHome.ts src/lib/commercialHome.test.ts
git commit -m "feat(commercial): sélecteurs purs de l'accueil (RDV à venir, leads actifs)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Accueil commercial enrichi (« Mon espace » 4 blocs)

**Files:**
- Modify: `src/lib/types.ts` (helper `initialsOfName` après `initials`, ligne ~596)
- Create: `src/components/overview/CommercialUpcomingRdv.tsx`
- Create: `src/components/overview/CommercialMyLeads.tsx`
- Modify: `src/pages/Overview.tsx` (fonction `OverviewCommercialSolo`, ~lignes 545-603, et `CommercialDebriefsToFill` ligne ~498)
- Modify: `src/index.css` (fin de fichier)

**Interfaces:**
- Consumes: `selectUpcomingRdvs` / `selectMyActiveLeads` (Task 3), `useCommercialAnalytics(id, { from, to })` (`src/lib/hooks.ts:1052`, retourne `Async<AnalyticsCommercialSummary>` avec `{ total, honored, signed, ca, panier, closing }`, `closing` en % entier 0-100), `MagicKpi`, `leadDetailPath(role, id)`, `STATUS_LABEL` / `fullName` (`types.ts`).
- Produces: rien de consommé par les autres tâches.

- [ ] **Step 0: Helper partagé `initialsOfName` dans `src/lib/types.ts`**

Juste après la fonction `initials` existante (`src/lib/types.ts:596`), ajouter (utilisé par les 3 nouveaux composants des Tasks 4 et 5 — ne PAS le dupliquer localement) :

```ts
/** Initiales depuis un nom complet affichable (fallback « — »). */
export function initialsOfName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
}
```

- [ ] **Step 1: Créer `src/components/overview/CommercialUpcomingRdv.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'
import { useAuth } from '../../lib/auth'
import { leadDetailPath } from '../../lib/leadPaths'
import { fullName, initialsOfName, type RdvResponse } from '../../lib/types'

function rdvDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
    + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Bloc « Mes prochains RDV » de l'accueil commercial — liste chronologique,
 * clic → fiche client. Remplace l'accès au calendrier global (resté bloqué). */
export function CommercialUpcomingRdv({ rdvs }: { rdvs: RdvResponse[] }) {
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  return (
    <div className="overview-air-card overview-role-wide">
      <div className="shot-card-head">
        <div>
          <h3>Mes prochains RDV</h3>
          <p>Vos rendez-vous planifiés · cliquez pour ouvrir la fiche client</p>
        </div>
        <span><Icon name="calendar" size={16} /></span>
      </div>
      <div className="commercial-qualified-list-body">
        {rdvs.length === 0 ? (
          <div className="text-xs text-faint">
            Aucun RDV planifié à venir. Les RDV pris par les setters apparaissent ici automatiquement.
          </div>
        ) : rdvs.map((rdv) => {
          const name = rdv.lead ? fullName(rdv.lead) : 'Prospect'
          return (
            <button
              type="button"
              key={rdv.id}
              className="commercial-qualified-row"
              style={{ background: 'none', border: 'none', font: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onClick={() => rdv.leadId && navigate(leadDetailPath(role, rdv.leadId))}
              disabled={!rdv.leadId}
            >
              <div className="overview-role-avatar">{initialsOfName(name)}</div>
              <div>
                <strong>{name}</strong>
                <small>{rdv.lead?.city ?? 'Ville non renseignée'} · {rdv.lead?.phone ?? 'sans téléphone'}</small>
              </div>
              <div className="commercial-qualified-meta">
                <span>Planifié</span>
                <small>{rdvDateTime(rdv.scheduledAt)}</small>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Créer `src/components/overview/CommercialMyLeads.tsx`**

```tsx
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'
import { useAuth } from '../../lib/auth'
import { leadDetailPath, leadListPath } from '../../lib/leadPaths'
import { STATUS_LABEL, fullName, initialsOfName, type LeadResponse } from '../../lib/types'

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

/** Bloc « Mes leads en cours » de l'accueil commercial : pipeline closing
 * (RDV pris / honoré / signature en cours), clic → fiche client. */
export function CommercialMyLeads({ leads }: { leads: LeadResponse[] }) {
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  return (
    <div className="overview-air-card overview-commercial-myleads">
      <div className="shot-card-head">
        <div>
          <h3>Mes leads en cours</h3>
          <p>Vos prospects en pipeline · dernier RDV en premier</p>
        </div>
        <button
          type="button"
          className="overview-commercial-myleads-all"
          onClick={() => navigate(leadListPath(role))}
        >
          Tout voir <Icon name="arrow-right" size={12} />
        </button>
      </div>
      <div className="commercial-qualified-list-body">
        {leads.length === 0 ? (
          <div className="text-xs text-faint">
            Aucun lead en cours. Dès qu'un lead vous est assigné avec un RDV, il apparaît ici.
          </div>
        ) : leads.map((lead) => {
          const name = fullName(lead)
          return (
            <button
              type="button"
              key={lead.id}
              className="commercial-qualified-row"
              style={{ background: 'none', border: 'none', font: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onClick={() => navigate(leadDetailPath(role, lead.id))}
            >
              <div className="overview-role-avatar">{initialsOfName(name)}</div>
              <div>
                <strong>{name}</strong>
                <small>{lead.city ?? 'Ville non renseignée'} · {lead.phone ?? 'sans téléphone'}</small>
              </div>
              <div className="commercial-qualified-meta">
                <span>{STATUS_LABEL[lead.status]}</span>
                <small>RDV : {shortDate(lead.latestRdvAt)}</small>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Réécrire `OverviewCommercialSolo` dans `src/pages/Overview.tsx`**

a) Ajouter aux imports existants du fichier :

```tsx
import { selectMyActiveLeads, selectUpcomingRdvs } from '../lib/commercialHome'
import { CommercialUpcomingRdv } from '../components/overview/CommercialUpcomingRdv'
import { CommercialMyLeads } from '../components/overview/CommercialMyLeads'
```

et `useCommercialAnalytics` à la liste importée depuis `../lib/hooks` (ligne 10).

b) Remplacer intégralement la fonction `OverviewCommercialSolo` (lignes ~545-603) — le commentaire au-dessus (« Volontairement minimale… ») est remplacé aussi :

```tsx
// ----- F3 solo : commercial individuel — poste de pilotage quotidien -----
// Tout ce dont le commercial a besoin dès la connexion : ses stats sur la
// période, ses prochains RDV (le calendrier global reste réservé aux
// responsables), ses débriefs à remplir et ses leads en pipeline.
function OverviewCommercialSolo() {
  const me = useAuth((s) => s.user)
  const display = useDisplayUser()
  const [period, setPeriod] = useState<FunnelPeriodState>({ ...DEFAULT_FUNNEL_PERIOD, mode: 'this_month' })
  const range = buildFunnelPeriodRange(period)

  // Liste RDV non bornée par la période : on ne masque jamais un débrief en retard
  // ni un RDV à venir. Les KPIs période viennent de /analytics/commercials/:id.
  const { data: rdvs = [] } = useRdvList({ commercialId: me?.id, limit: 200 })
  const { data: allLeads = [] } = useLeads({ limit: 500 })
  const { data: stats } = useCommercialAnalytics(me?.id, { from: range.from, to: range.to })

  const nowIso = useMemo(() => new Date().toISOString(), [])

  const { planifie, debriefs, upcoming, myLeads } = useMemo(() => {
    const list = rdvs ?? []
    const leadById = new Map((allLeads ?? []).map((l) => [l.id, l]))

    const inPeriod = list.filter((r) => r.scheduledAt >= range.from && r.scheduledAt <= range.to)
    const planifie = inPeriod.filter((r) => r.status === 'planifie').length

    // Débriefs à remplir triés par date de RDV, du plus récent au plus ancien.
    const debriefs = list
      .filter(needsDebrief)
      .sort((a, b) => (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? ''))
      .map((r) => ({ rdv: r, lead: r.lead ?? leadById.get(r.leadId) }))

    const upcoming = selectUpcomingRdvs(list, nowIso)
    const myLeads = selectMyActiveLeads(allLeads ?? [], me?.id ?? '')

    return { planifie, debriefs, upcoming, myLeads }
  }, [rdvs, allLeads, range.from, range.to, nowIso, me?.id])

  return (
    <AppShell blobsKey="commercial" flat>
      <Topbar
        eyebrow="COMMERCIAL"
        title={`Bonjour, ${display.firstName}`}
      />
      <main className="overview-shot-page overview-commercial-page flex-grow overflow-auto">
        <div className="overview-air-header">
          <div>
            <span className="shot-eyebrow">VELORA · commercial</span>
            <h1>Mon espace</h1>
            <p className="text-sm text-muted mt-2">Vos stats, vos RDV, vos débriefs et vos leads — tout part d'ici.</p>
          </div>
          <div className="overview-commercial-toolbar">
            <DateRangePicker value={period} onChange={setPeriod} align="right" />
          </div>
        </div>

        <section className="overview-commercial-hero-stats">
          <MagicKpi size="sm" accent="info" icon="calendar" label="RDV honorés" value={fmtCompact(stats?.honored ?? 0)} sub={`${fmtCompact(planifie)} planifiés`} />
          <MagicKpi size="sm" accent="info" icon="clock" label="RDV planifiés" value={fmtCompact(planifie)} sub="à venir sur la période" />
          <MagicKpi size="sm" accent="success" icon="check" label="Ventes signées" value={fmtCompact(stats?.signed ?? 0)} sub="sur la période" />
          <MagicKpi size="sm" accent="success" icon="target" label="Taux de closing" value={`${stats?.closing ?? 0}%`} sub="signées / honorés" />
          <MagicKpi size="sm" accent="gold" icon="tag" label="CA signé" value={fmtKEur(stats?.ca ?? 0)} sub="sur la période" />
        </section>

        <section className="overview-air-grid overview-commercial-grid overview-commercial-solo-grid">
          <CommercialDebriefsToFill debriefs={debriefs} />
          <CommercialUpcomingRdv rdvs={upcoming} />
          <CommercialMyLeads leads={myLeads} />
        </section>
      </main>
    </AppShell>
  )
}
```

Note : les valeurs `accent` de `MagicKpi` sont `'green' | 'gold' | 'rust' | 'success' | 'info'` (`src/components/kpi/MagicKpi.tsx:11`) — celles utilisées ci-dessus (`info`, `success`, `gold`) sont valides.

c) Dans `CommercialDebriefsToFill` (ligne ~498), remplacer l'état vide :

```tsx
<div className="text-xs text-faint">Rien à remplir — vos débriefs sont à jour. Chaque RDV honoré demande un débrief : il apparaîtra ici.</div>
```

- [ ] **Step 4: CSS — placement du bloc « Mes leads » (fin de `src/index.css`)**

```css
/* Accueil commercial solo : « Mes leads en cours » occupe toute la largeur
   sous Débriefs (7) + Prochains RDV (5). */
.overview-commercial-solo-grid .overview-commercial-myleads { grid-column: 1 / -1; }
.overview-commercial-myleads-all {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 650; color: rgba(42, 37, 32, 0.55);
  background: none; border: none; cursor: pointer; padding: 4px 6px; border-radius: 8px;
}
.overview-commercial-myleads-all:hover { color: var(--color-text); }
```

- [ ] **Step 5: Valider TypeScript + tests existants**

Run: `npx tsc -b && npx vitest run`
Expected: tsc sans erreur, suite complète PASS (les tests WIP tiers `NewClientModal.test.tsx` peuvent échouer — les ignorer s'ils échouaient déjà avant la modification ; vérifier avec `git stash list`/l'état initial si doute).

- [ ] **Step 6: Vérification visuelle (impersonation)**

Lancer `npm run dev`, se connecter en admin et utiliser « Voir en tant que » (ViewAsBanner / `lib/auth.ts`) avec un compte commercial : vérifier les 5 KPIs, les 3 cartes, les états vides (choisir un commercial sans données si possible).

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/pages/Overview.tsx src/components/overview/CommercialUpcomingRdv.tsx src/components/overview/CommercialMyLeads.tsx src/index.css
git commit -m "feat(commercial): accueil poste de pilotage — stats, prochains RDV, leads en cours

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: File de travail délivrabilité + réorganisation de l'overview

**Files:**
- Create: `src/components/overview/DeliveryWorkQueue.tsx`
- Test: `src/components/overview/DeliveryWorkQueue.test.tsx`
- Modify: `src/pages/Overview.tsx` (fonction `OverviewSuivi`, lignes ~77-210)
- Modify: `src/index.css` (fin de fichier)

**Interfaces:**
- Consumes: `selectDeliveryPriorities` / `PriorityRow` / `PriorityReason` (`deliveryOverview.ts`), `nextActionLabel` (Task 1), `PhaseHelp` (Task 2), `PHASE_LABEL` (`suivi-board.ts`).
- Produces: `<DeliveryWorkQueue rows={PriorityRow[]} now={Date} onOpen={(leadId: string) => void} />`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/components/overview/DeliveryWorkQueue.test.tsx` :

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeliveryWorkQueue } from './DeliveryWorkQueue'
import type { ClientResponse } from '../../lib/types'
import type { PriorityRow } from '../../lib/deliveryOverview'

function makeClient(over: Partial<ClientResponse> = {}): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', projectId: null, rdvId: null,
    lead: { fullName: 'Jean Test', city: 'Pau', phone: null },
    technicienVtId: null, techniciens: [], poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'actif', currentPhase: 'vt', blocked: false, missingDocsCount: 0,
    signedAt: null, steps: {},
    ...over,
  }
}

const NOW = new Date('2026-07-04T12:00:00Z')
const ROWS: PriorityRow[] = [
  { client: makeClient({ id: 'b1', leadId: 'lb1', lead: { fullName: 'Bloqué Un', city: null, phone: null }, currentPhase: 'racco', blocked: true }), reason: 'blocked', lateSince: null },
  { client: makeClient({ id: 'd1', leadId: 'ld1', lead: { fullName: 'Doc Un', city: null, phone: null }, missingDocsCount: 2 }), reason: 'missing_docs', lateSince: null },
]

describe('DeliveryWorkQueue', () => {
  it('affiche toutes les lignes avec leur prochaine action', () => {
    render(<DeliveryWorkQueue rows={ROWS} now={NOW} onOpen={() => {}} />)
    expect(screen.getByText('Bloqué Un')).toBeInTheDocument()
    expect(screen.getByText('Débloquer — Raccordement')).toBeInTheDocument()
    expect(screen.getByText('Compléter 2 documents')).toBeInTheDocument()
  })

  it('filtre par nature au clic sur un onglet', () => {
    render(<DeliveryWorkQueue rows={ROWS} now={NOW} onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Bloqués/ }))
    expect(screen.getByText('Bloqué Un')).toBeInTheDocument()
    expect(screen.queryByText('Doc Un')).toBeNull()
  })

  it('ouvre la fiche au clic sur « Suivi »', () => {
    let opened: string | null = null
    render(<DeliveryWorkQueue rows={ROWS} now={NOW} onOpen={(id) => { opened = id }} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Suivi' })[0])
    expect(opened).toBe('lb1')
  })

  it('état vide explicite', () => {
    render(<DeliveryWorkQueue rows={[]} now={NOW} onOpen={() => {}} />)
    expect(screen.getByText(/tout est à jour/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `npx vitest run src/components/overview/DeliveryWorkQueue.test.tsx`
Expected: FAIL — module `./DeliveryWorkQueue` introuvable.

- [ ] **Step 3: Implémenter `src/components/overview/DeliveryWorkQueue.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Icon } from '../Icon'
import { PHASE_LABEL } from '../../lib/suivi-board'
import { nextActionLabel } from '../../lib/phase-guide'
import { initialsOfName } from '../../lib/types'
import type { PriorityReason, PriorityRow } from '../../lib/deliveryOverview'

type Filter = 'all' | PriorityReason

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'blocked', label: 'Bloqués' },
  { id: 'late', label: 'Retards' },
  { id: 'missing_docs', label: 'Docs manquants' },
]

/**
 * File de travail de l'accueil délivrabilité : TOUS les dossiers qui attendent
 * une action (bloqués → retards SLA → docs manquants, tri de
 * selectDeliveryPriorities), avec la prochaine action en toutes lettres.
 * Réponse directe à « qu'est-ce que je traite aujourd'hui ? ».
 */
export function DeliveryWorkQueue({ rows, now, onOpen }: {
  rows: PriorityRow[]
  now: Date
  onOpen: (leadId: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const counts = useMemo(() => {
    const c: Record<PriorityReason, number> = { blocked: 0, late: 0, missing_docs: 0 }
    for (const r of rows) c[r.reason] += 1
    return c
  }, [rows])
  const visible = filter === 'all' ? rows : rows.filter((r) => r.reason === filter)

  const badgeFor = (row: PriorityRow): { text: string; cls: string } => {
    if (row.reason === 'blocked') return { text: 'Bloqué', cls: 'bg-danger/10 text-danger' }
    if (row.reason === 'late') {
      const days = row.lateSince != null ? Math.max(0, Math.round((now.getTime() - row.lateSince) / 86_400_000)) : 0
      return { text: `Retard J+${days}`, cls: 'bg-danger/10 text-danger' }
    }
    return { text: 'Doc manquant', cls: 'bg-warning/10 text-warning' }
  }

  return (
    <div className="overview-air-card delivery-work-queue">
      <div className="shot-card-head">
        <div>
          <h3>À traiter en priorité</h3>
          <p>Tous les dossiers qui attendent une action — commencez en haut de la liste.</p>
        </div>
        <span><Icon name="bell" size={16} /></span>
      </div>
      <div className="delivery-work-queue-filters" role="tablist" aria-label="Filtrer par nature">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'active' : ''}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({f.id === 'all' ? rows.length : counts[f.id]})
          </button>
        ))}
      </div>
      <div className="overview-role-list delivery-work-queue-list">
        {visible.map((row) => {
          const badge = badgeFor(row)
          return (
            <div key={row.client.id} className="overview-role-row">
              <div className="overview-role-avatar">{initialsOfName(row.client.lead.fullName)}</div>
              <div>
                <strong>{row.client.lead.fullName || row.client.lead.phone || '—'}</strong>
                <small>{row.client.lead.city ?? '—'} · {PHASE_LABEL[row.client.currentPhase]} · <b className="delivery-next-action">{nextActionLabel(row)}</b></small>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${badge.cls}`}>{badge.text}</span>
                <button type="button" onClick={() => onOpen(row.client.leadId)}>Suivi</button>
              </div>
            </div>
          )
        })}
        {visible.length === 0 && (
          <div className="text-xs text-faint">
            Rien à traiter dans cette catégorie — tout est à jour. Les dossiers bloqués, en retard ou avec documents manquants apparaissent ici.
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/components/overview/DeliveryWorkQueue.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Réorganiser `OverviewSuivi` dans `src/pages/Overview.tsx`**

a) Imports à ajouter :

```tsx
import { DeliveryWorkQueue } from '../components/overview/DeliveryWorkQueue'
import { PhaseHelp } from '../components/suivi/PhaseHelp'
```

b) Ligne ~95 — la file n'est plus tronquée à 6 :

```tsx
const priorities = useMemo(() => selectDeliveryPriorities(clients, now), [clients, now])
```

c) Supprimer la fonction locale `badgeFor` (lignes ~112-119) — elle vit désormais dans `DeliveryWorkQueue`.

d) Remplacer le JSX du `<main>` (après `overview-air-header`, lignes ~134-206) par ce nouvel ordre — file de travail, tunnel (avec PhaseHelp), KPIs, livraisons :

```tsx
        {/* Zone 1 — File de travail : quoi traiter aujourd'hui */}
        <section className="overview-delivery-queue-wrap">
          <DeliveryWorkQueue rows={priorities} now={now} onOpen={(leadId) => navigate(`/suivi/${leadId}/fiche`)} />
        </section>

        {/* Zone 2 — Tunnel des 6 phases (cliquable, aide « ? » par phase) */}
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
                <span className="overview-delivery-phase-help"><PhaseHelp phase={phase} /></span>
                {i < DELIVERY_PHASES.length - 1 && <span className="overview-delivery-arrow" aria-hidden>›</span>}
              </div>
            )
          })}
        </section>

        {/* Zone 3 — KPIs de santé */}
        <section className="overview-air-grid overview-delivery-kpis">
          <AirKpi icon="grid" label="Dossiers actifs" value={fmtCompact(pipeline.activeCount)} sub="en livraison" />
          <AirKpi icon="shield" label="Retards SLA" value={fmtCompact(pipeline.lateCount)} sub="à débloquer" />
          <AirKpi icon="inbox" label="Docs manquants" value={fmtCompact(pipeline.missingDocsCount)} sub="à compléter" />
          <AirKpi icon="check" label="À livrer (phase finale)" value={fmtCompact(pipeline.toDeliverCount)} sub="installation / MES" />
          <AirKpi icon="tag" label="CA en livraison" value={fmtKEur(caEnLivraison)} sub="base RDV signés" />
        </section>

        {/* Zone 4 — Dernières livraisons */}
        <div className="overview-delivery-lists">
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
```

(La carte « À traiter en priorité » d'origine dans `.overview-delivery-lists` est supprimée — remplacée par la Zone 1.)

- [ ] **Step 6: CSS (fin de `src/index.css`)**

```css
/* ── Overview délivrabilité : file de travail + aide phases ──────────────── */
.overview-delivery-queue-wrap { margin-bottom: 14px; }
.delivery-work-queue-filters { display: flex; gap: 6px; flex-wrap: wrap; margin: 2px 0 10px; }
.delivery-work-queue-filters button {
  font-size: 11px; font-weight: 650; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--color-line, #e7e2db); background: none; cursor: pointer;
  color: rgba(42, 37, 32, 0.6);
}
.delivery-work-queue-filters button.active {
  background: var(--color-text); color: #fff; border-color: var(--color-text);
}
.delivery-work-queue-list { max-height: 420px; overflow-y: auto; }
.delivery-next-action { font-weight: 650; color: var(--color-text); }
.overview-delivery-funnel-step { position: relative; }
.overview-delivery-phase-help { position: absolute; top: 4px; right: 16px; }
[data-theme="dark"] .delivery-work-queue-filters button { color: rgba(255, 255, 255, 0.55); }
```

Note : si `.overview-delivery-funnel-step` a déjà un `position` dans `index.css`, ne pas dupliquer la règle.

- [ ] **Step 7: Valider TypeScript + tests + visuel**

Run: `npx tsc -b && npx vitest run`
Expected: tsc sans erreur, tests PASS.
Puis `npm run dev`, « voir en tant que » un compte délivrabilité : file de travail en tête avec filtres et prochaines actions, « ? » sur chaque phase du tunnel, KPIs et livraisons en dessous.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Overview.tsx src/components/overview/DeliveryWorkQueue.tsx src/components/overview/DeliveryWorkQueue.test.tsx src/index.css
git commit -m "feat(delivrabilite): l'overview devient une file de travail (priorités + prochaine action)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Bannière « Lecture seule » sur /suivi pour le commercial

**Files:**
- Modify: `src/pages/Suivi.tsx` (imports, Topbar ligne ~172, header lignes ~174-190)
- Modify: `src/index.css` (fin de fichier)

**Interfaces:**
- Consumes: `useAuth` (déjà importé dans `Suivi.tsx`), `Icon`.
- Produces: rien.

- [ ] **Step 1: Modifier `src/pages/Suivi.tsx`**

a) Ajouter l'import :

```tsx
import { Icon } from '../components/Icon'
```

b) Adapter le Topbar (ligne ~172) au rôle :

```tsx
<Topbar eyebrow="SUIVI INSTALLATION" title={role === 'commercial' ? 'Mes dossiers signés' : 'Dossiers signés'} />
```

c) Juste après `</header>` (ligne ~190), insérer la bannière :

```tsx
        {role === 'commercial' && (
          <div className="suivi-readonly-banner" role="note">
            <Icon name="eye" size={14} />
            <span>
              <strong>Lecture seule</strong> — le suivi de vos dossiers signés est piloté par l'équipe
              délivrabilité. Vous consultez ici l'avancement (phases, blocages, livraison) sans pouvoir le modifier.
            </span>
          </div>
        )}
```

- [ ] **Step 2: CSS (fin de `src/index.css`)**

```css
/* Bannière lecture seule du /suivi côté commercial. */
.suivi-readonly-banner {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 0 0 14px; padding: 10px 14px; border-radius: 10px;
  font-size: 12px; line-height: 1.45;
  background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.18);
  color: var(--color-text);
}
.suivi-readonly-banner svg { flex-shrink: 0; margin-top: 2px; }
.suivi-readonly-banner strong { font-weight: 700; }
```

- [ ] **Step 3: Valider TypeScript**

Run: `npx tsc -b`
Expected: sans erreur.

- [ ] **Step 4: Vérification visuelle**

`npm run dev`, « voir en tant que » commercial → `/suivi` : titre « Mes dossiers signés » + bannière. En délivrabilité/admin : aucun changement.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Suivi.tsx src/index.css
git commit -m "feat(commercial): bannière lecture seule sur Mes dossiers (/suivi)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Validation finale

**Files:** aucun nouveau — vérification globale.

- [ ] **Step 1: Suite complète + build TypeScript**

Run: `npx vitest run && npx tsc -b`
Expected: PASS / sans erreur. (Si `NewClientModal.test.tsx` — WIP tiers non suivi — échoue, le noter mais ne pas le corriger : hors périmètre.)

- [ ] **Step 2: Non-régression des autres rôles (impersonation)**

Avec `npm run dev` + « voir en tant que » : admin (`/overview` funnel intact), setter, commercial_lead (leaderboard intact), responsable_technique. Aucune de ces vues ne doit avoir changé.

- [ ] **Step 3: Vérifier l'état git**

Run: `git status --short && git log --oneline origin/main..HEAD | head -25`
Expected: seuls `src/lib/api.ts` (M, WIP tiers) et `NewClientModal.*` (??, WIP tiers) restent non committés. NE PAS pousser — le push est décidé par l'utilisateur (PAT dans `/workspace/Desktop/SaaS ecoi/.env` si demandé).
