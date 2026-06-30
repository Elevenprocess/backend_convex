# Fiche d'Intervention VT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a printable A4 "Fiche d'intervention VT" scaffold (route + component) accessible from the technician planning calendar, using only existing data and `window.print()`.

**Architecture:** A new page component `FicheInterventionVT` at the route `/fiche-vt/:clientId` fetches `ClientResponse` (via existing `useClients`) and the VT `SubstepResponse` (via existing `useSubsteps`). It renders an A4-formatted page; Tailwind `print:` utilities hide all app chrome when the browser's print dialog is open. A "Imprimer la fiche VT" button is added to the `TechnicienPlanning` event pop-up (the existing `EventDetailModal`/chip click handler) and also from `MesInterventions` card.

**Tech Stack:** React 18, TypeScript, Tailwind CSS (print: variants), react-router-dom `createHashRouter`, existing hooks (`useClients`, `useSubsteps`), no new dependencies.

---

## Global Constraints

- Working directory: `/workspace/Desktop/SaaS ecoi/ECOI_frontend`
- Branch: `main`; stage only explicitly named files; never `git add -A/./-u`
- No edits to `src/index.css`; use Tailwind utility classes exclusively (incl. `print:` variants)
- No new npm dependencies (no jsPDF, no react-pdf); `window.print()` only
- Validate with `npx tsc -b` (not `tsc --noEmit`, which misses some errors); backend tsc is OOM-dangerous — don't run it
- vitest may not run on Node 18 — note it but don't block on it
- The final VT fiche layout is a scaffold; add a code comment that Thierry's model will replace it
- Commit message: `feat(technicien): fiche d'intervention VT imprimable (scaffold)`
- Write full report to `/tmp/claude-0/-workspace-Desktop-SaaS-ecoi/4b7f3873-b1f1-4857-a338-abe0637760ea/scratchpad/sdd/m3-front-b5-report.md`

---

## File Structure

### Files to CREATE
- `src/pages/technicien/FicheInterventionVT.tsx` — the printable fiche page component
  - Fetches `ClientResponse` + VT `SubstepResponse` by `clientId` (URL param)
  - Renders A4 portrait layout with: client identity, address, VT date/heure, technicians, devis info (puissanceKwc, nbPanneaux, kits), blank checklist zones, notes zone, signature box
  - Contains `window.print()` trigger button (screen-only)
  - Uses `print:hidden` on the action bar; the fiche content is visible always and `print:block`

### Files to MODIFY
- `src/main.tsx` — add route `/fiche-vt/:clientId` → `FicheInterventionVT` (inside `RequireAuth`)
- `src/pages/technicien/TechnicienPlanning.tsx` — add "Imprimer la fiche VT" button inside the event detail area (the chip/entry click currently calls `navigate('/suivi/${e.clientId}')` — add a secondary print button alongside)

---

## Task 1: Create `FicheInterventionVT` page component

**Files:**
- Create: `src/pages/technicien/FicheInterventionVT.tsx`

**Interfaces:**
- Consumes: `useClients({ leadId })` → `ClientResponse[]` (first element)
- Consumes: `useSubsteps({ clientId })` → `SubstepResponse[]` (first with `phase === 'vt'`)
- Produces: exported `FicheInterventionVT` React component (default-less named export), route param `:clientId`

- [ ] **Step 1: Create the file with imports and data-fetch scaffold**

