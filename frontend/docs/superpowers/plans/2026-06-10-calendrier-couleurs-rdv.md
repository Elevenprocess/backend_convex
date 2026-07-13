# Coloration des cartes RDV du calendrier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colorer le fond des cartes RDV ECOI du calendrier (`/rdv`) en 4 teintes légères selon l'état du RDV, uniquement pour les rôles `admin` et `commercial_lead`.

**Architecture:** Le backend enrichit chaque RDV listé d'un booléen `hasDevisEnAttente` (sous-requête `EXISTS` sur la table `devis`). Le frontend dérive une catégorie de couleur via une fonction pure testée, mappée vers des classes Tailwind de teinte (cohérentes avec `CARD_TONE`/`vtKindTone` existants), appliquée dans `RdvBlock` (semaine/jour) et `RdvButton` (mois) — gate par rôle. Une légende discrète s'affiche pour ces rôles.

**Tech Stack:** NestJS + Drizzle ORM (backend, repo `ECOI_backend`) ; React + TypeScript + Tailwind + Vitest (frontend, repo `ECOI_frontend`).

**Note repos (sous-repos git séparés) :** le frontend est versionné dans `ECOI_frontend/` et le backend dans `ECOI_backend/`. Utiliser `git -C <repo>` pour committer dans le bon repo. Committer fichier par fichier en pathspec (WIP concurrent sur `main`).

**Décision d'implémentation vs spec :** la spec évoquait des classes CSS `.rdv-card--<cat>`. On utilise plutôt des chaînes de classes Tailwind de teinte (comme `CARD_TONE` et `vtKindTone` aujourd'hui) → aucune modification de `index.css`, plus DRY et cohérent avec l'existant. Les transitions hover de `.rdv-card`/`.rdv-block` s'appliquent quelle que soit la teinte.

---

## Arbre de décision (rappel)

Pour un `RdvResponse` local + instant `nowIso` (premier cas qui matche) :

1. `hasDevisEnAttente === true` → `devis` (🟡 `bg-cuivre-tint`)
2. `debriefFilledAt != null` → `debrief` (🟢 `bg-success-tint`)
3. `status ∈ {no_show, annule, reporte}` → `autre` (⚪ `bg-info-tint`)
4. `scheduledAt >= nowIso` → `avenir` (⬜ `bg-white`)
5. sinon → `absent` (🔴 `bg-rouille-tint`)

---

## Task 1 : Backend — flag `hasDevisEnAttente` sur `RdvResponse`

**Files:**
- Modify: `ECOI_backend/src/modules/rdv/dto/rdv-response.dto.ts`
- Modify: `ECOI_backend/src/modules/rdv/rdv.service.ts` (imports + `findAll`, ~L10/L13/L221-276)

La DB de test étant indisponible, on ne fait pas de test d'intégration : validation par typecheck + revue.

- [ ] **Step 1 : Étendre le DTO**

Dans `rdv-response.dto.ts`, remplacer le type et le mapper :

```ts
export type RdvResponse = Omit<Row, 'deletedAt'> & {
  lead: RdvLeadSummary | null;
  hasDevisEnAttente: boolean;
};

export const toRdvResponse = (
  r: Row & { lead?: LeadRow | null; hasDevisEnAttente?: boolean },
): RdvResponse => {
  const { deletedAt: _omitted, lead, hasDevisEnAttente, ...rest } = r;
  void _omitted;
  return {
    ...rest,
    lead: lead
      ? {
          id: lead.id,
          firstName: lead.firstName,
          lastName: lead.lastName,
          city: lead.city,
          phone: lead.phone,
        }
      : null,
    hasDevisEnAttente: hasDevisEnAttente ?? false,
  };
};
```

(Les autres appelants — `create`/`update`/`findById` dans `rdv.controller.ts` — n'envoient pas le flag : il vaut `false`, ce qui est correct, ces vues n'utilisent pas la couleur.)

- [ ] **Step 2 : Importer `sql` et `devis` dans le service**

Dans `rdv.service.ts`, ligne 10, ajouter `sql` :

```ts
import { and, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
```

Ligne 13, ajouter `devis` :

```ts
import { devis, leads, rdv, users } from "../../db/schema";
```

