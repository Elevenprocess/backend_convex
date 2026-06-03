# Devis — progression de scan OCR + aperçu PDF — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pendant le scan OCR d'un devis, afficher un état de chargement propre avec un pourcentage simulé ; une fois le scan fini, permettre d'ouvrir le PDF d'origine dans une modale.

**Architecture:** Tout en frontend, autour du composant partagé `DevisCard` (`src/components/devis/DevisList.tsx`). Une fonction pure de progression simulée pilote un anneau SVG dans un nouveau `DevisScanLoader` ; un nouveau `PdfPreviewModal` affiche le PDF via un *object URL* récupéré sur la route blob existante `/devis/:id/pdf`. Aucun changement backend ni de schéma.

**Tech Stack:** React + TypeScript, Vite, Tailwind (tokens `or`/`stone`, sans dégradé), Vitest 3 + @testing-library/react.

**Spec :** `docs/superpowers/specs/2026-06-03-devis-scan-progress-pdf-preview-design.md`

---

## Structure des fichiers

- **Créer** `src/components/devis/scanProgress.ts` — fonction pure `simulatedProgress(elapsedMs)` + constantes.
- **Créer** `src/components/devis/scanProgress.test.ts` — tests unitaires de la fonction pure.
- **Créer** `src/components/devis/DevisScanLoader.tsx` — état « scan en cours » (anneau + %).
- **Créer** `src/components/devis/DevisScanLoader.test.tsx` — test de rendu.
- **Créer** `src/components/devis/PdfPreviewModal.tsx` — modale d'aperçu PDF.
- **Créer** `src/components/devis/PdfPreviewModal.test.tsx` — test de rendu/fermeture.
- **Modifier** `src/lib/api.ts` — ajouter `fetchDevisPdfObjectUrl(devisId)`.
- **Modifier** `src/components/devis/DevisList.tsx` — brancher loader + bouton « Voir le PDF » + modale.
- **Modifier** `src/components/devis/DevisList.test.tsx` *(créer si absent)* — test d'intégration des branches d'état.

---

## Task 1: Fonction pure de progression simulée

**Files:**
- Create: `src/components/devis/scanProgress.ts`
- Test: `src/components/devis/scanProgress.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/components/devis/scanProgress.test.ts
import { describe, it, expect } from 'vitest'
import { simulatedProgress, PROGRESS_CEIL } from './scanProgress'

describe('simulatedProgress', () => {
  it('vaut 0 à t=0 et pour un temps négatif', () => {
    expect(simulatedProgress(0)).toBe(0)
    expect(simulatedProgress(-500)).toBe(0)
  })

  it('est croissante avec le temps écoulé', () => {
    expect(simulatedProgress(1000)).toBeLessThan(simulatedProgress(5000))
  })

  it('ne dépasse jamais le plafond et finit par l’atteindre', () => {
    expect(simulatedProgress(1_000_000)).toBe(PROGRESS_CEIL)
    expect(simulatedProgress(8000)).toBeLessThanOrEqual(PROGRESS_CEIL)
  })

  it('renvoie un entier', () => {
    expect(Number.isInteger(simulatedProgress(3000))).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/scanProgress.test.ts`
Expected: FAIL — `Failed to resolve import './scanProgress'` / `simulatedProgress is not a function`.

- [ ] **Step 3: Écrire l'implémentation minimale**

```ts
// src/components/devis/scanProgress.ts
// Progression de scan OCR SIMULÉE : l'OCR backend est un appel Gemini unique sans
// signal de progression granulaire, donc on simule une courbe d'ease-out côté client.
export const PROGRESS_CEIL = 92 // %, plafond tant que l'OCR n'est pas terminé
export const PROGRESS_TAU = 6000 // ms, constante de temps (montée rapide puis ralentit)

/** Progression lissée dans [0, PROGRESS_CEIL] pour un temps écoulé (ms). */
export function simulatedProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  const raw = PROGRESS_CEIL * (1 - Math.exp(-elapsedMs / PROGRESS_TAU))
  return Math.min(PROGRESS_CEIL, Math.round(raw))
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/scanProgress.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/devis/scanProgress.ts src/components/devis/scanProgress.test.ts
git commit -m "feat(devis): fonction pure de progression de scan OCR simulée"
```

---

## Task 2: API — récupérer le PDF en object URL

**Files:**
- Modify: `src/lib/api.ts` (ajout après `downloadDevisPdf`, ~ligne 273)
- Test: `src/lib/api-devis-pdf.test.ts` (créer)

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/lib/api-devis-pdf.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, fetchDevisPdfObjectUrl } from './api'

describe('fetchDevisPdfObjectUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url') })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renvoie un object URL quand la requête réussit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    })))
    const url = await fetchDevisPdfObjectUrl('dev-1')
    expect(url).toBe('blob:mock-url')
  })

  it('lève une ApiError si la requête échoue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'introuvable',
    })))
    await expect(fetchDevisPdfObjectUrl('dev-1')).rejects.toBeInstanceOf(ApiError)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/lib/api-devis-pdf.test.ts`
Expected: FAIL — `fetchDevisPdfObjectUrl is not exported` / `is not a function`.

- [ ] **Step 3: Écrire l'implémentation minimale**

Ajouter dans `src/lib/api.ts` juste après la fonction `downloadDevisPdf` (après la ligne 273, avant le commentaire `// ─── Projects ───`) :

```ts
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
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd "ECOI_frontend" && npx vitest run src/lib/api-devis-pdf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/lib/api-devis-pdf.test.ts
git commit -m "feat(api): fetchDevisPdfObjectUrl pour aperçu PDF en modale"
```

---

## Task 3: Composant `DevisScanLoader`

**Files:**
- Create: `src/components/devis/DevisScanLoader.tsx`
- Test: `src/components/devis/DevisScanLoader.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// src/components/devis/DevisScanLoader.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DevisScanLoader } from './DevisScanLoader'

describe('DevisScanLoader', () => {
  it('affiche le libellé de scan et un pourcentage', () => {
    render(<DevisScanLoader ocrStatus="processing" />)
    expect(screen.getByText(/Analyse du devis en cours/i)).toBeTruthy()
    expect(screen.getByText(/%$/)).toBeTruthy()
  })

  it('ne montre pas le nom de fichier brut', () => {
    render(<DevisScanLoader ocrStatus="pending" />)
    expect(screen.queryByText(/\.pdf/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/DevisScanLoader.test.tsx`
Expected: FAIL — `Failed to resolve import './DevisScanLoader'`.

- [ ] **Step 3: Écrire l'implémentation minimale**

```tsx
// src/components/devis/DevisScanLoader.tsx
import { useEffect, useRef, useState } from 'react'
import type { OcrStatus } from '../../lib/types'
import { simulatedProgress } from './scanProgress'

const TICK_MS = 250

/**
 * État « scan OCR en cours » affiché à la place du corps de carte tant que l'OCR
 * n'est pas terminé. Anneau de progression SVG avec un pourcentage SIMULÉ
 * (cf. scanProgress.ts). Style « air », tokens or/stone, sans dégradé.
 */
export function DevisScanLoader({ ocrStatus }: { ocrStatus: OcrStatus }) {
  const [pct, setPct] = useState(0)
  const startRef = useRef<number>(Date.now())

  useEffect(() => {
    if (ocrStatus !== 'pending' && ocrStatus !== 'processing') {
      setPct(100)
      return
    }
    startRef.current = Date.now()
    const id = setInterval(() => {
      setPct(simulatedProgress(Date.now() - startRef.current))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [ocrStatus])

  const R = 28
  const C = 2 * Math.PI * R
  const offset = C - (pct / 100) * C

  return (
    <div className="px-6 py-10 flex flex-col items-center justify-center gap-4 text-center">
      <div className="relative" style={{ width: 72, height: 72 }}>
        <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
          <circle cx="36" cy="36" r={R} fill="none" className="stroke-stone-200" strokeWidth="6" />
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            className="stroke-or transition-[stroke-dashoffset] duration-200 ease-out"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-stone-900 tabular-nums">
          {pct}%
        </div>
      </div>
      <div className="text-sm font-bold text-stone-900">Analyse du devis en cours…</div>
      <div className="text-[12px] text-stone-500">L'IA extrait les informations du PDF.</div>
    </div>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/DevisScanLoader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/devis/DevisScanLoader.tsx src/components/devis/DevisScanLoader.test.tsx
git commit -m "feat(devis): DevisScanLoader (anneau de progression de scan)"
```

---

## Task 4: Composant `PdfPreviewModal`

