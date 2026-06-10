# Débrief vente — kits tags, date auto, financement + acompte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre l'étape « Vente signée » du wizard de débrief : date auto, kits en étiquettes, et un bloc financement à choix en cascade (méthode → sous-choix → acompte) avec calcul d'acompte TTC, le tout persisté en base.

**Architecture :** Frontend = wizard React `CommercialDebriefSidebar` (état local `FormState`, machine à étapes). Backend = NestJS + Drizzle (table `debriefs`, DTO Zod, `DebriefsService`). On ajoute 4 colonnes structurées sur `debriefs` + une valeur d'enum `financing_type`, threadées depuis le formulaire jusqu'à l'insert. Migration appliquée via le cron job postgres jetable Render (DB de test indispo, 5432 sortant bloqué).

**Tech Stack :** React 18 + TypeScript + Vite (Vitest), NestJS + Drizzle ORM + Postgres, Zod (nestjs-zod).

**Contraintes repo (mémoire) :**
- Commits **scopés fichier par fichier** (`git commit <pathspec>`), jamais `git commit` nu ni `--amend` — un agent concurrent committe sur `main` en continu.
- DB de test indisponible : les specs backend tournent sans DB (mocks). Migration appliquée via cron Render, pas en local.

**Référence spec :** `ECOI_frontend/docs/superpowers/specs/2026-06-10-debrief-vente-financement-acompte-design.md`

---

## File Structure

**Backend (`ECOI_backend/`)**
- Modify `src/db/schema/enums.ts` — ajoute `paiement_12x` à `financingTypeEnum`.
- Modify `src/db/schema/debriefs.ts` — ajoute 4 colonnes.
- Create `src/db/migrations/0013_debrief_financement_acompte.sql` — DDL.
- Modify `src/modules/projects/dto/create-debrief.dto.ts` — `financingTypeValues` += `paiement_12x` ; 4 nouveaux champs Zod.
- Modify `src/modules/projects/debriefs.service.ts` — insert des 4 champs (2 blocs : `createForLead` + `create`) + patch `update`.
- Modify `src/modules/projects/debriefs.service.spec.ts` — couvre la persistance des nouveaux champs.

**Frontend (`ECOI_frontend/`)**
- Modify `src/lib/types.ts` — `FinancingType` += `paiement_12x` ; `DebriefResponse` + 4 champs ; constantes de libellés + valeurs.
- Create `src/lib/debriefFinancing.ts` — helpers purs (config méthodes, calcul acompte, join/split kits).
- Create `src/lib/debriefFinancing.test.ts` — tests unitaires des helpers.
- Modify `src/lib/api.ts` — (aucun changement de signature : `Partial<DebriefResponse>` suffit ; vérifier seulement).
- Modify `src/components/leads/CommercialDebriefSidebar.tsx` — `FormState`, `EMPTY_FORM`, défaut date, `Step4VDetails`, validation, `formToDebriefPayload`, cartes récap, restauration RDV.
- Modify `src/components/suivi/fiche-parts.tsx` — `DebriefCard` affiche le résumé financement.

**Hors périmètre :** `DebriefFormFields.tsx` / `ProjectDebriefsTab.tsx` (éditeur inline du projet) — inchangés ; les nouvelles colonnes étant nullable, rien ne casse.

---

## Task 1 : Backend — enum + colonnes schema + migration

**Files:**
- Modify: `ECOI_backend/src/db/schema/enums.ts:83-89`
- Modify: `ECOI_backend/src/db/schema/debriefs.ts:62-69`
- Create: `ECOI_backend/src/db/migrations/0013_debrief_financement_acompte.sql`

- [ ] **Step 1 : Ajouter la valeur d'enum**

Dans `enums.ts`, remplacer le bloc `financingTypeEnum` :

```ts
export const financingTypeEnum = pgEnum('financing_type', [
  'comptant',
  'financement',
  'financement_sans_apport',
  'apport_financement',
  'paiement_10x',
  'paiement_12x',
]);
```

- [ ] **Step 2 : Ajouter les 4 colonnes au schema `debriefs`**

Dans `debriefs.ts`, juste après la ligne `signedAt: date('signed_at'),` (ligne 69), ajouter :

```ts
    // Détail financement (saisi à l'étape « Vente signée » du wizard).
    // paymentSubMethod : cheque | especes | virement (comptant / 10x / 12x).
    // financingOrg     : cmoi | sofider (financement).
    // acomptePercent   : pourcentage retenu (null si montant direct saisi).
    // acompteAmount    : montant d'acompte € (calculé devis×% ou saisi).
    paymentSubMethod: text('payment_sub_method'),
    financingOrg: text('financing_org'),
    acomptePercent: integer('acompte_percent'),
    acompteAmount: numeric('acompte_amount', { precision: 10, scale: 2 }),
```

Et ajouter `integer` à l'import drizzle en haut du fichier :

```ts
import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  date,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 3 : Écrire la migration SQL**

Créer `src/db/migrations/0013_debrief_financement_acompte.sql` :

```sql
-- Ajout valeur enum financing_type : paiement 12x
ALTER TYPE "financing_type" ADD VALUE IF NOT EXISTS 'paiement_12x';