(Vérifier que `devis` est bien réexporté par `../../db/schema` ; il l'est — `devis.ts` y est inclus. Sinon importer depuis `../../db/schema/devis`.)

- [ ] **Step 3 : Calculer le flag dans `findAll` (deux branches)**

Dans `findAll`, juste après la ligne `const conditions: SQL[] = [isNull(rdv.deletedAt)];` (L226), définir l'expression :

```ts
    // RDV ayant au moins un devis présenté en attente de signature → carte jaune
    // côté calendrier. Index devis_rdv_idx + devis_status_idx → sous-requête rapide.
    const hasDevisEnAttenteSql = sql<boolean>`EXISTS (
      SELECT 1 FROM ${devis}
      WHERE ${devis.rdvId} = ${rdv.id}
        AND ${devis.status} = 'en_attente'
        AND ${devis.deletedAt} IS NULL
    )`;
```

Branche `needsLeadJoin` (innerJoin, ~L254-262) — modifier le select et le map :

```ts
      const rows = await this.db
        .select({ rdv, lead: leads, hasDevisEnAttente: hasDevisEnAttenteSql })
        .from(rdv)
        .innerJoin(leads, eq(rdv.leadId, leads.id))
        .where(and(...conditions))
        .orderBy(rdv.scheduledAt)
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0);
      return rows.map((r) => ({
        ...r.rdv,
        lead: r.lead,
        hasDevisEnAttente: r.hasDevisEnAttente,
      }));
```

Branche par défaut (leftJoin, ~L267-275) — idem :

```ts
    const rows = await this.db
      .select({ rdv, lead: leads, hasDevisEnAttente: hasDevisEnAttenteSql })
      .from(rdv)
      .leftJoin(leads, eq(rdv.leadId, leads.id))
      .where(and(...conditions))
      .orderBy(rdv.scheduledAt)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0);
    return rows.map((r) => ({
      ...r.rdv,
      lead: r.lead,
      hasDevisEnAttente: r.hasDevisEnAttente,
    }));
```

- [ ] **Step 4 : Typecheck backend**

Run: `cd ECOI_backend && npx tsc --noEmit`
Expected: aucune erreur (en particulier sur `rdv.service.ts` et `rdv-response.dto.ts`).

- [ ] **Step 5 : Commit (repo backend)**

```bash
git -C ECOI_backend commit \
  src/modules/rdv/dto/rdv-response.dto.ts \
  src/modules/rdv/rdv.service.ts \
  -m "feat(rdv): expose hasDevisEnAttente sur RdvResponse (EXISTS devis en_attente)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 : Frontend — champ `hasDevisEnAttente` sur le type `RdvResponse`

**Files:**
- Modify: `ECOI_frontend/src/lib/types.ts:372-393`

- [ ] **Step 1 : Ajouter le champ**

Dans `types.ts`, ajouter la ligne avant `lead:` (L392) dans `RdvResponse` :

```ts
  debriefFilledAt: string | null
  debriefDueAt: string | null
  hasDevisEnAttente: boolean
  createdAt: string
  updatedAt: string
  lead: RdvLeadSummary | null
}
```

- [ ] **Step 2 : Typecheck (attendu : peut révéler des mocks à corriger)**

Run: `cd ECOI_frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: les tests existants `RdvCalendar.roles.test.tsx` / `RdvCalendar.vt.test.tsx` mockent `useRdvList` avec `data: []` (aucun littéral `RdvResponse` local) → pas d'erreur attendue. Si une erreur « Property 'hasDevisEnAttente' is missing » apparaît sur un littéral RDV local, ajouter `hasDevisEnAttente: false` à ce littéral.

- [ ] **Step 3 : Commit**

