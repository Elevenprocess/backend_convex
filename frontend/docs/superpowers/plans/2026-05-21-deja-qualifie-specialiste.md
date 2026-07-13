# Bouton "Déjà qualifié par un spécialiste" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th setter status button "Déjà qualifié par spécialiste" in `SplitPanel.tsx` that marks the lead as `qualifie` in the SaaS DB without any GHL appointment creation or local RDV.

**Architecture:** Frontend-only change in a single file (`src/components/SplitPanel.tsx`). Extends the existing `SetterStatus` union and reuses the `non_qualifie` UI pattern (commentaire textarea + Valider). No backend changes, no new API call, no type/schema changes elsewhere.

**Tech Stack:** React 19 + Vite + TypeScript. Build verification via `npm run build` (full `tsc -b` + vite). No test framework installed — verification is manual via dev server (`npm run dev`).

**Scope reference:** [`docs/superpowers/specs/2026-05-21-deja-qualifie-specialiste-design.md`](../specs/2026-05-21-deja-qualifie-specialiste-design.md)

---

## Pre-flight

The repo has no test framework. The validated workflow per memory ([saas-ecoi-build-verification.md](../../../../.claude/projects/-root/memory/saas-ecoi-build-verification.md)): always run `npm run build` (not just `tsc --noEmit`) before push because `tsc -b` is stricter. Manual UI verification via dev server.

### Task 0: Baseline build check

**Files:** none

- [ ] **Step 1: Verify clean build before changes**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds. If it fails, the failure is pre-existing — STOP and report to user before touching code. We need a green baseline so any later breakage clearly comes from this work.

---

## Task 1: Extend `SetterStatus` union

**Files:**
- Modify: `src/components/SplitPanel.tsx` line 693

- [ ] **Step 1: Add new variant to the union type**

Locate at `src/components/SplitPanel.tsx:693`:

```ts
  type SetterStatus = '' | 'non_qualifie' | 'a_rappeler' | 'pas_de_reponse' | 'qualifie'
```

Replace with:

```ts
  type SetterStatus = '' | 'non_qualifie' | 'a_rappeler' | 'pas_de_reponse' | 'qualifie' | 'qualifie_specialiste'
```

- [ ] **Step 2: Run build to confirm union extension does not break existing switch/conditions**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds. (No exhaustive switch on `SetterStatus` exists today, so no `never` error.)

- [ ] **Step 3: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): extend SetterStatus with qualifie_specialiste

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the 4th `<StatusChoice>` button

**Files:**
- Modify: `src/components/SplitPanel.tsx` lines 965-969 (the `<div className="grid grid-cols-1 gap-2">` block)

The existing block (`src/components/SplitPanel.tsx:965-969`) currently contains 3 choices:

```tsx
            <div className="grid grid-cols-1 gap-2">
              <StatusChoice active={setterStatus === 'a_rappeler'} icon="clock" title="À rappeler" text="Date et heure du rappel" onClick={() => { setSetterStatus('a_rappeler'); setResult('rappel_planifie') }} />
              <StatusChoice active={setterStatus === 'pas_de_reponse'} icon="phone-off" title="Pas de réponse" text="Aucun champ requis" onClick={() => { setSetterStatus('pas_de_reponse'); setResult('non_joint') }} />
              <StatusChoice active={setterStatus === 'non_qualifie'} icon="x" title="Pas qualifié" text="Commentaire obligatoire" onClick={() => { setSetterStatus('non_qualifie'); setResult('refus') }} />
            </div>
```

- [ ] **Step 1: Insert the new `<StatusChoice>` after `non_qualifie`**

Note: `IconName` (defined in `src/components/Icon.tsx:8-48`) does NOT include `check-circle`. The regular "Qualifié" button at line 1084 already uses `check`. To keep visual distinction, we use **`target`** (already in IconName), which conveys "already targeted/handled".

Replace the block above with:

```tsx
            <div className="grid grid-cols-1 gap-2">
              <StatusChoice active={setterStatus === 'a_rappeler'} icon="clock" title="À rappeler" text="Date et heure du rappel" onClick={() => { setSetterStatus('a_rappeler'); setResult('rappel_planifie') }} />
              <StatusChoice active={setterStatus === 'pas_de_reponse'} icon="phone-off" title="Pas de réponse" text="Aucun champ requis" onClick={() => { setSetterStatus('pas_de_reponse'); setResult('non_joint') }} />
              <StatusChoice active={setterStatus === 'non_qualifie'} icon="x" title="Pas qualifié" text="Commentaire obligatoire" onClick={() => { setSetterStatus('non_qualifie'); setResult('refus') }} />
              <StatusChoice active={setterStatus === 'qualifie_specialiste'} icon="target" title="Déjà qualifié par spécialiste" text="Commentaire obligatoire — pas d'envoi GHL" onClick={() => { setSetterStatus('qualifie_specialiste'); setResult('joint') }} />
            </div>
```