**Files:**
- Create: `src/components/devis/PdfPreviewModal.tsx`
- Test: `src/components/devis/PdfPreviewModal.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// src/components/devis/PdfPreviewModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PdfPreviewModal } from './PdfPreviewModal'

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  fetchDevisPdfObjectUrl: vi.fn(async () => 'blob:mock-url'),
}))

describe('PdfPreviewModal', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: vi.fn() })
  })

  it('charge puis affiche le PDF dans une iframe', async () => {
    render(<PdfPreviewModal devisId="dev-1" filename="devis.pdf" onClose={vi.fn()} />)
    const iframe = await waitFor(() => screen.getByTitle(/Aperçu du devis/i))
    expect(iframe.getAttribute('src')).toBe('blob:mock-url')
  })

  it('appelle onClose sur la touche Échap', async () => {
    const onClose = vi.fn()
    render(<PdfPreviewModal devisId="dev-1" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/PdfPreviewModal.test.tsx`
Expected: FAIL — `Failed to resolve import './PdfPreviewModal'`.

- [ ] **Step 3: Écrire l'implémentation minimale**

```tsx
// src/components/devis/PdfPreviewModal.tsx
import { useEffect, useState } from 'react'
import { ApiError, fetchDevisPdfObjectUrl } from '../../lib/api'

type Props = {
  devisId: string
  filename?: string | null
  onClose: () => void
}

/** Modale plein écran affichant le PDF d'origine du devis dans une iframe. */
export function PdfPreviewModal({ devisId, filename, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Récupère le blob PDF → object URL, révoqué au démontage.
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    fetchDevisPdfObjectUrl(devisId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Chargement du PDF échoué.')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [devisId])

  // Fermeture au clavier (Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-900/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-stone-200">
          <span className="text-sm font-bold text-stone-900 truncate">{filename ?? 'Devis'}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="px-2 py-1 text-stone-500 hover:text-stone-900"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 bg-stone-100">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-red-700">{error}</div>
          ) : url ? (
            <iframe title="Aperçu du devis" src={url} className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-stone-500">
              Chargement du PDF…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/PdfPreviewModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/devis/PdfPreviewModal.tsx src/components/devis/PdfPreviewModal.test.tsx
git commit -m "feat(devis): PdfPreviewModal (aperçu PDF en modale)"
```

---

## Task 5: Brancher loader + bouton PDF dans `DevisCard`

**Files:**
- Modify: `src/components/devis/DevisList.tsx`
- Test: `src/components/devis/DevisList.test.tsx` (créer)

- [ ] **Step 1: Écrire le test d'intégration qui échoue**

```tsx
// src/components/devis/DevisList.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DevisList } from './DevisList'
import type { Devis } from '../../lib/types'

vi.mock('../../lib/api', () => ({
  getDevis: vi.fn(),
  markDevisSigned: vi.fn(),
  retryDevisOcr: vi.fn(),
  updateDevis: vi.fn(),
  ApiError: class ApiError extends Error {},
  fetchDevisPdfObjectUrl: vi.fn(async () => 'blob:mock-url'),
}))

function devis(over: Partial<Devis>): Devis {
  return {
    id: 'dev-1',
    leadId: 'lead-1',
    filename: '1717000000-charabia.pdf',
    status: 'en_attente',
    ocrStatus: 'processing',
    ocrError: null,
    devisNumber: null,
    devisDate: null,
    ...over,
  } as Devis
}

describe('DevisList — états de scan', () => {
  it('affiche le loader pendant le scan, pas la carte vide', () => {
    render(<DevisList devisList={[devis({ ocrStatus: 'processing' })]} onChange={vi.fn()} />)
    expect(screen.getByText(/Analyse du devis en cours/i)).toBeTruthy()
    expect(screen.queryByText(/Émetteur/i)).toBeNull()
    expect(screen.queryByText(/charabia\.pdf/i)).toBeNull()
  })

  it('affiche le bouton « Voir le PDF » quand l’OCR est terminé et ouvre la modale', async () => {
    render(<DevisList devisList={[devis({ ocrStatus: 'done' })]} onChange={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /Voir le PDF/i })
    fireEvent.click(btn)
    const iframe = await waitFor(() => screen.getByTitle(/Aperçu du devis/i))
    expect(iframe.getAttribute('src')).toBe('blob:mock-url')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/DevisList.test.tsx`
Expected: FAIL — le loader n'existe pas encore dans la carte / pas de bouton « Voir le PDF ».

- [ ] **Step 3: Ajouter les imports en tête de `DevisList.tsx`**

Après la ligne 12 (fin du bloc `import type { ... } from '../../lib/types'`), ajouter :

```tsx
import { DevisScanLoader } from './DevisScanLoader';
import { PdfPreviewModal } from './PdfPreviewModal';
```