```bash
git -C ECOI_frontend commit src/lib/types.ts \
  -m "feat(types): RdvResponse.hasDevisEnAttente

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 : Frontend — fonction pure `rdvCardCategory` (TDD)

**Files:**
- Create: `ECOI_frontend/src/pages/rdv/rdvCardCategory.ts`
- Test: `ECOI_frontend/src/pages/rdv/rdvCardCategory.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `rdvCardCategory.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import type { RdvResponse } from '../../lib/types'
import { rdvCardCategory } from './rdvCardCategory'

const NOW = '2026-06-10T08:00:00.000Z'

function rdv(over: Partial<RdvResponse>): RdvResponse {
  return {
    id: 'r', externalId: null, leadId: 'l', commercialId: 'c',
    scheduledAt: '2026-06-09T08:00:00.000Z', locationType: 'domicile',
    status: 'honore', result: null, signatureAt: null, montantTotal: null,
    financingType: null, objections: null, nonSaleReason: null, kits: null,
    notes: null, debriefFilledAt: null, debriefDueAt: null,
    hasDevisEnAttente: false, createdAt: NOW, updatedAt: NOW, lead: null,
    ...over,
  }
}

describe('rdvCardCategory', () => {
  it('devis en attente prioritaire sur débrief fait', () => {
    expect(rdvCardCategory(rdv({ hasDevisEnAttente: true, debriefFilledAt: NOW }), NOW)).toBe('devis')
  })

  it('débrief fait → debrief', () => {
    expect(rdvCardCategory(rdv({ debriefFilledAt: NOW }), NOW)).toBe('debrief')
  })

  it('no_show / annule / reporte → autre (gris)', () => {
    expect(rdvCardCategory(rdv({ status: 'no_show' }), NOW)).toBe('autre')
    expect(rdvCardCategory(rdv({ status: 'annule' }), NOW)).toBe('autre')
    expect(rdvCardCategory(rdv({ status: 'reporte' }), NOW)).toBe('autre')
  })

  it('planifié à venir → avenir (blanc)', () => {
    expect(rdvCardCategory(rdv({ status: 'planifie', scheduledAt: '2026-06-11T08:00:00.000Z' }), NOW)).toBe('avenir')
  })

  it('frontière scheduledAt === now → avenir', () => {
    expect(rdvCardCategory(rdv({ status: 'planifie', scheduledAt: NOW }), NOW)).toBe('avenir')
  })

  it('passé sans débrief ni devis → absent (rouge)', () => {
    expect(rdvCardCategory(rdv({ status: 'honore', scheduledAt: '2026-06-09T08:00:00.000Z' }), NOW)).toBe('absent')
  })
})
```

- [ ] **Step 2 : Lancer le test → échec**