- [ ] **Step 2: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): add StatusChoice for "déjà qualifié par spécialiste"

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Render the commentaire textarea when the new button is active

**Files:**
- Modify: `src/components/SplitPanel.tsx` lines 984-992 (existing `non_qualifie` textarea block)

- [ ] **Step 1: Insert the new commentaire block after the `non_qualifie` textarea**

Locate the `non_qualifie` textarea (`src/components/SplitPanel.tsx:984-992`):

```tsx
            {setterStatus === 'non_qualifie' && (
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Commentaire obligatoire : pourquoi pas qualifié ?"
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
                autoFocus={isActiveCall}
              />
            )}
```

Add IMMEDIATELY after it (before the `Enregistrer le statut` button block at line 993):

```tsx
            {setterStatus === 'qualifie_specialiste' && (
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Le lead dit avoir déjà eu un RDV avec un spécialiste. Précise lequel / quand si possible."
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
                autoFocus={isActiveCall}
              />
            )}
```

- [ ] **Step 2: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): render commentaire textarea for qualifie_specialiste

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Include the new status in the "Enregistrer" button condition

**Files:**
- Modify: `src/components/SplitPanel.tsx` line 993

- [ ] **Step 1: Extend the condition**

Locate `src/components/SplitPanel.tsx:993`:

```tsx
            {(setterStatus === 'a_rappeler' || setterStatus === 'pas_de_reponse' || setterStatus === 'non_qualifie') && (
              <button
                type="button"
                onClick={() => saveCallAndLead(setterStatus)}
                disabled={saving}
                className="btn-primary w-full rounded-xl py-2 text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size={16} stroke={2} /> : null}
                Enregistrer le statut
              </button>
            )}
```

Replace the opening line:

```tsx
            {(setterStatus === 'a_rappeler' || setterStatus === 'pas_de_reponse' || setterStatus === 'non_qualifie') && (
```

With:

```tsx
            {(setterStatus === 'a_rappeler' || setterStatus === 'pas_de_reponse' || setterStatus === 'non_qualifie' || setterStatus === 'qualifie_specialiste') && (
```

- [ ] **Step 2: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): show Enregistrer button for qualifie_specialiste status

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement the `qualifie_specialiste` branch in `saveCallAndLead`

**Files:**
- Modify: `src/components/SplitPanel.tsx` lines 822-855 (the `saveCallAndLead` function)

This task wires up the actual side effects: call log + status update, **NO** GHL appointment, **NO** local RDV.

- [ ] **Step 1: Add the new branch in `saveCallAndLead`**

Locate `src/components/SplitPanel.tsx:822-848` — the existing function:

```ts
  async function saveCallAndLead(kind: Exclude<SetterStatus, ''>) {
    setError(null)
    setSaving(true)
    try {
      if (kind === 'non_qualifie') {
        if (!commentaire.trim()) throw new Error('Ajoute un commentaire pour expliquer pourquoi le lead est non qualifié.')
        await createCallLog({ leadId: lead.id, result: 'refus', notes: noteFinale })
        setResult('')
        setSuccess('Lead marqué non qualifié.')
        setStep('done')
      } else if (kind === 'pas_de_reponse') {
        await createCallLog({ leadId: lead.id, result: 'non_joint', notes: noteFinale || null })
        setResult('')
        setSuccess('Lead marqué en pas de réponse.')
        setStep('done')
      } else if (kind === 'a_rappeler') {
        if (!callbackAt) throw new Error('Choisis la date et l’heure du rappel.')
        await createCallLog({ leadId: lead.id, result: 'rappel_planifie', nextCallbackAt: new Date(callbackAt).toISOString(), notes: noteFinale || null })
        setResult('')
        setSuccess('Rappel planifié et lead passé en À rappeler.')
        setStep('done')
      } else {
```

Insert a new `else if (kind === 'qualifie_specialiste')` branch BETWEEN the existing `a_rappeler` branch and the final `else`.

Replace `else if (kind === 'a_rappeler') { ... }` block (lines 837-842) and the line immediately after (`} else {` on line 843) with:

```ts
      } else if (kind === 'a_rappeler') {
        if (!callbackAt) throw new Error('Choisis la date et l’heure du rappel.')
        await createCallLog({ leadId: lead.id, result: 'rappel_planifie', nextCallbackAt: new Date(callbackAt).toISOString(), notes: noteFinale || null })
        setResult('')
        setSuccess('Rappel planifié et lead passé en À rappeler.')
        setStep('done')
      } else if (kind === 'qualifie_specialiste') {
        if (!commentaire.trim()) throw new Error('Ajoute un commentaire expliquant que le lead a déjà été qualifié par un spécialiste.')
        await createCallLog({ leadId: lead.id, result: 'joint', notes: noteFinale })
        await updateLead(lead.id, { status: 'qualifie' })
        setResult('')
        setSuccess('Lead marqué qualifié (RDV déjà géré par un spécialiste sur GHL).')
        setStep('done')
      } else {
```