-- Détail financement sur les débriefs
ALTER TABLE "debriefs" ADD COLUMN IF NOT EXISTS "payment_sub_method" text;
ALTER TABLE "debriefs" ADD COLUMN IF NOT EXISTS "financing_org" text;
ALTER TABLE "debriefs" ADD COLUMN IF NOT EXISTS "acompte_percent" integer;
ALTER TABLE "debriefs" ADD COLUMN IF NOT EXISTS "acompte_amount" numeric(10, 2);
```

Note Postgres : `ALTER TYPE ... ADD VALUE` doit s'exécuter **hors d'une transaction qui réutilise la valeur dans la même tx**. Ici on n'utilise pas `paiement_12x` dans la migration elle-même (DDL pur), donc c'est sûr. Si le runner Drizzle enveloppe tout dans une transaction et que Postgres refuse, scinder en deux fichiers (`0013a` enum, `0013b` colonnes). PG ≥ 12 accepte l'ADD VALUE en transaction tant que la valeur n'est pas consommée dans la même tx.

- [ ] **Step 4 : Vérifier la compilation TypeScript du schema**

Run: `cd ECOI_backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: aucune erreur sur `enums.ts` / `debriefs.ts` (les colonnes typées, `integer` importé).

- [ ] **Step 5 : Commit (scopé)**

```bash
cd ECOI_backend
git add src/db/schema/enums.ts src/db/schema/debriefs.ts src/db/migrations/0013_debrief_financement_acompte.sql
git commit src/db/schema/enums.ts src/db/schema/debriefs.ts src/db/migrations/0013_debrief_financement_acompte.sql -m "feat(debrief): colonnes financement/acompte + enum paiement_12x

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 : Backend — DTO Zod (4 champs + enum)

**Files:**
- Modify: `ECOI_backend/src/modules/projects/dto/create-debrief.dto.ts:38-63`

- [ ] **Step 1 : Étendre `financingTypeValues`**

Remplacer le tableau `financingTypeValues` :

```ts
export const financingTypeValues = [
  'comptant',
  'financement',
  'financement_sans_apport',
  'apport_financement',
  'paiement_10x',
  'paiement_12x',
] as const;
```

- [ ] **Step 2 : Ajouter les valeurs d'énumération des sous-choix**

Juste après `financingTypeValues`, ajouter :

```ts
export const paymentSubMethodValues = ['cheque', 'especes', 'virement'] as const;
export const financingOrgValues = ['cmoi', 'sofider'] as const;
```

- [ ] **Step 3 : Ajouter les 4 champs au schema Zod**

Dans `createDebriefSchema`, après la ligne `signedAt: ...` (ligne 62), ajouter :

```ts
  paymentSubMethod: z.enum(paymentSubMethodValues).nullable().optional(),
  financingOrg: z.enum(financingOrgValues).nullable().optional(),
  acomptePercent: z.number().int().min(0).max(100).nullable().optional(),
  acompteAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
```

- [ ] **Step 4 : Vérifier la compilation**

Run: `cd ECOI_backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: aucune erreur.

- [ ] **Step 5 : Commit (scopé)**