Run: `cd ECOI_frontend && npx vitest run src/pages/rdv/rdvCardCategory.test.ts`
Expected: FAIL — `Failed to resolve import "./rdvCardCategory"` (le module n'existe pas).

- [ ] **Step 3 : Implémenter la fonction pure**

Créer `rdvCardCategory.ts` :

```ts
import type { RdvResponse } from '../../lib/types'

// Catégorie de couleur d'une carte RDV dans le calendrier. Voir le design :
// docs/superpowers/specs/2026-06-10-calendrier-couleurs-rdv-design.md
export type RdvCardCategory = 'devis' | 'debrief' | 'avenir' | 'absent' | 'autre'

// Premier cas qui matche. nowIso et scheduledAt sont des ISO → compare lexicographique.
export function rdvCardCategory(rdv: RdvResponse, nowIso: string): RdvCardCategory {
  if (rdv.hasDevisEnAttente) return 'devis'
  if (rdv.debriefFilledAt != null) return 'debrief'
  if (rdv.status === 'no_show' || rdv.status === 'annule' || rdv.status === 'reporte') return 'autre'
  if (rdv.scheduledAt >= nowIso) return 'avenir'
  return 'absent'
}
```

- [ ] **Step 4 : Lancer le test → succès**

Run: `cd ECOI_frontend && npx vitest run src/pages/rdv/rdvCardCategory.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git -C ECOI_frontend commit \
  src/pages/rdv/rdvCardCategory.ts \
  src/pages/rdv/rdvCardCategory.test.ts \
  -m "feat(rdv): rdvCardCategory — catégorie couleur d'une carte RDV (testé)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 : Frontend — câblage couleurs dans `RdvBlock`/`RdvButton` + légende

**Files:**
- Modify: `ECOI_frontend/src/pages/rdv/RdvCalendar.tsx` (imports, consts ~L52, `RdvBlock` L760-772, `RdvButton` L976-986, légende ~L434, main component `colorize`)

- [ ] **Step 1 : Importer la fonction et le type**

En haut de `RdvCalendar.tsx` (avec les autres imports relatifs), ajouter :

```ts
import { rdvCardCategory, type RdvCardCategory } from './rdvCardCategory'
```

`useAuth` est déjà importé (utilisé L115).

- [ ] **Step 2 : Ajouter le mapping catégorie → teinte Tailwind**

Juste après la définition de `CARD_TONE` (L52), ajouter :

```ts
// Teintes légères des cartes RDV par catégorie (admin / commercial_lead).
// Réutilise les tokens de teinte du design system (cf. CARD_TONE / vtKindTone).
const CATEGORY_TONE: Record<RdvCardCategory, string> = {
  devis: 'bg-cuivre-tint text-text border-line',
  debrief: 'bg-success-tint text-text border-line',
  avenir: 'bg-white text-text border-line',
  absent: 'bg-rouille-tint text-text border-line',
  autre: 'bg-info-tint text-text border-line',
}

// Teinte d'une carte RDV : VT → tone VT ; RDV local coloré (rôles autorisés) →
// teinte par catégorie ; sinon fond neutre actuel.
function rdvCardTone(item: CalendarItem, colorize: boolean): string {
  if (item.source === 'vt') return vtKindTone(item.vt)
  if (item.source === 'local' && colorize) {
    return CATEGORY_TONE[rdvCardCategory(item.rdv, new Date().toISOString())]
  }
  return CARD_TONE
}
```

(`vtKindTone` et `CalendarItem` sont définis plus bas/haut dans le fichier ; les fonctions au niveau module peuvent s'y référer. Si l'ordre de déclaration pose un souci de hoisting, `rdvCardTone` est une `function` → hoistée, OK ; `CATEGORY_TONE` est une `const` déclarée avant les composants qui l'utilisent.)

- [ ] **Step 3 : Utiliser la teinte dans `RdvBlock`**

Dans `RdvBlock` (L760), remplacer la ligne 772 :

```ts
  const tone = isVt ? vtKindTone(item.vt) : CARD_TONE
```

par :

```ts
  const role = useAuth((s) => s.user?.role)
  const colorize = role === 'admin' || role === 'commercial_lead'
  const tone = rdvCardTone(item, colorize)
```

- [ ] **Step 4 : Utiliser la teinte dans `RdvButton`**

Dans `RdvButton` (L976), remplacer la ligne 986 :

```ts
  const tone = isVt ? vtKindTone(item.vt) : CARD_TONE
```

par :

```ts
  const role = useAuth((s) => s.user?.role)
  const colorize = role === 'admin' || role === 'commercial_lead'
  const tone = rdvCardTone(item, colorize)
```

- [ ] **Step 5 : Ajouter le composant légende**

Avant la déclaration `function RdvBlock(` (L760), ajouter :

```tsx
function CalendarColorLegend() {
  const items: Array<{ tone: string; label: string }> = [
    { tone: 'bg-success-tint', label: 'Débrief fait' },
    { tone: 'bg-white border border-line', label: 'À venir' },
    { tone: 'bg-cuivre-tint', label: 'Devis en attente' },
    { tone: 'bg-rouille-tint', label: 'Pas de débrief' },
  ]
  return (
    <div className="px-4 sm:px-6 md:px-8 pt-2 flex items-center gap-3 flex-wrap text-[10px] sm:text-[11px] font-bold text-muted">
      <span className="uppercase tracking-wider text-faint">Légende :</span>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`w-3 h-3 rounded ${it.tone}`} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 6 : Afficher la légende (rôles autorisés)**

Dans le composant principal `RdvCalendar` (après `const role = useAuth(...)` L115), ajouter :

```ts
  const colorize = role === 'admin' || role === 'commercial_lead'
```

Puis dans le JSX, juste après la fermeture du bloc Filtres (la `</div>` à la L434, avant `<main` L436), insérer :

```tsx
      {colorize && <CalendarColorLegend />}
```

- [ ] **Step 7 : Typecheck + tests existants du calendrier**

Run: `cd ECOI_frontend && npx tsc --noEmit 2>&1 | grep -i "RdvCalendar\|rdvCardCategory" ; echo done`
Expected: `done` sans ligne d'erreur au-dessus.

Run: `cd ECOI_frontend && npx vitest run src/pages/rdv`
Expected: PASS (les tests roles/vt existants ne sont pas affectés — feeds vides, comportement inchangé).

- [ ] **Step 8 : Commit**

```bash
git -C ECOI_frontend commit src/pages/rdv/RdvCalendar.tsx \
  -m "feat(rdv): coloration des cartes calendrier par état (admin + commercial_lead) + légende

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 : Frontend — test composant (rôle + GHL/VT non affectés)

**Files:**
- Create: `ECOI_frontend/src/pages/rdv/RdvCalendar.colors.test.tsx`

Test en **vue mois** (`RdvButton`, pas de positionnement horaire → robuste). On vérifie qu'un RDV local débriefé reçoit `bg-success-tint` pour un admin, et le fond neutre `bg-cream-darker` pour un setter.

- [ ] **Step 1 : Écrire le test**

Créer `RdvCalendar.colors.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RdvResponse } from '../../lib/types'

vi.mock('../../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

let currentRole = 'admin'

const baseRdv = (over: Partial<RdvResponse>): RdvResponse => ({
  id: 'r1', externalId: null, leadId: 'lead-1', commercialId: 'c-1',
  scheduledAt: '2026-06-10T06:00:00.000Z', locationType: 'domicile',
  status: 'honore', result: null, signatureAt: null, montantTotal: null,
  financingType: null, objections: null, nonSaleReason: null, kits: null,
  notes: null, debriefFilledAt: '2026-06-10T07:00:00.000Z', debriefDueAt: null,
  hasDevisEnAttente: false, createdAt: '2026-06-10T05:00:00.000Z',
  updatedAt: '2026-06-10T05:00:00.000Z', lead: null,
  ...over,
})

vi.mock('../../lib/hooks', () => ({
  useRdvList: () => ({ data: [baseRdv({})], loading: false, error: null }),
  useGhlCalendarEvents: () => ({ data: undefined, loading: false, error: null }),
  useLeads: () => ({ data: [], loading: false, error: null }),
  useUsers: () => ({ data: [], loading: false, error: null }),
  useVtCalendar: () => ({ data: [], loading: false, error: null }),
}))
vi.mock('../../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string } }) => unknown) => sel({ user: { role: currentRole } }),
}))

import { RdvCalendar } from './RdvCalendar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-10T08:00:00.000Z'))
  window.localStorage.clear()
})
afterEach(() => vi.useRealTimers())