**Note on `noteFinale`:** the existing branches (`non_qualifie`, `pas_de_reponse`, `a_rappeler`) already pass `noteFinale` (or `noteFinale || null`) to `createCallLog`. We follow the same convention — `noteFinale` is the derived value that already incorporates `commentaire` (verify in step 2 below).

- [ ] **Step 2: Verify `noteFinale` carries the commentaire**

Run:
```bash
cd /root/ECOI_frontend && grep -n "noteFinale" src/components/SplitPanel.tsx | head -10
```

Expected output should show `noteFinale` being computed from `commentaire` (or similar). If `noteFinale` does NOT include `commentaire`, change the line `await createCallLog({ leadId: lead.id, result: 'joint', notes: noteFinale })` to `await createCallLog({ leadId: lead.id, result: 'joint', notes: commentaire })` instead.

(This is the only step in this plan that requires inline judgment — the spec mandates the commentaire ends up in the call log notes; the variable name is just plumbing.)

- [ ] **Step 3: Confirm `updateLead` is already imported**

Run:
```bash
cd /root/ECOI_frontend && grep -n "updateLead" src/components/SplitPanel.tsx | head -5
```

Expected: at least one import or usage already present (line ~913 uses `updateLead(lead.id, leadPatch)` in `validateRdv`). If not, add `updateLead` to the imports from `../lib/api` (or wherever the other API helpers come from — match the existing import for `createCallLog`).

- [ ] **Step 4: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds. If it fails on `kind === 'qualifie_specialiste'` not narrowing correctly, double-check Task 1 was committed.

- [ ] **Step 5: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): wire saveCallAndLead branch for qualifie_specialiste

Marks lead status=qualifie + creates call log result=joint without
touching GHL (no createGhlAppointment, no createRdv).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Manual verification in dev server

**Files:** none (manual UI testing)

- [ ] **Step 1: Start dev server**

Run:
```bash
cd /root/ECOI_frontend && npm run dev
```

Expected: Vite dev server starts (typically at `http://localhost:5173`). Keep it running for the next steps.

- [ ] **Step 2: Open a lead with status `nouveau` or `a_rappeler`**

In the browser, navigate to Leads, open any lead that's NOT yet `qualifie`/`signe`, and open its detail panel (SplitPanel).

Expected: the call form shows 4 buttons in the first row:
```
[À rappeler] [Pas de réponse] [Pas qualifié] [Déjà qualifié par spécialiste]
```

- [ ] **Step 3: Click "Déjà qualifié par spécialiste" without commentaire and try to validate**

Expected: an error banner appears: "Ajoute un commentaire expliquant que le lead a déjà été qualifié par un spécialiste."

- [ ] **Step 4: Add a commentaire and validate**

Type e.g. "Lead dit avoir eu RDV avec Stéphane le 15 mai", click "Enregistrer le statut".

Expected:
- Success banner: "Lead marqué qualifié (RDV déjà géré par un spécialiste sur GHL)."
- The status badge at the top of the panel updates to "Qualifié".
- In the lead's call log history, a new entry appears with `result: joint` and the commentaire in notes.
- **No** new RDV appears in the agenda (open the Agenda tab to confirm).
- **No** GHL appointment is created (check network tab: there should be NO request to a GHL appointment endpoint — only `createCallLog` and `updateLead`).

- [ ] **Step 5: Verify network requests via DevTools Network panel**

Filter requests on the validation click. Expected requests:
- 1× POST to the call-log endpoint (whatever path `createCallLog` hits)
- 1× PATCH/PUT to the lead update endpoint (whatever path `updateLead` hits)
- **0× requests to any GHL endpoint** (no path containing `ghl`, `appointment`, `calendar/slots`, etc.)

If a GHL request appears, the implementation is wrong — revisit Task 5.

- [ ] **Step 6: Stop dev server**

In the terminal where dev is running, Ctrl+C.

---

## Task 7: Final build + commit cleanup

**Files:** none

- [ ] **Step 1: Final clean build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: success.

- [ ] **Step 2: Inspect commit history**

Run:
```bash
cd /root/ECOI_frontend && git log --oneline -8
```

Expected: 5 new feat commits on top of `b3630e6` (the baseline). If commits look duplicated or out of order, that's fine — no need to rebase.

- [ ] **Step 3: Report to user**

The plan is done. Surface to the user:
- ✅ 4th button visible and functional
- ✅ Build green
- ✅ Manual verification done (or list any verification step that didn't pass)
- 💡 Next step suggestion: push to `Elevenprocess/ECOI_frontend` so Mario can pull on Render preview.

---

## Out of Scope (reminder)

- ❌ No new `LeadStatus` value in `src/lib/types.ts` — reuses `'qualifie'`.
- ❌ No backend changes in `ECOI_backend`.
- ❌ No new filter in `LeadsList` / `LeadsSplit`.
- ❌ No new badge/label distinguishing these leads in the list — they appear as regular "Qualifié".
- ❌ No automated tests (repo has no test framework — verification is manual via dev server).