```bash
cd ECOI_backend
git commit src/modules/projects/dto/create-debrief.dto.ts -m "feat(debrief): DTO financement/acompte (sous-méthode, organisme, acompte)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 : Backend — persistance dans le service (TDD)

**Files:**
- Test: `ECOI_backend/src/modules/projects/debriefs.service.spec.ts`
- Modify: `ECOI_backend/src/modules/projects/debriefs.service.ts:54-60,105-111,127-130,182-185`

- [ ] **Step 1 : Écrire le test d'abord**

Ouvrir `debriefs.service.spec.ts`, repérer un test existant `createForLead` qui inspecte l'objet passé à `.values(...)` (le mock `insert().values().returning()`). Ajouter un test qui vérifie le passage des nouveaux champs. Modèle (adapter aux noms de mocks déjà présents dans le fichier) :

```ts
it('persiste le détail financement (sous-méthode, organisme, acompte)', async () => {
  await service.createForLead('lead-1', {
    outcome: 'vente',
    montantTotal: '30000.00',
    paymentSubMethod: 'virement',
    acomptePercent: 40,
    acompteAmount: '12000.00',
  } as any, 'commercial-1');

  expect(valuesMock).toHaveBeenCalledWith(
    expect.objectContaining({
      paymentSubMethod: 'virement',
      financingOrg: null,
      acomptePercent: 40,
      acompteAmount: '12000.00',
    }),
  );
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run: `cd ECOI_backend && npx vitest run src/modules/projects/debriefs.service.spec.ts -t "détail financement" 2>&1 | tail -25`
Expected: FAIL — `paymentSubMethod` absent de l'objet `.values()` (champs non encore branchés).

- [ ] **Step 3 : Brancher les champs dans `createForLead` (bloc lignes ~54-60)**

Dans le `.values({ ... })` de `createForLead`, après `signedAt: dto.signedAt ?? null,`, ajouter :

```ts
          paymentSubMethod: dto.paymentSubMethod ?? null,
          financingOrg: dto.financingOrg ?? null,
          acomptePercent: dto.acomptePercent ?? null,
          acompteAmount: dto.acompteAmount ?? null,
```

- [ ] **Step 4 : Brancher les champs dans `create` (bloc lignes ~105-111)**

Dans le `.values({ ... })` de `create`, après `signedAt: dto.signedAt ?? null,`, ajouter le même bloc :

```ts
        paymentSubMethod: dto.paymentSubMethod ?? null,
        financingOrg: dto.financingOrg ?? null,
        acomptePercent: dto.acomptePercent ?? null,
        acompteAmount: dto.acompteAmount ?? null,
```

- [ ] **Step 5 : Brancher les champs dans les deux `update` (patch, lignes ~127-130 et ~182-185)**

Dans **chaque** bloc `update` (il y en a deux : sync RDV et update direct), après la dernière ligne `if (dto.signedAt !== undefined) ...`, ajouter :

```ts
      if (dto.paymentSubMethod !== undefined) patch.paymentSubMethod = dto.paymentSubMethod;
      if (dto.financingOrg !== undefined) patch.financingOrg = dto.financingOrg;
      if (dto.acomptePercent !== undefined) patch.acomptePercent = dto.acomptePercent;
      if (dto.acompteAmount !== undefined) patch.acompteAmount = dto.acompteAmount;
```

(Attention : un des deux blocs `update` synchronise la table `rdv` qui n'a PAS ces colonnes — n'ajouter ces 4 lignes QUE dans le patch ciblant `debriefs`. Vérifier la table cible avant d'éditer ; ne pas toucher le patch `rdv`.)

- [ ] **Step 6 : Lancer le test, vérifier qu'il passe**

Run: `cd ECOI_backend && npx vitest run src/modules/projects/debriefs.service.spec.ts 2>&1 | tail -25`
Expected: PASS (tout le fichier vert).

- [ ] **Step 7 : Compilation**

Run: `cd ECOI_backend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: aucune erreur.

- [ ] **Step 8 : Commit (scopé)**

```bash
cd ECOI_backend
git commit src/modules/projects/debriefs.service.ts src/modules/projects/debriefs.service.spec.ts -m "feat(debrief): persiste financement/acompte dans DebriefsService

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 : Frontend — types

**Files:**
- Modify: `ECOI_frontend/src/lib/types.ts:355-360,768-770`

- [ ] **Step 1 : Étendre `FinancingType`**

Remplacer (lignes 355-360) :

```ts
export type FinancingType =
  | 'comptant'
  | 'financement'
  | 'financement_sans_apport'
  | 'apport_financement'
  | 'paiement_10x'
  | 'paiement_12x'
```

- [ ] **Step 2 : Ajouter les types de sous-choix + champs à `DebriefResponse`**

Juste avant `export type FinancingType` (ligne 355), ajouter :

```ts
export type PaymentSubMethod = 'cheque' | 'especes' | 'virement'
export type FinancingOrg = 'cmoi' | 'sofider'

export const PAYMENT_SUB_METHOD_LABEL: Record<PaymentSubMethod, string> = {
  cheque: 'Chèque',
  especes: 'Espèces',
  virement: 'Virement',
}
export const FINANCING_ORG_LABEL: Record<FinancingOrg, string> = {
  cmoi: 'CMOI',
  sofider: 'Sofider',
}
```

Dans l'interface `DebriefResponse`, après `kits: string | null;` (ligne 769), ajouter :

```ts
  paymentSubMethod: PaymentSubMethod | null;
  financingOrg: FinancingOrg | null;
  acomptePercent: number | null;
  acompteAmount: string | null;
```

- [ ] **Step 3 : Compilation (typecheck du frontend)**

Run: `cd ECOI_frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: des erreurs APPARAÎTRONT dans `CommercialDebriefSidebar.tsx` / `fiche-parts.tsx` (champs pas encore gérés) — c'est attendu, elles seront résorbées par les tâches 5-9. Vérifier seulement que `types.ts` lui-même ne génère pas d'erreur.

- [ ] **Step 4 : Commit (scopé)**

```bash
cd ECOI_frontend
git commit src/lib/types.ts -m "feat(debrief): types financement/acompte + libellés sous-méthode/organisme

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 : Frontend — helpers purs financement (TDD)

**Files:**
- Create: `ECOI_frontend/src/lib/debriefFinancing.ts`
- Test: `ECOI_frontend/src/lib/debriefFinancing.test.ts`

- [ ] **Step 1 : Écrire les tests d'abord**

Créer `src/lib/debriefFinancing.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import {
  computeAcompteAmount,
  joinKits,
  splitKits,
  PAYMENT_METHOD_CONFIG,
} from './debriefFinancing'

describe('computeAcompteAmount', () => {
  it('calcule le pourcentage du devis TTC', () => {
    expect(computeAcompteAmount('30000', 40)).toBe(12000)
    expect(computeAcompteAmount('30000', 30)).toBe(9000)
  })
  it('gère la virgule décimale', () => {
    expect(computeAcompteAmount('1000,50', 20)).toBeCloseTo(200.1)
  })
  it('retourne null si montant ou pourcentage invalide', () => {
    expect(computeAcompteAmount('', 40)).toBeNull()
    expect(computeAcompteAmount('abc', 40)).toBeNull()
    expect(computeAcompteAmount('30000', null)).toBeNull()
  })
})

describe('kits join/split', () => {
  it('joint avec le séparateur', () => {
    expect(joinKits(['8 PV', 'batterie 5 kWh'])).toBe('8 PV · batterie 5 kWh')
  })
  it('découpe sur le séparateur en nettoyant', () => {
    expect(splitKits('8 PV · batterie 5 kWh')).toEqual(['8 PV', 'batterie 5 kWh'])
    expect(splitKits('')).toEqual([])
    expect(splitKits(null)).toEqual([])
  })
})

describe('PAYMENT_METHOD_CONFIG', () => {
  it('définit les 4 méthodes avec leurs options', () => {
    expect(PAYMENT_METHOD_CONFIG.comptant.acomptePercents).toEqual([40, 30])
    expect(PAYMENT_METHOD_CONFIG.financement.acomptePercents).toEqual([30, 20])
    expect(PAYMENT_METHOD_CONFIG.paiement_10x.acomptePercents).toEqual([30])
    expect(PAYMENT_METHOD_CONFIG.paiement_12x.acomptePercents).toEqual([30])
    expect(PAYMENT_METHOD_CONFIG.financement.subChoice).toBe('org')
    expect(PAYMENT_METHOD_CONFIG.comptant.subChoice).toBe('method')
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `cd ECOI_frontend && npx vitest run src/lib/debriefFinancing.test.ts 2>&1 | tail -20`
Expected: FAIL — module `./debriefFinancing` introuvable.

- [ ] **Step 3 : Implémenter le module**

Créer `src/lib/debriefFinancing.ts` :

```ts
import type { FinancingType, PaymentSubMethod, FinancingOrg } from './types'

export const KITS_SEPARATOR = ' · '

export function joinKits(kits: string[]): string {
  return kits.map((k) => k.trim()).filter(Boolean).join(KITS_SEPARATOR)
}

export function splitKits(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(KITS_SEPARATOR).map((k) => k.trim()).filter(Boolean)
}

/** Acompte = montant devis TTC × pourcentage. null si entrées invalides. */
export function computeAcompteAmount(quoteAmount: string, percent: number | null): number | null {
  if (percent == null) return null
  const amount = Number(quoteAmount.replace(',', '.'))
  if (!quoteAmount.trim() || Number.isNaN(amount)) return null
  return (amount * percent) / 100
}

/** Sous-choix d'une méthode : pills chèque/espèces/virement, ou organisme CMOI/Sofider. */
export type SubChoiceKind = 'method' | 'org'

export type PaymentMethodConfig = {
  value: Extract<FinancingType, 'comptant' | 'financement' | 'paiement_10x' | 'paiement_12x'>
  label: string
  subChoice: SubChoiceKind
  acomptePercents: number[]
}

export const PAYMENT_METHOD_CONFIG: Record<
  'comptant' | 'financement' | 'paiement_10x' | 'paiement_12x',
  PaymentMethodConfig
> = {
  comptant: { value: 'comptant', label: 'Comptant', subChoice: 'method', acomptePercents: [40, 30] },
  financement: { value: 'financement', label: 'Financement', subChoice: 'org', acomptePercents: [30, 20] },
  paiement_10x: { value: 'paiement_10x', label: 'Paiement 10x', subChoice: 'method', acomptePercents: [30] },
  paiement_12x: { value: 'paiement_12x', label: 'Paiement 12x', subChoice: 'method', acomptePercents: [30] },
}

export const PAYMENT_METHOD_ORDER: PaymentMethodConfig['value'][] = [
  'comptant',
  'financement',
  'paiement_10x',
  'paiement_12x',
]

export const SUB_METHODS: { value: PaymentSubMethod; label: string }[] = [
  { value: 'cheque', label: 'Chèque' },
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement' },
]

export const FINANCING_ORGS: { value: FinancingOrg; label: string }[] = [
  { value: 'cmoi', label: 'CMOI' },
  { value: 'sofider', label: 'Sofider' },
]

/** Formate un montant € pour affichage (2 décimales, séparateur milliers FR). */
export function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `cd ECOI_frontend && npx vitest run src/lib/debriefFinancing.test.ts 2>&1 | tail -20`
Expected: PASS (tous les tests verts).

- [ ] **Step 5 : Commit (scopé)**

```bash
cd ECOI_frontend
git commit src/lib/debriefFinancing.ts src/lib/debriefFinancing.test.ts -m "feat(debrief): helpers purs financement (acompte, kits, config méthodes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 : Frontend — état du formulaire (FormState, défaut date, kits)

**Files:**
- Modify: `ECOI_frontend/src/components/leads/CommercialDebriefSidebar.tsx:59-69,171-181`

- [ ] **Step 1 : Étendre `FormState`**

Remplacer la définition `type FormState` (lignes 59-69) :

```ts
type FormState = {
  outcome: Outcome
  nonSaleReason: NonSaleReason | ''
  objection: Objection | ''
  acceptanceFactors: AcceptanceFactor[]
  notes: string
  quoteAmount: string
  signedAt: string
  kits: string[]                                  // étiquettes (était string)
  paymentMethod: FinancingType | ''
  paymentSubMethod: PaymentSubMethod | ''         // comptant / 10x / 12x
  financingOrg: FinancingOrg | ''                 // financement
  acomptePercent: number | null                   // null = montant direct
  acompteAmountInput: string                      // montant saisi si direct
}
```

- [ ] **Step 2 : Mettre à jour les imports de types**

Dans le bloc d'import `from '../../lib/types'` (lignes 4-11), ajouter `PaymentSubMethod` et `FinancingOrg` :

```ts
import {
  fullName,
  type FinancingType,
  type FinancingOrg,
  type PaymentSubMethod,
  type LeadResponse,
  type ProjectResponse,
  type RdvResponse,
  type RdvResult,
} from '../../lib/types'
```

Et importer les helpers en haut (après l'import `createLeadDebrief`) :

```ts
import {
  PAYMENT_METHOD_CONFIG,
  PAYMENT_METHOD_ORDER,
  SUB_METHODS,
  FINANCING_ORGS,
  computeAcompteAmount,
  formatEuro,
  joinKits,
  splitKits,
} from '../../lib/debriefFinancing'
```

- [ ] **Step 3 : Date du jour par défaut + nouveaux champs dans `EMPTY_FORM`**

Juste avant `const EMPTY_FORM` (ligne 171), ajouter un helper :

```ts
function todayIso(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (date du débrief)
}
```

Remplacer `EMPTY_FORM` (lignes 171-181) :

```ts
const EMPTY_FORM: FormState = {
  outcome: '',
  nonSaleReason: '',
  objection: '',
  acceptanceFactors: [],
  notes: '',
  quoteAmount: '',
  signedAt: todayIso(),
  kits: [],
  paymentMethod: '',
  paymentSubMethod: '',
  financingOrg: '',
  acomptePercent: null,
  acompteAmountInput: '',
}
```

- [ ] **Step 4 : Supprimer la constante `PAYMENT_METHODS` (remplacée par le helper)**

Supprimer le bloc `const PAYMENT_METHODS = [...]` (lignes 165-169). Les usages seront recâblés sur `PAYMENT_METHOD_CONFIG` / `PAYMENT_METHOD_ORDER` dans les tâches 7-9.

- [ ] **Step 5 : Typecheck (erreurs attendues, on les résout ensuite)**

Run: `cd ECOI_frontend && npx tsc --noEmit 2>&1 | grep CommercialDebriefSidebar | head -30`
Expected: erreurs sur `form.kits` (était string) et `PAYMENT_METHODS` supprimé, aux endroits traités par les tâches 7-9. On NE commit PAS encore (compilation cassée) — Task 6 sera commitée avec Task 7-8 une fois le fichier cohérent. Passer à Task 7.

---

## Task 7 : Frontend — UI `Step4VDetails` (kits tags + financement cascade)

**Files:**
- Modify: `ECOI_frontend/src/components/leads/CommercialDebriefSidebar.tsx:601-691`

- [ ] **Step 1 : Réécrire `Step4VDetails`**

Remplacer toute la fonction `Step4VDetails` (lignes 601-676) par cette version. Le bandeau « Vente signée » et le champ hero « Valeur du devis signé » sont conservés ; la **date de signature est retirée** ; les kits deviennent des tags ; le bloc paiement devient une cascade.

```tsx
function Step4VDetails({ form, update }: StepProps) {
  const [kitInput, setKitInput] = useState('')

  const addKit = () => {
    const v = kitInput.trim()
    if (!v) return
    update({ kits: [...form.kits, v] })
    setKitInput('')
  }
  const removeKit = (idx: number) =>
    update({ kits: form.kits.filter((_, i) => i !== idx) })

  const methodCfg = form.paymentMethod
    ? PAYMENT_METHOD_CONFIG[form.paymentMethod as keyof typeof PAYMENT_METHOD_CONFIG]
    : null
  const computed =
    form.acomptePercent != null
      ? computeAcompteAmount(form.quoteAmount, form.acomptePercent)
      : null

  const pickMethod = (value: PaymentMethodConfigValue) =>
    update({ paymentMethod: value, paymentSubMethod: '', financingOrg: '', acomptePercent: null, acompteAmountInput: '' })

  return (
    <div className="space-y-4">
      {/* Bandeau : on cadre l'étape comme le moment de la vente gagnée */}
      <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success-tint px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success text-white shadow-sm">
          <Icon name="trophy" size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-success">Vente signée</div>
          <p className="text-xs font-bold text-text/70">Renseigne les détails du devis pour finaliser.</p>
        </div>
      </div>

      {/* Champ hero : la valeur du devis TTC, c'est le chiffre qui compte */}
      <div className="rounded-2xl border border-success/40 bg-white p-4 shadow-sm">
        <label className="flex items-center justify-between text-[11px] font-black uppercase tracking-[0.14em] text-muted">
          <span>Valeur du devis signé (TTC) <span className="text-rouille">*</span></span>
          <Icon name="sparkles" size={14} className="text-success" />
        </label>
        <div className="mt-2 flex items-baseline gap-2 border-b-2 border-success/20 pb-1 focus-within:border-success">
          <span className="text-2xl font-black text-success">€</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.quoteAmount}
            onChange={(e) => update({ quoteAmount: e.target.value })}
            placeholder="0,00"
            className="w-full bg-transparent text-3xl font-black tracking-tight text-text outline-none placeholder:text-faint/40"
          />
        </div>
      </div>

      {/* Kits vendus — saisie par étiquettes */}
      <FieldGroup label="Kits vendus" required>
        <div className="flex gap-2">
          <input
            type="text"
            value={kitInput}
            onChange={(e) => setKitInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKit() } }}
            placeholder="Ex. : 8 PV, batterie 5 kWh…"
            className="w-full rounded-xl border border-line bg-cream py-2 px-3 text-sm text-text outline-none focus:border-or"
          />
          <button
            type="button"
            onClick={addKit}
            disabled={!kitInput.trim()}
            className="shrink-0 rounded-xl border border-or bg-or px-3 py-2 text-sm font-black text-white disabled:opacity-40"
          >
            Ajouter
          </button>
        </div>
        {form.kits.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {form.kits.map((kit, idx) => (
              <span key={`${kit}-${idx}`} className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-tint px-2.5 py-1 text-[12px] font-bold text-success">
                {kit}
                <button type="button" onClick={() => removeKit(idx)} className="text-success/60 hover:text-success" aria-label={`Retirer ${kit}`}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </FieldGroup>

      {/* Financement : méthode → sous-choix → acompte */}
      <FieldGroup label="Financement" required>
        <div className="grid grid-cols-2 gap-1.5">
          {PAYMENT_METHOD_ORDER.map((value) => (
            <PaymentPill
              key={value}
              active={form.paymentMethod === value}
              icon={value === 'comptant' ? 'check' : value === 'financement' ? 'chart' : 'calendar'}
              label={PAYMENT_METHOD_CONFIG[value].label}
              onClick={() => pickMethod(value)}
            />
          ))}
        </div>
      </FieldGroup>

      {methodCfg && (
        <div className="space-y-4 rounded-2xl border border-line bg-cream/60 p-3">
          {/* Sous-choix : méthode (chèque/espèces/virement) ou organisme (CMOI/Sofider) */}
          {methodCfg.subChoice === 'method' ? (
            <FieldGroup label="Moyen de paiement" required>
              <div className="grid grid-cols-3 gap-1.5">
                {SUB_METHODS.map((m) => (
                  <ChoiceChip key={m.value} active={form.paymentSubMethod === m.value} label={m.label} onClick={() => update({ paymentSubMethod: m.value })} />
                ))}
              </div>
            </FieldGroup>
          ) : (
            <FieldGroup label="Organisme de financement" required>
              <div className="grid grid-cols-2 gap-1.5">
                {FINANCING_ORGS.map((o) => (
                  <ChoiceChip key={o.value} active={form.financingOrg === o.value} label={o.label} onClick={() => update({ financingOrg: o.value })} />
                ))}
              </div>
            </FieldGroup>
          )}

          {/* Acompte : pourcentages + montant direct */}
          <FieldGroup label="Acompte" required>
            <div className="flex flex-wrap gap-1.5">
              {methodCfg.acomptePercents.map((pct) => (
                <ChoiceChip
                  key={pct}
                  active={form.acomptePercent === pct}
                  label={`${pct} %`}
                  onClick={() => update({ acomptePercent: pct, acompteAmountInput: '' })}
                />
              ))}
              <ChoiceChip
                active={form.acomptePercent == null && form.acompteAmountInput !== ''}
                label="Montant direct"
                onClick={() => update({ acomptePercent: null })}
              />
            </div>

            {form.acomptePercent != null && computed != null && (
              <p className="mt-2 text-sm font-black text-success">
                Acompte : {formatEuro(computed)} € TTC
              </p>
            )}
            {form.acomptePercent == null && (
              <div className="mt-2 flex items-baseline gap-2 border-b-2 border-success/20 pb-1 focus-within:border-success">
                <span className="text-lg font-black text-success">€</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.acompteAmountInput}
                  onChange={(e) => update({ acompteAmountInput: e.target.value })}
                  placeholder="Montant de l'acompte"
                  className="w-full bg-transparent text-xl font-black text-text outline-none placeholder:text-faint/40"
                />
              </div>
            )}
          </FieldGroup>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2 : Ajouter le type d'alias utilisé dans `pickMethod`**

Juste au-dessus de `function Step4VDetails`, ajouter :

```tsx
type PaymentMethodConfigValue = (typeof PAYMENT_METHOD_ORDER)[number]
```

- [ ] **Step 3 : Vérifier que `ChoiceChip` et `FieldGroup` existent**

Run: `cd ECOI_frontend && grep -n "function ChoiceChip\|function FieldGroup\|const ChoiceChip\|const FieldGroup" src/components/leads/CommercialDebriefSidebar.tsx`
Expected: les deux composants existent dans le fichier (utilisés par les autres étapes). `ChoiceChip` prend `{ active, label, onClick, hint? }`. Si la signature diffère (ex. `value`/`selected`), adapter les props ci-dessus en conséquence.

- [ ] **Step 4 : Garder `PaymentPill`**

`PaymentPill` (défini juste après l'ancien `Step4VDetails`, lignes ~678-691) est réutilisé tel quel. Ne pas le supprimer.

- [ ] (Pas de commit ici — compilation encore incomplète tant que la validation/payload (Task 8) n'est pas faite. Enchaîner Task 8.)

---

## Task 8 : Frontend — validation + payload + restauration RDV

**Files:**
- Modify: `ECOI_frontend/src/components/leads/CommercialDebriefSidebar.tsx:104-118,288-292,1067-1070,1086-1107`

- [ ] **Step 1 : Helper de complétude du financement**

Juste avant `function canAdvanceStep` (ligne 104), ajouter :

```ts
function isFinancingComplete(form: FormState): boolean {
  if (!form.paymentMethod) return false
  const cfg = PAYMENT_METHOD_CONFIG[form.paymentMethod as keyof typeof PAYMENT_METHOD_CONFIG]
  if (!cfg) return false
  const subOk = cfg.subChoice === 'method' ? form.paymentSubMethod !== '' : form.financingOrg !== ''
  const acompteOk =
    form.acomptePercent != null ||
    (form.acompteAmountInput.trim() !== '' && Number(form.acompteAmountInput.replace(',', '.')) > 0)
  return subOk && acompteOk
}

function isVenteDetailsComplete(form: FormState): boolean {
  return (
    form.quoteAmount.trim() !== '' &&
    form.kits.length > 0 &&
    isFinancingComplete(form)
  )
}
```

- [ ] **Step 2 : Brancher la validation d'étape `details_v`**

Remplacer le `case 'details_v':` dans `canAdvanceStep` (lignes 109-113) par :

```ts
    case 'details_v':
      return isVenteDetailsComplete(form)
```

(La date n'est plus une condition : `signedAt` est auto-rempli.)

- [ ] **Step 3 : Brancher `canSubmit`**

Remplacer le ternaire `canSubmit` (lignes 288-292) :

```ts
  const canSubmit =
    form.outcome !== '' &&
    (form.outcome === 'vente'
      ? isVenteDetailsComplete(form)
      : form.nonSaleReason !== '')
```

- [ ] **Step 4 : Calculer le montant d'acompte final dans `formToDebriefPayload`**

Remplacer `formToDebriefPayload` (lignes 1086-1107) :

```ts
function formToDebriefPayload(form: FormState, rdvId: string | null) {
  const isVente = form.outcome === 'vente'
  const amount =
    isVente && form.quoteAmount.trim() !== ''
      ? form.quoteAmount.trim().replace(',', '.')
      : null

  // Montant d'acompte : calculé (devis × %) si pourcentage, sinon saisi direct.
  let acompteAmount: string | null = null
  if (isVente) {
    if (form.acomptePercent != null) {
      const computed = computeAcompteAmount(form.quoteAmount, form.acomptePercent)
      acompteAmount = computed != null ? computed.toFixed(2) : null
    } else if (form.acompteAmountInput.trim() !== '') {
      acompteAmount = Number(form.acompteAmountInput.replace(',', '.')).toFixed(2)
    }
  }

  return {
    projectId: null as string | null,
    rdvId,
    outcome: (isVente ? 'vente' : 'non_vente') as 'vente' | 'non_vente',
    nonSaleReason: !isVente && form.nonSaleReason ? form.nonSaleReason : null,
    objection: form.objection ? labelFromObjection(form.objection) : null,
    acceptanceFactors: isVente ? form.acceptanceFactors : [],
    notes: form.notes.trim() || null,
    montantTotal: amount,
    financingType: isVente && form.paymentMethod ? form.paymentMethod : null,
    kits: isVente && form.kits.length > 0 ? joinKits(form.kits) : null,
    signedAt: isVente && form.signedAt ? form.signedAt : null,
    paymentSubMethod: isVente && form.paymentSubMethod ? form.paymentSubMethod : null,
    financingOrg: isVente && form.financingOrg ? form.financingOrg : null,
    acomptePercent: isVente ? form.acomptePercent : null,
    acompteAmount,
  }
}
```

- [ ] **Step 5 : Mettre à jour le chemin RDV (handleSubmit) pour le `kits` tags**

Dans `handleSubmit` (ligne 349), `kits: form.outcome === 'vente' ? form.kits.trim() || null : null,` casse car `form.kits` est désormais un tableau. Remplacer par :

```ts
          kits: form.outcome === 'vente' && form.kits.length > 0 ? joinKits(form.kits) : null,
```

- [ ] **Step 6 : Mettre à jour la restauration depuis un RDV (`rdvToForm`)**

Dans l'objet retourné autour des lignes 1067-1070, remplacer :

```ts
    kits: rdv.kits ?? '',
    paymentMethod: (rdv.financingType ?? '') as FormState['paymentMethod'],
```

par :

```ts
    kits: splitKits(rdv.kits),
    paymentMethod: (rdv.financingType ?? '') as FormState['paymentMethod'],
    paymentSubMethod: '',
    financingOrg: '',
    acomptePercent: null,
    acompteAmountInput: '',
```

(La table `rdv` ne porte pas le détail acompte ; on restaure seulement ce qu'elle connaît. `signedAt` reste géré comme avant — ligne `signedAt: rdv.signatureAt ?? '',` à garder ; à la réouverture d'un RDV vente, le champ date n'est plus affiché mais la valeur reste envoyée.)

- [ ] **Step 7 : Mettre à jour les cartes récap (`selectedDebriefCards`)**

Remplacer les lignes 1128-1130 (date, kits, payment) :

```ts
    if (form.kits.length > 0) cards.push({ label: joinKits(form.kits), sublabel: 'Kits vendus', tone: 'success' })
    if (form.paymentMethod) {
      const cfg = PAYMENT_METHOD_CONFIG[form.paymentMethod as keyof typeof PAYMENT_METHOD_CONFIG]
      const sub = form.paymentSubMethod
        ? SUB_METHODS.find((m) => m.value === form.paymentSubMethod)?.label
        : form.financingOrg
          ? FINANCING_ORGS.find((o) => o.value === form.financingOrg)?.label
          : ''
      const label = [cfg?.label, sub].filter(Boolean).join(' · ')
      cards.push({ label: label || (cfg?.label ?? form.paymentMethod), sublabel: 'Financement', tone: 'success' })
    }
    if (form.acomptePercent != null) {
      const computed = computeAcompteAmount(form.quoteAmount, form.acomptePercent)
      if (computed != null) cards.push({ label: `${formatEuro(computed)} € (${form.acomptePercent} %)`, sublabel: 'Acompte', tone: 'success' })
    } else if (form.acompteAmountInput.trim() !== '') {
      cards.push({ label: `${form.acompteAmountInput.trim()} €`, sublabel: 'Acompte', tone: 'success' })
    }
```

(La carte « Date de signature » des lignes 1128 est **supprimée**.)

- [ ] **Step 8 : Typecheck complet du fichier**

Run: `cd ECOI_frontend && npx tsc --noEmit 2>&1 | grep -E "CommercialDebriefSidebar|debriefFinancing" | head -30`
Expected: AUCUNE erreur. (Si `ChoiceChip` a une autre signature de props, corriger les appels de Task 7.)

- [ ] **Step 9 : Lint + tests**

Run: `cd ECOI_frontend && npx vitest run src/lib/debriefFinancing.test.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 10 : Commit (scopé) — Task 6+7+8 ensemble (fichier cohérent)**

```bash
cd ECOI_frontend
git commit src/components/leads/CommercialDebriefSidebar.tsx -m "feat(debrief): étape vente — kits tags, date auto, financement + acompte

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 : Frontend — affichage du financement dans `DebriefCard`

**Files:**
- Modify: `ECOI_frontend/src/components/suivi/fiche-parts.tsx:87-100`

- [ ] **Step 1 : Enrichir `DebriefCard`**

Remplacer la fonction `DebriefCard` (lignes 87-100). Ajouter une ligne de résumé financement quand le débrief est une vente.

```tsx
export function DebriefCard({ debrief }: { debrief: DebriefResponse }) {
  const financingBits = [
    debrief.financingType ? FINANCING_TYPE_SHORT[debrief.financingType] ?? debrief.financingType : null,
    debrief.paymentSubMethod ? PAYMENT_SUB_METHOD_LABEL[debrief.paymentSubMethod] : null,
    debrief.financingOrg ? FINANCING_ORG_LABEL[debrief.financingOrg] : null,
  ].filter(Boolean)
  const acompte =
    debrief.acompteAmount != null
      ? `acompte ${debrief.acompteAmount} €${debrief.acomptePercent != null ? ` (${debrief.acomptePercent} %)` : ''}`
      : null

  return (
    <article className="rounded-xl border border-line bg-white p-3.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-black text-text">
          Débrief · {DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-faint">{formatDate(debrief.createdAt)}</span>
      </div>
      {debrief.notes && <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{debrief.notes}</p>}
      {debrief.objection && <p className="mt-1 text-[11px] font-semibold text-faint">Objection : {debrief.objection}</p>}
      {(financingBits.length > 0 || acompte) && (
        <p className="mt-1 text-[11px] font-semibold text-faint">
          {[financingBits.join(' · '), acompte].filter(Boolean).join(' · ')}
        </p>
      )}
    </article>
  )
}
```

- [ ] **Step 2 : Importer les libellés + définir le mapping court**

En haut de `fiche-parts.tsx`, dans l'import depuis `../../lib/types`, ajouter `PAYMENT_SUB_METHOD_LABEL`, `FINANCING_ORG_LABEL` (et `FinancingType` si pas déjà importé). Puis, près des autres constantes du fichier, ajouter :

```ts
const FINANCING_TYPE_SHORT: Record<string, string> = {
  comptant: 'Comptant',
  financement: 'Financement',
  financement_sans_apport: 'Financement sans apport',
  apport_financement: 'Apport + financement',
  paiement_10x: 'Paiement 10x',
  paiement_12x: 'Paiement 12x',
}
```

- [ ] **Step 3 : Typecheck**

Run: `cd ECOI_frontend && npx tsc --noEmit 2>&1 | grep fiche-parts | head -20`
Expected: aucune erreur.

- [ ] **Step 4 : Commit (scopé)**

```bash
cd ECOI_frontend
git commit src/components/suivi/fiche-parts.tsx -m "feat(debrief): DebriefCard affiche le résumé financement/acompte

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 : Appliquer la migration (ops Render)

**Files:** aucune modification de code — opération d'infra.

- [ ] **Step 1 : Vérifier le contenu de la migration et le mécanisme cron**

Run: `cd ECOI_backend && ls src/db/migrations/ | tail -5 && cat ../migrer_bdd.sh`
Expected: `0013_debrief_financement_acompte.sql` présent ; `migrer_bdd.sh` documente le job cron postgres jetable (cf. mémoire « Render DB migration »).

- [ ] **Step 2 : Appliquer via le cron job postgres:18 jetable sur Render**

Suivre la procédure de la mémoire « Render DB migration » : créer un cron job jetable (image `postgres:18`) via l'API Render qui exécute le SQL de `0013_debrief_financement_acompte.sql` contre la DB de prod (port 5432 sortant bloqué en local → passer par Render). Preuve d'application = **code de sortie 0** du job.

- [ ] **Step 3 : Vérifier l'application**

Via le même mécanisme, exécuter une requête de contrôle :

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'debriefs'
  AND column_name IN ('payment_sub_method','financing_org','acompte_percent','acompte_amount');
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'financing_type' AND enumlabel = 'paiement_12x';
```

Expected : 4 colonnes listées + `paiement_12x` présent.

- [ ] **Step 4 : (Pas de commit — opération d'infra.)**

---

## Self-Review

**Spec coverage :**
- Date de signature supprimée + défaut aujourd'hui → Task 6 (Step 3 `signedAt: todayIso()`), Task 7 (champ retiré de l'UI), Task 8 (carte récap supprimée). ✓
- Kits en tags (écrire/ajouter, étiquettes wrap, ≥1 requis) → Task 5 (join/split), Task 6 (`kits: string[]`), Task 7 (UI tags), Task 8 (validation `kits.length > 0`, payload `joinKits`). ✓
- Financement 4 méthodes + sous-choix + acompte (40/30, 30/20, 30, 30) → Task 5 (`PAYMENT_METHOD_CONFIG`), Task 7 (cascade UI). ✓
- Acompte calculé affiché en TTC + montant direct → Task 5 (`computeAcompteAmount`), Task 7 (affichage + input direct), Task 8 (payload). ✓
- Continuer désactivé tant qu'incomplet → Task 8 (`isVenteDetailsComplete` / `canAdvanceStep` / `canSubmit`). ✓
- Persistance structurée (4 colonnes + enum) → Task 1, 2, 3. ✓
- Migration via cron Render → Task 10. ✓
- Affichage récap / DebriefCard → Task 8, Task 9. ✓

**Placeholder scan :** aucun TBD/TODO ; tout le code est fourni. ✓

**Type consistency :** `paymentSubMethod`/`financingOrg`/`acomptePercent`/`acompteAmount` cohérents entre DTO (Task 2), schema (Task 1), service (Task 3), `DebriefResponse` (Task 4), `FormState` (Task 6) et payload (Task 8). `joinKits`/`splitKits`/`computeAcompteAmount`/`PAYMENT_METHOD_CONFIG`/`formatEuro` définis en Task 5 et utilisés ensuite avec la même signature. `acompteAmount` est une string (`toFixed(2)`) côté payload, cohérent avec colonne `numeric` (Drizzle attend string) et Zod `regex`. ✓

**Risques connus à vérifier à l'exécution :**
- Signature réelle de `ChoiceChip` / `FieldGroup` (props) — vérifiée en Task 7 Step 3, adapter si besoin.
- `Icon name="x"` : confirmer qu'une icône croix existe dans `IconName` (sinon utiliser le nom dispo, ex. `close`/`trash`).
- `ALTER TYPE ADD VALUE` en transaction : scinder la migration si le runner Drizzle échoue.