```tsx
// src/pages/technicien/FicheInterventionVT.tsx
//
// ⚠️  SCAFFOLD — disposition finale à valider avec le modèle de Thierry (réunion
// post-25/06). Ce fichier sera remplacé par la mise en page définitive une fois
// le template reçu. Les zones vides (checklist, notes, signature) sont
// intentionnellement laissées en blanc pour remplissage terrain.
//
import { useParams } from 'react-router-dom'
import { useClients, useSubsteps } from '../../lib/hooks'
import { LoadingBlock } from '../../components/Spinner'
import type { ClientResponse, SubstepResponse } from '../../lib/types'

export function FicheInterventionVT() {
  const { clientId } = useParams<{ clientId: string }>()

  // ClientResponse gives us lead name, address, techniciens, steps.vt
  const { data: clients, loading: clientLoading } = useClients(
    clientId ? { /* filter not typed for id directly — fetch all then find */ } : undefined,
  )
  // SubstepResponse gives us VT date, heure, notes, responsableId
  const { data: substeps, loading: substepsLoading } = useSubsteps(
    clientId ? { clientId } : undefined,
  )

  const client: ClientResponse | null =
    clients?.find((c) => c.id === clientId) ?? null
  const vtSubstep: SubstepResponse | null =
    substeps?.find((s) => s.phase === 'vt' && s.key === 'vt_planifie') ??
    substeps?.find((s) => s.phase === 'vt') ??
    null

  if (clientLoading || substepsLoading) {
    return <LoadingBlock label="Chargement de la fiche…" />
  }

  if (!client) {
    return (
      <div className="p-8 text-sm text-rouille">
        Dossier introuvable (clientId : {clientId ?? '—'}).
      </div>
    )
  }

  return <FicheContent client={client} vtSubstep={vtSubstep} />
}
```

- [ ] **Step 2: Implement `FicheContent` sub-component (the printable layout)**

Replace the stub above — paste this after the `FicheInterventionVT` function in the same file:

