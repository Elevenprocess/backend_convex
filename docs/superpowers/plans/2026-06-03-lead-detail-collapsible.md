# Fiche client + devis — sections réductibles & réorganisation — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre des sections de la fiche client réductibles (état mémorisé), déplacer « Créer un projet » sous l'info client, et rendre chaque carte devis réductible.

**Architecture:** Une primitive de persistance `useCollapsibleState` (localStorage) + un composant présentationnel `CollapsibleSection`, réutilisés dans `LeadDetail.tsx` (Historique, Débriefs, Créer un projet, Projets existants) et, via le hook seul, dans `DevisCard`. Aucun changement backend ; on conserve les styles `glass-card`/`stone` existants.

**Tech Stack:** React + TypeScript, Vite, Tailwind v4, Vitest 3 + @testing-library/react (jsdom, `renderHook`).

**Spec :** `docs/superpowers/specs/2026-06-03-lead-detail-collapsible-design.md`

**Contexte WIP :** le working tree contient des fichiers non liés en cours d'édition (`src/components/suivi/DossierSidebar.tsx`, `src/index.css`, `src/pages/SuiviDetail.tsx`). NE PAS les toucher/stager/annuler. Chaque commit fait `git add` UNIQUEMENT des fichiers listés.

---

## Structure des fichiers

- **Créer** `src/lib/useCollapsibleState.ts` + `.test.ts` — hook persistant.
- **Créer** `src/components/CollapsibleSection.tsx` + `.test.tsx` — section pliable.
- **Modifier** `src/pages/leads/LeadDetail.tsx` — déplacer « Créer un projet », plier Historique/Débriefs, plier les 2 sous-sections de `CreateProjectInline`.
- **Modifier** `src/components/devis/DevisList.tsx` — barre-résumé + repli de la carte devis.
- **Modifier** `src/components/devis/DevisList.test.tsx` — tests du repli devis.

Les modifs de `LeadDetail.tsx` (réorganisation/wrapping JSX) sont vérifiées par `npm run build` (typecheck) + lint + manuel ; un test de page complète serait disproportionné. Le hook et `CollapsibleSection` sont testés unitairement.

---

## Task 1: Hook `useCollapsibleState`

**Files:**
- Create: `src/lib/useCollapsibleState.ts`
- Test: `src/lib/useCollapsibleState.test.ts`

- [ ] **Step 1: Écrire le test qui échoue**

```ts
// src/lib/useCollapsibleState.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCollapsibleState } from './useCollapsibleState'

describe('useCollapsibleState', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('renvoie defaultCollapsed quand rien en storage', () => {
    const { result: a } = renderHook(() => useCollapsibleState('k1', true))
    expect(a.current[0]).toBe(true)
    const { result: b } = renderHook(() => useCollapsibleState('k2', false))
    expect(b.current[0]).toBe(false)
  })

  it('toggle inverse et persiste en localStorage', () => {
    const { result } = renderHook(() => useCollapsibleState('k3', false))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem('ecoi.collapse.k3')).toBe('1')
    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem('ecoi.collapse.k3')).toBe('0')
  })

  it('relit une valeur existante depuis localStorage', () => {
    window.localStorage.setItem('ecoi.collapse.k4', '1')
    const { result } = renderHook(() => useCollapsibleState('k4', false))
    expect(result.current[0]).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test (échec attendu)**

Run: `cd "ECOI_frontend" && npx vitest run src/lib/useCollapsibleState.test.ts`
Expected: FAIL — `Failed to resolve import './useCollapsibleState'`.

- [ ] **Step 3: Implémenter**

```ts
// src/lib/useCollapsibleState.ts
import { useState } from 'react'

const PREFIX = 'ecoi.collapse.'

/**
 * État replié/déplié persistant dans localStorage (best-effort).
 * '1' = replié, '0' = déplié ; valeur absente/illisible → defaultCollapsed.
 */