- [ ] **Step 4: Ajouter l'état `showPdf` dans `DevisCard`**

Dans `DevisCard`, à côté des autres `useState` (après la ligne `const [err, setErr] = useState<string | null>(null);`, ligne 248), ajouter :

```tsx
  const [showPdf, setShowPdf] = useState(false);
```

- [ ] **Step 5: Court-circuiter le rendu pendant le scan**

Juste avant le `return (` final de `DevisCard` (ligne 308, `return (` qui ouvre le `<li>`), insérer le bloc suivant. Tous les hooks sont déclarés au-dessus, donc ce retour anticipé respecte les règles des hooks :

```tsx
  if (d.ocrStatus === 'pending' || d.ocrStatus === 'processing') {
    return (
      <li className="border border-stone-300 rounded-md bg-white overflow-hidden">
        <DevisScanLoader ocrStatus={d.ocrStatus} />
      </li>
    );
  }

```

- [ ] **Step 6: Ajouter le bouton « Voir le PDF » dans le footer**

Dans le bloc `else` du footer (rendu quand `!editing`), juste après l'ouverture `<>` (ligne 601, avant le bloc `{d.ocrStatus === 'failed' && (`), insérer :

```tsx
            <button
              type="button"
              onClick={() => setShowPdf(true)}
              className="px-3 py-1.5 text-xs border border-stone-300 text-stone-700 rounded"
            >
              Voir le PDF
            </button>
```

- [ ] **Step 7: Monter la modale en fin de carte**

Juste avant la balise fermante `</li>` finale de `DevisCard` (ligne 634), insérer :

```tsx
      {showPdf && (
        <PdfPreviewModal
          devisId={d.id}
          filename={d.filename}
          onClose={() => setShowPdf(false)}
        />
      )}
```

- [ ] **Step 8: Lancer le test d'intégration**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/DevisList.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/components/devis/DevisList.tsx src/components/devis/DevisList.test.tsx
git commit -m "feat(devis): loader de scan + bouton Voir le PDF dans DevisCard"
```

---

## Task 6: Vérification globale (lint, types, suite de tests, app réelle)

**Files:** aucun (validation).

- [ ] **Step 1: Suite de tests complète**

Run: `cd "ECOI_frontend" && npm test`
Expected: PASS — tous les fichiers verts, dont les 4 nouveaux.

- [ ] **Step 2: Lint**

Run: `cd "ECOI_frontend" && npm run lint`
Expected: aucun nouveau warning/erreur sur les fichiers créés/modifiés.

- [ ] **Step 3: Typecheck + build**

Run: `cd "ECOI_frontend" && npm run build`
Expected: build OK (`tsc -b` sans erreur).

- [ ] **Step 4: Vérification manuelle dans l'app**

Démarrer la stack locale (cf. mémoire « Local stack startup » : Postgres cluster système 17/main + backend + frontend), puis :
1. Ouvrir un projet, onglet Devis, déposer un PDF.
2. Vérifier que pendant le scan on voit l'anneau monter en % + « Analyse du devis en cours… » (et **pas** la carte vide avec le nom de fichier brut).
3. Vérifier qu'une fois l'OCR terminé la carte complète s'affiche avec le bouton « Voir le PDF ».
4. Cliquer « Voir le PDF » → la modale ouvre le PDF (vérifier en dev, storage local, que le PDF s'affiche bien — route blob, pas `file://`). Fermer via ✕, fond, Échap.

- [ ] **Step 5: Commit éventuel des correctifs de vérif**

Si des correctifs ont été nécessaires :

```bash
git add -A
git commit -m "fix(devis): correctifs vérif scan OCR / aperçu PDF"
```

---

## Self-Review (effectuée)

- **Couverture spec :** loader + % simulé (T1, T3), modale PDF via blob (T2, T4), branche pending/processing + bouton + states (T5), styles air/sans dégradé (T3), vérif dev file:// (T6) — toutes les sections de la spec sont couvertes.
- **Placeholders :** aucun ; chaque step contient le code/commande réels.
- **Cohérence des types/noms :** `simulatedProgress`/`PROGRESS_CEIL` (T1) réutilisés en T3 ; `fetchDevisPdfObjectUrl` (T2) consommé en T4 et mocké en T4/T5 ; props `DevisScanLoader({ ocrStatus })` et `PdfPreviewModal({ devisId, filename, onClose })` cohérentes entre définition et usage en T5.