```tsx
// ─────────────────────────────────────────────────────────────────────────────
// FicheContent — rendu A4 portrait
// ─────────────────────────────────────────────────────────────────────────────
function FicheContent({
  client,
  vtSubstep,
}: {
  client: ClientResponse
  vtSubstep: SubstepResponse | null
}) {
  const handlePrint = () => window.print()

  // ── Derived data ──────────────────────────────────────────────────────────
  const clientName = client.lead.fullName ?? '—'
  const address = [client.lead.city].filter(Boolean).join(', ') || '—'
  // NOTE: full addressLine not available on ClientResponse.lead — only city.
  // The complete address lives on ProjectResponse (requires separate fetch).
  // Shown as placeholder until Thierry confirms the template.

  const vtDate = vtSubstep?.dateRealisee ?? null
  const vtHeure = vtSubstep?.heure ?? null
  const techniciens =
    client.techniciens.length > 0
      ? client.techniciens.map((t) => t.name).join(', ')
      : '—'
  // NOTE: devis fields (puissanceKwc, nbPanneaux, kits) live on DevisResponse,
  // not on ClientResponse. ProjectDetailResponse includes them but requires an
  // additional fetch (useProjectsByLead / useProjectDetail). Shown as blank
  // placeholder fields pending Thierry's template — wire up after confirmation.

  return (
    <>
      {/* ── Screen-only action bar (hidden when printing) ────────────────── */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-white border-b border-line-soft">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="text-sm text-muted hover:text-text px-2 py-1 rounded hover:bg-black/5"
        >
          ← Retour
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="ml-auto flex items-center gap-2 bg-cuivre text-white text-sm font-semibold px-4 py-2 rounded hover:opacity-90 transition-opacity"
        >
          🖨 Imprimer la fiche VT
        </button>
      </div>

      {/* ── A4 fiche (always visible on screen, rendered when printing) ──── */}
      {/*
        Strategy: on screen, centred white sheet with max-w. On print, full
        page with @page margins handled by the browser. The wrapper is always
        rendered — no print:block toggle needed. App chrome (nav/topbar) is
        hidden via print:hidden added in AppShell (see Task 2 note).
        The fiche is intentionally rendered OUTSIDE AppShell to avoid chrome.
      */}
      <main
        className={[
          // Screen: centred A4-like sheet
          'mx-auto my-6 w-full max-w-[210mm] min-h-[297mm]',
          'bg-white shadow-lg px-10 py-8',
          // Print: remove shadow/margin, fill page
          'print:shadow-none print:my-0 print:mx-0 print:max-w-none',
          'print:px-[15mm] print:py-[12mm]',
        ].join(' ')}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">
                VELORA — Fiche d'intervention
              </p>
              <h1 className="text-2xl font-black text-gray-900">
                Visite Technique (VT)
              </h1>
            </div>
            <div className="text-right text-xs text-gray-500">
              <p>Date d'impression&nbsp;: {new Date().toLocaleDateString('fr-FR')}</p>
              <p className="mt-0.5 italic text-[10px] text-gray-400">
                Référence dossier : {client.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </div>
        </header>

        {/* ── Section : Informations client ────────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>1. Client &amp; Adresse d'installation</SectionTitle>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-3">
            <Field label="Nom du client" value={clientName} />
            <Field label="Téléphone" value={client.lead.phone ?? '—'} />
            <Field
              label="Adresse (ville)"
              value={address}
              note="Adresse complète : voir projet / devis"
            />
            <Field
              label="Adresse complète"
              value=""
              placeholder
              note="[À compléter sur site ou depuis la fiche projet]"
            />
          </div>
        </section>

        {/* ── Section : Planification VT ───────────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>2. Planification de la VT</SectionTitle>
          <div className="grid grid-cols-3 gap-x-8 gap-y-3 mt-3">
            <Field
              label="Date prévue"
              value={vtDate ? new Date(vtDate).toLocaleDateString('fr-FR') : ''}
              placeholder={!vtDate}
            />
            <Field
              label="Heure"
              value={vtHeure ?? ''}
              placeholder={!vtHeure}
            />
            <Field label="Technicien(s)" value={techniciens} />
          </div>
        </section>

        {/* ── Section : Informations installation (devis) ──────────────── */}
        <section className="mb-6">
          <SectionTitle>3. Caractéristiques de l'installation</SectionTitle>
          {/* NOTE: puissanceKwc, nbPanneaux, kits proviennent de DevisResponse
              (non disponible sur ClientResponse). Champs volontairement vides
              en attente du template Thierry + fetch projet. */}
          <div className="grid grid-cols-3 gap-x-8 gap-y-3 mt-3">
            <Field label="Puissance (kWc)" value="" placeholder note="Depuis devis — à câbler" />
            <Field label="Nb panneaux" value="" placeholder note="Depuis devis — à câbler" />
            <Field label="Kit / Onduleur" value="" placeholder note="Depuis devis — à câbler" />
          </div>
        </section>

        {/* ── Section : Observations terrain ──────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>4. Observations &amp; Relevés terrain</SectionTitle>
          <BlankZone lines={6} label="Zone de saisie libre — observations du technicien" />
        </section>

        {/* ── Section : Checklist VT ───────────────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>5. Checklist VT (à cocher sur site)</SectionTitle>
          {/* ⚠️ Liste générique — à remplacer par le modèle de Thierry */}
          <ul className="mt-3 space-y-2">
            {CHECKLIST_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 inline-block w-4 h-4 border-2 border-gray-700 rounded-sm shrink-0" aria-hidden />
                <span className="text-sm text-gray-800">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Section : Signature client ───────────────────────────────── */}
        <section className="mt-auto">
          <SectionTitle>6. Signature &amp; Validation</SectionTitle>
          <div className="grid grid-cols-2 gap-8 mt-4">
            <SignatureBox label="Signature du client" />
            <SignatureBox label="Signature du technicien" />
          </div>
          <p className="mt-4 text-[10px] text-gray-400 text-center italic">
            En signant, le client confirme la visite technique réalisée à la date indiquée.
          </p>
        </section>
      </main>
    </>
  )
}

// ── Checklist générique — sera remplacée par le template Thierry ──────────────
const CHECKLIST_ITEMS = [
  'Accès toiture vérifié et sécurisé',
  'Type de couverture identifié (tuiles / ardoise / bac acier / autre)',
  'Surface disponible mesurée',
  'Orientation et inclinaison relevées',
  'Ombrage potentiel évalué (cheminée, arbres, voisinage)',
  'Tableau électrique inspecté (capacité disjoncteur, mise à la terre)',
  'Emplacement onduleur défini',
  'Photos prises (toiture, tableau, compteur)',
  'Accord client pour les travaux confirmé verbalement',
]

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-500 border-b border-gray-200 pb-1">
      {children}
    </h2>
  )
}

function Field({
  label,
  value,
  placeholder,
  note,
}: {
  label: string
  value: string
  placeholder?: boolean
  note?: string
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
      <p
        className={`text-sm font-semibold min-h-[22px] border-b border-gray-300 pb-0.5 ${
          placeholder || !value ? 'text-gray-300 italic' : 'text-gray-900'
        }`}
      >
        {value || (note ?? '—')}
      </p>
    </div>
  )
}

function BlankZone({ lines, label }: { lines: number; label: string }) {
  return (
    <div
      className="mt-2 border border-gray-300 rounded"
      style={{ minHeight: `${lines * 1.6}rem` }}
      aria-label={label}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="border-b border-gray-100 mx-3" style={{ height: '1.6rem' }} />
      ))}
    </div>
  )
}

function SignatureBox({ label }: { label: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      <div className="border border-gray-300 rounded h-20" aria-label={label} />
      <p className="text-[10px] text-gray-400 mt-1">Nom &amp; Prénom : ___________________________</p>
      <p className="text-[10px] text-gray-400">Date : ___________________________</p>
    </div>
  )
}
```