function renderMonth() {
  const result = render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
  fireEvent.click(result.getByText('Mois'))
  return result
}

describe('RdvCalendar — coloration des cartes', () => {
  it('admin : un RDV local débriefé est colorié en vert (bg-success-tint)', () => {
    currentRole = 'admin'
    const { container } = renderMonth()
    const card = container.querySelector('.rdv-block')
    expect(card).not.toBeNull()
    expect(card!.className).toContain('bg-success-tint')
  })

  it('setter : pas de coloration, fond neutre (bg-cream-darker)', () => {
    currentRole = 'setter'
    const { container } = renderMonth()
    const card = container.querySelector('.rdv-block')
    expect(card).not.toBeNull()
    expect(card!.className).toContain('bg-cream-darker')
    expect(card!.className).not.toContain('bg-success-tint')
  })
})
```

- [ ] **Step 2 : Lancer le test**

Run: `cd ECOI_frontend && npx vitest run src/pages/rdv/RdvCalendar.colors.test.tsx`
Expected: PASS (2 tests). Si le RDV n'apparaît pas en vue mois, vérifier que `scheduledAt` (2026-06-10) tombe bien dans le mois affiché (système figé au 2026-06-10) — c'est le cas.

- [ ] **Step 3 : Commit**

```bash
git -C ECOI_frontend commit src/pages/rdv/RdvCalendar.colors.test.tsx \
  -m "test(rdv): coloration des cartes calendrier selon le rôle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 : Vérification finale + push des deux repos

- [ ] **Step 1 : Suite de tests frontend ciblée**

Run: `cd ECOI_frontend && npx vitest run src/pages/rdv src/components/shell/Sidebar.test.tsx src/pages/Overview.commercial.test.tsx`
Expected: PASS.

- [ ] **Step 2 : Typecheck frontend global**

Run: `cd ECOI_frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Typecheck backend**

Run: `cd ECOI_backend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Push (chaque repo sur sa branche)**

```bash
git -C ECOI_backend push origin HEAD
git -C ECOI_frontend push origin HEAD
```

Expected: push fast-forward sur chaque `main` (résoudre par `git -C <repo> pull --rebase` puis re-push si un commit concurrent a été poussé entre-temps).

---

## Self-review (couverture spec)

- 🟢 Vert / ⬜ Blanc / 🟡 Jaune / 🔴 Rouge + ⚪ gris : Task 3 (logique) + Task 4 (`CATEGORY_TONE`). ✅
- Priorité jaune > vert, no_show/annulé/reporté gris, frontière `>=` : Task 3, testé. ✅
- Devis en attente = vrai statut `Devis='en_attente'` (approche A) : Task 1 (`EXISTS`). ✅
- Périmètre admin + commercial_lead, autres rôles neutres : Task 4 (`colorize`) + Task 5 (test rôle). ✅
- GHL/VT inchangés : `rdvCardTone` ne colore que `source==='local'` ; VT garde `vtKindTone`. ✅
- Légende : Task 4 step 5-6. ✅
- Teinte rouge = `rouille-tint` : `CATEGORY_TONE.absent`. ✅
- Tests unitaires par branche + test composant : Task 3 + Task 5. ✅
- Pas de test d'intégration DB backend (DB de test indispo) : noté Task 1. ✅