export function useCollapsibleState(
  storageKey: string,
  defaultCollapsed: boolean,
): [boolean, () => void] {
  const fullKey = PREFIX + storageKey
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(fullKey)
      if (raw === '1') return true
      if (raw === '0') return false
    } catch {
      // localStorage indisponible (mode privé, quota) → défaut
    }
    return defaultCollapsed
  })

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(fullKey, next ? '1' : '0')
      } catch {
        // best-effort
      }
      return next
    })
  }

  return [collapsed, toggle]
}
```

- [ ] **Step 4: Lancer le test (3 verts)**

Run: `cd "ECOI_frontend" && npx vitest run src/lib/useCollapsibleState.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/useCollapsibleState.ts src/lib/useCollapsibleState.test.ts
git commit -m "feat(ui): hook useCollapsibleState (persistance localStorage)"
```

---

## Task 2: Composant `CollapsibleSection`

**Files:**
- Create: `src/components/CollapsibleSection.tsx`
- Test: `src/components/CollapsibleSection.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// src/components/CollapsibleSection.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  beforeEach(() => window.localStorage.clear())

  it('affiche le titre et le contenu quand déplié', () => {
    render(<CollapsibleSection title="Historique" storageKey="t1"><p>contenu</p></CollapsibleSection>)
    expect(screen.getByText('Historique')).toBeInTheDocument()
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('masque le contenu si replié par défaut', () => {
    render(<CollapsibleSection title="Débriefs" storageKey="t2" defaultCollapsed><p>secret</p></CollapsibleSection>)
    expect(screen.queryByText('secret')).toBeNull()
  })

  it('bascule au clic sur l’en-tête', () => {
    render(<CollapsibleSection title="Sec" storageKey="t3" defaultCollapsed><p>corps</p></CollapsibleSection>)
    const btn = screen.getByRole('button', { name: /Sec/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(screen.getByText('corps')).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('rend le slot right dans l’en-tête', () => {
    render(<CollapsibleSection title="Sec" storageKey="t4" right={<span>3 items</span>}><p>x</p></CollapsibleSection>)
    expect(screen.getByText('3 items')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer le test (échec attendu)**

Run: `cd "ECOI_frontend" && npx vitest run src/components/CollapsibleSection.test.tsx`
Expected: FAIL — import non résolu.

- [ ] **Step 3: Implémenter**

```tsx
// src/components/CollapsibleSection.tsx
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { useCollapsibleState } from '../lib/useCollapsibleState'

type CollapsibleSectionProps = {
  title: string
  storageKey: string
  defaultCollapsed?: boolean
  right?: ReactNode
  children: ReactNode
}

/**
 * Section repliable/dépliable réutilisable. Ne fournit pas le fond de carte
 * (laissé à l'appelant) ; en-tête cliquable avec chevron, état persistant.
 */
export function CollapsibleSection({
  title,
  storageKey,
  defaultCollapsed = false,
  right,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, toggle] = useCollapsibleState(storageKey, defaultCollapsed)
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-bold">
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} className="text-faint" />
          {title}
        </span>
        {right}
      </button>
      {!collapsed && <div className="mt-4">{children}</div>}
    </div>
  )
}
```

VERIFY: `Icon` accepts `name`, `size`, `className` (déjà utilisé ainsi ailleurs) et expose `'chevron-right'` / `'chevron-down'`. Si non, adapter et signaler.

- [ ] **Step 4: Lancer le test (4 verts)**

Run: `cd "ECOI_frontend" && npx vitest run src/components/CollapsibleSection.test.tsx`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/components/CollapsibleSection.tsx src/components/CollapsibleSection.test.tsx
git commit -m "feat(ui): composant CollapsibleSection (réduire/développer)"
```

---

## Task 3: `LeadDetail` — déplacer « Créer un projet » + plier Historique/Débriefs

**Files:**
- Modify: `src/pages/leads/LeadDetail.tsx`

Lire le fichier d'abord ; repérer les blocs par leur contenu (les numéros de ligne peuvent bouger).

- [ ] **Step 1: Importer CollapsibleSection**

Ajouter en haut, près des autres imports de composants :
```tsx
import { CollapsibleSection } from '../../components/CollapsibleSection'
```
(Vérifier le chemin relatif réel depuis `src/pages/leads/` vers `src/components/` = `../../components/CollapsibleSection`.)

- [ ] **Step 2: Déplacer la carte « Créer un projet » vers le bas de la colonne gauche**

Dans la colonne droite (`<div className="lg:col-span-2 space-y-4 lg:space-y-6">`), COUPER ce bloc :
```tsx
          <div className="glass-card p-6">
            <CreateProjectInline
              lead={lead}
              projects={projects}
              onCreated={(p) => { setProjects((prev) => [p, ...prev]); navigate(`/projects/${p.id}`) }}
              onOpenProject={(p) => navigate(`/projects/${p.id}`)}
            />
          </div>
```
et le COLLER comme **dernier enfant** de la colonne gauche (`<div className="lg:col-span-1 space-y-4 lg:space-y-6">`), c.-à-d. juste après le bloc conditionnel de la carte « DONNÉES FORMULAIRE / SETTER » (`{lead.customFields && lead.customFields.length > 0 && ( … )}`) et avant la fermeture `</div>` de la colonne gauche.

- [ ] **Step 3: Plier la carte Historique**

Repérer la carte Historique :
```tsx
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Historique</h3>
            {timeline.length === 0 ? (
              … 
            )}
          </div>
```
La remplacer par (le `glass-card` reste ; on enveloppe le contenu, sans le `<h3>` qui devient le titre de la section) :
```tsx
          <div className="glass-card p-6">
            <CollapsibleSection title="Historique" storageKey="lead.historique" defaultCollapsed>
              {timeline.length === 0 ? (
                <p className="text-sm text-faint">Aucun événement enregistré pour ce lead.</p>
              ) : (
                <div className="space-y-4">
                  {timeline.map((t, i) => (
                    <div key={i} className="flex gap-3">
                      <div className={`w-8 h-8 rounded-full ${t.iconBg} flex items-center justify-center shrink-0`}>
                        <Icon name={t.icon} size={14} className={t.iconColor} />
                      </div>
                      <div className="flex-grow">
                        <div className="flex justify-between gap-3">
                          <span className="font-semibold text-sm">{t.title}</span>
                          <span className="text-xs text-faint shrink-0">{t.date}</span>
                        </div>
                        {t.desc && <p className="text-xs text-muted mt-1">{t.desc}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          </div>
```

- [ ] **Step 4: Plier la carte Débriefs (compteur en `right`)**

Repérer la carte Débriefs (en-tête avec `<h3>Débriefs</h3>` + compteur, puis liste). La remplacer par :
```tsx
          <div className="glass-card p-6">
            <CollapsibleSection
              title="Débriefs"
              storageKey="lead.debriefs"
              defaultCollapsed
              right={debriefs.length > 0 ? (
                <span className="text-[10px] font-black uppercase tracking-wider text-faint">{debriefs.length} débrief{debriefs.length > 1 ? 's' : ''}</span>
              ) : undefined}
            >
              {debriefs.length === 0 ? (
                <p className="text-sm text-faint">Aucun débrief enregistré pour ce client.</p>
              ) : (
                <ul className="space-y-2">
                  {debriefs.map((d) => (
                    <DebriefRow
                      key={d.id}
                      debrief={d}
                      projectName={d.projectId ? (projects.find((p) => p.id === d.projectId)?.name ?? 'Projet') : 'Débrief libre'}
                      onDelete={() => void handleDeleteDebrief(d.id)}
                    />
                  ))}
                </ul>
              )}
            </CollapsibleSection>
          </div>
```

- [ ] **Step 5: Typecheck + lint**

Run: `cd "ECOI_frontend" && npx tsc -b && npx eslint src/pages/leads/LeadDetail.tsx`
Expected: 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add src/pages/leads/LeadDetail.tsx
git commit -m "feat(lead): déplace Créer un projet + Historique/Débriefs repliables"
```

---

## Task 4: `CreateProjectInline` — plier formulaire + projets existants

**Files:**
- Modify: `src/pages/leads/LeadDetail.tsx`

- [ ] **Step 1: Envelopper le formulaire de création**

Dans `function CreateProjectInline`, le `return ( <section className="space-y-4"> … )`. Remplacer le bloc d'en-tête :
```tsx
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Créer un projet sur ce client</h3>
        {projects.length > 0 && (
          <span className="text-[10px] font-black uppercase tracking-wider text-faint">{projects.length} projet{projects.length > 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-white/60 p-4 space-y-3">
```
par (on ouvre une `CollapsibleSection` qui contient la `<div>` du formulaire ; le compteur projets passe en `right`) :
```tsx
      <CollapsibleSection
        title="Créer un projet sur ce client"
        storageKey="lead.createProject"
        right={projects.length > 0 ? (
          <span className="text-[10px] font-black uppercase tracking-wider text-faint">{projects.length} projet{projects.length > 1 ? 's' : ''}</span>
        ) : undefined}
      >
      <div className="rounded-2xl border border-line bg-white/60 p-4 space-y-3">
```
Puis, après la `</div>` qui FERME cette `<div className="rounded-2xl …">` (juste avant le bloc `{projects.length > 0 && (`), ajouter la fermeture de la section :
```tsx
      </div>
      </CollapsibleSection>
```
(c.-à-d. la `CollapsibleSection` enveloppe uniquement la `<div>` du formulaire).

- [ ] **Step 2: Envelopper « Projets existants »**

Remplacer le bloc :
```tsx
      {projects.length > 0 && (
        <div className="space-y-2">
          <div className="eyebrow text-faint text-[10px]">Projets existants</div>
          <ul className="space-y-2">
```
par :
```tsx
      {projects.length > 0 && (
        <CollapsibleSection
          title="Projets existants"
          storageKey="lead.existingProjects"
          right={<span className="text-[10px] font-black uppercase tracking-wider text-faint">{projects.length}</span>}
        >
          <ul className="space-y-2">
```
et la fermeture correspondante : remplacer le `</div>` qui fermait `<div className="space-y-2">` (juste après la `</ul>`) par `</CollapsibleSection>`. (La structure devient `{projects.length > 0 && ( <CollapsibleSection …> <ul>…</ul> </CollapsibleSection> )}`.)

- [ ] **Step 3: Typecheck + lint**

Run: `cd "ECOI_frontend" && npx tsc -b && npx eslint src/pages/leads/LeadDetail.tsx`
Expected: 0 erreur (JSX équilibré).

- [ ] **Step 4: Commit**

```bash
git add src/pages/leads/LeadDetail.tsx
git commit -m "feat(lead): formulaire et projets existants repliables"
```

---

## Task 5: `DevisCard` — barre-résumé + repli de la carte

**Files:**
- Modify: `src/components/devis/DevisList.tsx`
- Test: `src/components/devis/DevisList.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue (étendre la suite existante)**

Ajouter dans `src/components/devis/DevisList.test.tsx`, dans le `describe('DevisList — états de scan', …)` (ou un nouveau `describe`), ce test. Le helper `devis()` existant est réutilisé en surchargeant les champs ; ajouter `beforeEach(() => window.localStorage.clear())` en tête du describe s'il n'y est pas déjà.

```tsx
  it('replie la carte devis : masque le corps, garde résumé (TTC) + footer', () => {
    window.localStorage.clear()
    render(<DevisList devisList={[devis({
      ocrStatus: 'done',
      devisNumber: 'D-123',
      montantTtc: 12000,
      extracted: { customer: { firstName: 'Jean', lastName: 'Test' } },
    } as Partial<Devis>)]} onChange={vi.fn()} />)

    // déplié par défaut : le corps (Émetteur) est visible
    expect(screen.getByText(/Émetteur/i)).toBeInTheDocument()

    // replier
    fireEvent.click(screen.getByRole('button', { name: /Réduire/i }))

    // corps masqué, résumé conservé (N° + TTC), footer présent
    expect(screen.queryByText(/Émetteur/i)).toBeNull()
    expect(screen.getByText(/D-123/)).toBeInTheDocument()
    expect(screen.getByText((t) => t.replace(/\s/g, '').includes('12000'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Voir le PDF/i })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Lancer (échec attendu)**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/DevisList.test.tsx`
Expected: FAIL — pas de bouton « Réduire », corps toujours visible.

- [ ] **Step 3: Importer Icon + le hook dans DevisList.tsx**

En haut de `src/components/devis/DevisList.tsx`, ajouter :
```tsx
import { Icon } from '../Icon';
import { useCollapsibleState } from '../../lib/useCollapsibleState';
```

- [ ] **Step 4: Ajouter l'état de repli dans DevisCard**

Dans `DevisCard`, à côté des autres `useState` (après `const [showPdf, setShowPdf] = useState(false);`), ajouter :
```tsx
  const [collapsed, toggleCollapsed] = useCollapsibleState('devis.' + d.id, false);
  const showBody = editing || !collapsed;
```

- [ ] **Step 5: Insérer la barre-résumé en tête de carte**

Dans le `return ( <li …>` final de `DevisCard` (PAS le retour anticipé du scan), juste après l'ouverture `<li className="border border-stone-300 rounded-md bg-white overflow-hidden">`, insérer en PREMIER enfant :
```tsx
      {/* ─── BARRE-RÉSUMÉ (toujours visible) ─── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200">
        {!editing && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Développer' : 'Réduire'}
            className="shrink-0 text-stone-400 hover:text-stone-700"
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} />
          </button>
        )}
        <div className="min-w-0 flex-1 flex items-baseline gap-2 flex-wrap text-xs">
          <span className="font-bold text-stone-900 truncate">
            {d.devisNumber ? `N° ${d.devisNumber}` : d.filename}
          </span>
          {fullName(customer) && <span className="text-stone-500 truncate">· {fullName(customer)}</span>}
          <span className="font-bold text-stone-900 tabular-nums">· {fmtEuro(d.montantTtc)}</span>
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded border ${STATUS_TONE[d.status]}`}>
          {STATUS_LABEL[d.status]}
        </span>
        <span className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-stone-200 bg-stone-50 text-stone-600">
          {OCR_LABEL[d.ocrStatus]}
        </span>
      </div>

```
(`customer`, `fmtEuro`, `fullName`, `STATUS_TONE`, `STATUS_LABEL`, `OCR_LABEL` sont déjà définis/importés dans le fichier.)

- [ ] **Step 6: Rendre le corps (HERO + sections) conditionnel**

Le corps actuel commence au commentaire `{/* ─── HERO : … ─── */}` suivi de `<header …>` et se termine à la fin de la section FINANCEMENT (le bloc `{(financingLabel || fin) && ( <section …> … </section> )}`), juste AVANT le bloc `{/* ─── OCR error si présente ─── */}`. Envelopper TOUT ce corps dans `{showBody && ( <> … </> )}` :
- Insérer `{showBody && (<>` juste avant le commentaire `{/* ─── HERO`.
- Insérer `</>)}` juste après la fin du bloc FINANCEMENT (avant `{/* ─── OCR error`).

Laisser INCHANGÉS : le bloc OCR error (`{d.ocrError && …}`), le bloc `{err && …}`, le `<footer …>` d'actions, et `{showPdf && <PdfPreviewModal … />}`.

- [ ] **Step 7: Lancer le test + la suite devis**

Run: `cd "ECOI_frontend" && npx vitest run src/components/devis/DevisList.test.tsx`
Expected: PASS (test de repli + existants verts).

- [ ] **Step 8: Typecheck + lint**

Run: `cd "ECOI_frontend" && npx tsc -b && npx eslint src/components/devis/DevisList.tsx`
Expected: 0 erreur.

- [ ] **Step 9: Commit**

```bash
git add src/components/devis/DevisList.tsx src/components/devis/DevisList.test.tsx
git commit -m "feat(devis): carte devis repliable (barre-résumé + corps pliable)"
```

---

## Task 6: Vérification globale

**Files:** aucun (validation).

- [ ] **Step 1: Suite complète**

Run: `cd "ECOI_frontend" && npm test`
Expected: PASS — tous verts, dont `useCollapsibleState.test.ts` (3), `CollapsibleSection.test.tsx` (4), `DevisList.test.tsx` (incl. repli).

- [ ] **Step 2: Lint des fichiers du chantier**

Run: `cd "ECOI_frontend" && npx eslint src/lib/useCollapsibleState.ts src/components/CollapsibleSection.tsx src/pages/leads/LeadDetail.tsx src/components/devis/DevisList.tsx`
Expected: 0 erreur.

- [ ] **Step 3: Build**

Run: `cd "ECOI_frontend" && npm run build`
Expected: build OK.

- [ ] **Step 4: Vérification manuelle**

Stack locale (cf. mémoire « Local stack startup »), puis :
1. Fiche client : Historique & Débriefs **repliés** par défaut, dépliables au clic ; « Créer un projet » est désormais **sous l'info client** (colonne gauche), avec formulaire et « Projets existants » repliables.
2. Recharger la page → l'état repli/déploiement est **conservé**.
3. Dans un projet, onglet Devis : replier une carte → ne restent que la **barre-résumé** (N° · client · TTC · statut) et le **footer** ; déplier → corps complet. État **persistant** au rechargement. Cliquer « Modifier » force l'ouverture.

---

## Self-Review (effectuée)

- **Couverture spec :** hook persistant (T1), CollapsibleSection (T2), déplacement « Créer un projet » + Historique/Débriefs repliés par défaut (T3), formulaire + projets existants repliables (T4), barre-résumé + repli carte devis + garde édition (T5), vérifs (T6). Toutes les sections de la spec sont couvertes.
- **Placeholders :** aucun ; code complet à chaque étape.
- **Cohérence des types/noms :** `useCollapsibleState(storageKey, defaultCollapsed) → [boolean, () => void]` (T1) consommé par `CollapsibleSection` (T2) et `DevisCard` (T5) à l'identique ; clé devis `'devis.' + d.id` ; `showBody = editing || !collapsed` ; props `CollapsibleSection { title, storageKey, defaultCollapsed?, right?, children }` utilisées de façon cohérente en T3/T4.