- [ ] **Step 3: Check TypeScript compiles (run from frontend root)**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx tsc -b 2>&1 | head -40
```

Expected: 0 errors. If there are type errors in `useClients` filter (the `clientId` filter path), fix the filter arg — `useClients` accepts `{ leadId?: string; technicienVtId?: string; ... }` not `{ id: string }`. The component will fetch all and `.find(c => c.id === clientId)` client-side (acceptable for tech scope, usually < 20 dossiers).

Fix if needed — the filter arg to `useClients` should be `{}` or omitted (no id filter on client):

```tsx
// Correct — no id filter; find client-side
const { data: clients, loading: clientLoading } = useClients(clientId ? {} : undefined)
```

And for substeps — verify `useSubsteps` accepts `{ clientId: string }`:
```bash
grep -n "useSubsteps\|SubstepFilter" "/workspace/Desktop/SaaS ecoi/ECOI_frontend/src/lib/hooks.ts" | head -10
```

---

## Task 2: Register route in `main.tsx`

**Files:**
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `FicheInterventionVT` from `./pages/technicien/FicheInterventionVT`
- Produces: route `/fiche-vt/:clientId` accessible to all authenticated users (tech + admin)

- [ ] **Step 1: Add import to `main.tsx`**

In `src/main.tsx`, after the existing technicien imports (around line 37), add:

```tsx
import { FicheInterventionVT } from './pages/technicien/FicheInterventionVT'
```

- [ ] **Step 2: Add route inside `RequireAuth` children array**

In `src/main.tsx`, after the `/mes-interventions` route (around line 99), add:

```tsx
{ path: '/fiche-vt/:clientId', element: <FicheInterventionVT /> },
```

- [ ] **Step 3: Verify tsc -b still passes**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx tsc -b 2>&1 | head -20
```

Expected: 0 errors.

---

## Task 3: Add "Imprimer la fiche VT" button in `TechnicienPlanning`

**Files:**
- Modify: `src/pages/technicien/TechnicienPlanning.tsx`

**Interfaces:**
- Consumes: `useNavigate` (already imported)
- Consumes: `VtCalendarEntry.clientId` (already available)
- Produces: a print button that navigates to `/fiche-vt/${e.clientId}` (new tab or same page)

**Context:** Currently, clicking an event in `TechnicienPlanning` calls `openEntry(e)` → `navigate('/suivi/${e.clientId}')`. We need to add a separate print-fiche action. The cleanest approach without a full new modal: modify the event chip/card to show a contextual mini-menu or a secondary button. Since events are small chips, the least-invasive approach is to modify the `openEntry` function to navigate to the dossier (as before) AND add a secondary icon button `🖨` directly on the event card that navigates to `/fiche-vt/:clientId` in a new tab.

- [ ] **Step 1: Locate the event chip components in TechnicienPlanning**

The `AllDayChip` component (line ~579) and the timed event `<button>` (line ~475) both call `onOpen(e)`. The `onOpen` prop eventually calls `openEntry(e)` → `navigate('/suivi/${e.clientId}')`.

For VT events only (`e.kind === 'vt'`), add a small print icon button. Find where `AllDayChip` is rendered and add a print icon:

```tsx
// Locate AllDayChip in TechnicienPlanning.tsx (~line 579)
// Before: single button
// After: wrapper div with two buttons (main chip + print icon)
function AllDayChip({ e, onOpen }: { e: VtCalendarEntry; onOpen: (e: VtCalendarEntry) => void }) {
  const isVt = e.kind === 'vt'
  return (
    <div className="flex items-center gap-0.5 w-full">
      <button
        onClick={() => onOpen(e)}
        className={`flex-1 text-left rounded px-1.5 py-0.5 text-[10px] font-semibold truncate leading-tight ${
          isVt
            ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
        }`}
        title={`${isVt ? 'VT' : 'Installation'} — ${e.projectName ?? e.leadName} (toute la journée)`}
      >
        {e.projectName?.trim() || e.leadName}
      </button>
      {isVt && (
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation()
            window.open(`#/fiche-vt/${e.clientId}`, '_blank')
          }}
          title="Imprimer la fiche VT"
          className="shrink-0 text-sky-500 hover:text-sky-700 px-0.5 text-[10px] leading-none"
          aria-label="Imprimer la fiche VT"
        >
          🖨
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add print button to timed event cards as well**

Find the timed event rendering block (around line 475 — it's a `<button>` inside a positioned div in `DayView`/`WeekView`). Wrap it similarly:

```tsx
// Around the timed event block — locate the button that calls onOpen(e)
// and the outer div. Add a print button overlay for VT events.
// The timed event block renders something like:
//   <div key={...} style={{ ... }} className="absolute ...">
//     <button onClick={() => onOpen(e)} ...>
//       <TechChip ... />
//       <span>...</span>
//     </button>
//   </div>
//
// Change to: add a small print button inside the outer div (top-right corner)
// only when e.kind === 'vt':
//
//   {e.kind === 'vt' && (
//     <button
//       type="button"
//       onClick={(ev) => { ev.stopPropagation(); window.open(`#/fiche-vt/${e.clientId}`, '_blank') }}
//       title="Imprimer la fiche VT"
//       className="absolute top-0 right-0 text-[9px] text-sky-500 hover:text-sky-700 p-0.5 leading-none"
//       aria-label="Imprimer la fiche VT"
//     >
//       🖨
//     </button>
//   )}
```

Read the exact block first before editing:

```bash
sed -n '460,510p' "/workspace/Desktop/SaaS ecoi/ECOI_frontend/src/pages/technicien/TechnicienPlanning.tsx"
```

Then apply minimal surgical edit (add the print button inside the absolute-positioned event div for VT events).

- [ ] **Step 3: Verify tsc -b**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx tsc -b 2>&1 | head -20
```

Expected: 0 errors.

---

## Task 4: Print isolation via Tailwind `print:` utilities

**Files:**
- No new files. The isolation strategy relies on `FicheInterventionVT` being rendered WITHOUT `AppShell`/`Topbar` (it already doesn't use them — it renders its own layout). This means when the user navigates to `/fiche-vt/:clientId`, the app chrome from `AppShell` is not rendered.

**Approach chosen:** The fiche opens in a new browser tab (`window.open('#/fiche-vt/...', '_blank')`), which means the hash-router renders only this route's component tree. `RootLayout` and `RequireAuth` are wrappers, but they don't inject visible chrome — the sidebar/topbar comes from `AppShell` which is used per-page. Since `FicheInterventionVT` does NOT use `AppShell`, the new tab's page is already isolated: only the fiche content renders.

When the user clicks "Imprimer la fiche VT" button, `window.print()` is called and only the fiche content is on the page.

- [ ] **Step 1: Verify `RootLayout` does not inject persistent chrome**

```bash
head -40 "/workspace/Desktop/SaaS ecoi/ECOI_frontend/src/RootLayout.tsx"
```

If `RootLayout` injects a sidebar/nav, add `print:hidden` there OR wrap the fiche in a fragment that doesn't include the layout. If `RootLayout` is just an `<Outlet />` wrapper, no action needed.

- [ ] **Step 2: Add `@page` CSS for true A4 output**

In `FicheInterventionVT.tsx`, inject a `<style>` tag into `<head>` via a small helper (no new deps needed — just a JSX `<style>` block inside the component). Do NOT edit `index.css`.

Add at the top of `FicheContent` return, before the action bar div:

```tsx
<style>{`
  @media print {
    @page {
      size: A4 portrait;
      margin: 12mm 15mm;
    }
  }
`}</style>
```

This is valid JSX (React renders `<style>` tags as-is). No `dangerouslySetInnerHTML` needed — plain children string works in a `<style>` tag.

- [ ] **Step 3: Verify visual on screen and tsc -b**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx tsc -b 2>&1 | head -20
```

Expected: 0 errors.

---

## Task 5: Final validation, git status, and commit

**Files:**
- Stage: `src/pages/technicien/FicheInterventionVT.tsx`
- Stage: `src/main.tsx`
- Stage: `src/pages/technicien/TechnicienPlanning.tsx`

- [ ] **Step 1: Check git status for WIP files (shared repo)**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && git status
```

Note any files NOT belonging to this task that are staged or modified — do NOT include them.

- [ ] **Step 2: Run tsc -b final check**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx tsc -b 2>&1
```

Expected: empty output (0 errors). If errors, fix them before staging.

- [ ] **Step 3: Stage only task files**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && git add src/pages/technicien/FicheInterventionVT.tsx src/main.tsx src/pages/technicien/TechnicienPlanning.tsx
```

- [ ] **Step 4: Verify staged diff (sanity check)**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && git diff --staged --stat
```

Expected: 3 files changed.

- [ ] **Step 5: Commit**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && git commit -m "$(cat <<'EOF'
feat(technicien): fiche d'intervention VT imprimable (scaffold)

Adds printable A4 VT intervention sheet at /fiche-vt/:clientId.
Wires client name, city, VT date/heure, and technicians from existing
ClientResponse + SubstepResponse. Devis fields (puissanceKwc, nbPanneaux,
kits) left as placeholders — DevisResponse fetch to be added once Thierry
confirms the final template layout.

Print button (🖨) added to TechnicienPlanning VT event chips (opens fiche
in new tab). FicheInterventionVT renders without AppShell, so window.print()
isolates only the A4 fiche. @page CSS sets A4 portrait margins.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Final git status**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && git status && git log --oneline -3
```

---

## Task 6: Write report file

**Files:**
- Create: `/tmp/claude-0/-workspace-Desktop-SaaS-ecoi/4b7f3873-b1f1-4857-a338-abe0637760ea/scratchpad/sdd/m3-front-b5-report.md`

- [ ] **Step 1: Write the report**

Include:
- Where the print button lives (AllDayChip in TechnicienPlanning + top of FicheInterventionVT page)
- What data is wired vs placeholder
- Print isolation approach (no AppShell in FicheInterventionVT, opens new tab, @page CSS)
- Exact final `git status` output
- tsc -b result
- Commit SHA

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Printable A4 fiche component/page | Task 1 |
| Client name, address, VT date+heure, techniciens | Task 1 Step 2 |
| Devis info (puissanceKwc, nbPanneaux, kit) | Task 1 Step 2 (placeholder — noted) |
| Blank zones for notes/observations | Task 1 Step 2 (BlankZone) |
| Generic checklist checkboxes | Task 1 Step 2 (CHECKLIST_ITEMS) |
| Client signature box | Task 1 Step 2 (SignatureBox) |
| "Imprimer la fiche VT" button | Task 3 |
| Button triggers window.print() | Task 1 Step 2 (handlePrint), Task 4 |
| print: Tailwind utilities / only fiche shows | Task 4 |
| No new npm dependency (no jsPDF) | Global constraint — checked |
| A4 portrait clean layout | Task 1 Step 2 + Task 4 Step 2 |
| Scaffold comment for Thierry | Task 1 Step 1 comment |
| npx tsc -b validation | Task 5 Step 2 |
| Stage only own files | Task 5 Step 3 |
| Report to scratchpad md | Task 6 |

**Placeholder scan:** DevisResponse fields are explicitly flagged in comments in Task 1 Step 2. Full addressLine (only city is on `ClientResponse.lead`) flagged. No silent placeholders.

**Type consistency:** `FicheInterventionVT` → `FicheContent` (Props: `client: ClientResponse`, `vtSubstep: SubstepResponse | null`). `AllDayChip` and timed event edit in Task 3 use existing `VtCalendarEntry` type unchanged.
