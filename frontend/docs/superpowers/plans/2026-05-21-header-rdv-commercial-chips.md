# Header RDV/Commercial Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two conditional chips (RDV date and assigned commercial name) next to the status badge in the SplitPanel header, so setters and admins see at a glance when a lead's RDV is and who's handling it.

**Architecture:** Frontend-only, single file change in `src/components/SplitPanel.tsx`. Adds a local `formatRdvDateTime` helper (Indian/Reunion timezone), resolves the commercial via the existing `userMap` prop, and renders two conditional `<span>` chips inside the existing `flex-wrap` row that holds the status badge.

**Tech Stack:** React 19 + Vite + TypeScript. Build verification via `npm run build`. No test framework — manual UI verification via dev server.

**Spec reference:** [`docs/superpowers/specs/2026-05-21-header-rdv-commercial-chips-design.md`](../specs/2026-05-21-header-rdv-commercial-chips-design.md)

---

## Pre-flight

### Task 0: Baseline build check

**Files:** none

- [ ] **Step 1: Verify clean build before changes**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds. If it fails, STOP and report — failure is pre-existing, we need a green baseline.

- [ ] **Step 2: Capture base SHA**

Run:
```bash
cd /root/ECOI_frontend && git rev-parse HEAD
```

Note the SHA for later code review scoping.

---

## Task 1: Add `formatRdvDateTime` helper

**Files:**
- Modify: `src/components/SplitPanel.tsx` — append helper near other utility functions (around line 1529 where `statusToSetterStatus` lives)

The spec uses `Indian/Reunion` timezone explicitly because the SaaS is used exclusively in La Réunion. The existing code already uses this timezone elsewhere (e.g., `SplitPanel.tsx:734` passes `timezone: 'Indian/Reunion'` to `useGhlFreeSlots`).

- [ ] **Step 1: Locate the existing utility helpers section**

Run:
```bash
cd /root/ECOI_frontend && grep -n "^function statusToSetterStatus\|^function rdvAtToReunionIso\|^function todayInputValue" src/components/SplitPanel.tsx
```

Expected: shows line numbers of existing top-level helper functions. The new helper should be added near them (typically near the end of the file).

- [ ] **Step 2: Add `formatRdvDateTime` helper**

Append this function inside `src/components/SplitPanel.tsx`, immediately before the `statusToSetterStatus` function declaration (around line 1529):

```ts
function formatRdvDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Reunion',
  })
}
```

**Naming rationale:** `formatRdvDateTime` (not `formatDateTime`) avoids future collisions if the 3 dup'd `formatDateTime` helpers (in `LeadDetail.tsx`, `AdminPipeline.tsx`, `Deliverability.tsx`) get deduplicated into a shared module.

- [ ] **Step 3: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds. (The helper is unused so far — TypeScript may emit a warning depending on lint config, but `tsc -b` does not error on unused functions.)

- [ ] **Step 4: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): add formatRdvDateTime helper (Indian/Reunion timezone)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Resolve commercial name in the SplitPanel component

**Files:**
- Modify: `src/components/SplitPanel.tsx` — add a derived `commercialName` constant inside the main `SplitPanel` component body, just before the `return` statement of the header render

The `userMap: Map<string, UserResponse>` is already a prop passed by `PersistentLeadSidebar.tsx:65`. The commercial may be:
- null → no commercial assigned → no chip
- present in userMap → use `user.name`
- present in `lead.latestRdvCommercialId` but absent from userMap (e.g., deleted user) → no chip (graceful degradation)

- [ ] **Step 1: Find the right component and the right insertion point**

Run:
```bash
cd /root/ECOI_frontend && grep -n "^export function SplitPanel\|^function SplitPanel\|^  return (" src/components/SplitPanel.tsx | head -10
```

The `SplitPanel` main component is the one with the header at lines 92-116. The `return (` we care about is the one that immediately precedes the `<aside>` root element (the header lives inside it).

Run this to pinpoint:
```bash
cd /root/ECOI_frontend && grep -n "<aside className=\`w-\[420px\] border-l" src/components/SplitPanel.tsx
```

Expected: returns line 93. The `return (` is right above it (line 92).

- [ ] **Step 2: Add `commercialName` derivation just before `return (`**

Locate the `return (` at line 92 of `src/components/SplitPanel.tsx`. Insert this line IMMEDIATELY ABOVE it (keep the existing blank line / indentation pattern of surrounding code):

```ts
  const commercialName = lead.latestRdvCommercialId
    ? userMap.get(lead.latestRdvCommercialId)?.name ?? null
    : null
```

**Verify `userMap` is typed as `Map<string, UserResponse>` already**, by running:

```bash
cd /root/ECOI_frontend && grep -n "userMap" src/components/SplitPanel.tsx | head -10
```

Expected: at least one match showing `userMap: Map<string, UserResponse>` or similar in the component's props destructuring. If `userMap` is typed differently (e.g., `Map<string, string>`), report as BLOCKED — the spec assumes `UserResponse.name` exists. Do NOT silently adapt.

- [ ] **Step 3: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds. If TypeScript complains that `userMap` doesn't have a `.name` field on its values, see Step 2 verification — it's a real issue, report as BLOCKED.

- [ ] **Step 4: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): resolve commercial name via userMap before header render

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Render the two conditional chips in the header

**Files:**
- Modify: `src/components/SplitPanel.tsx:100-102` — extend the flex-wrap row that currently holds only the status badge

- [ ] **Step 1: Locate the current header chips row**

Run:
```bash
cd /root/ECOI_frontend && grep -n 'className="mt-1 flex items-center gap-2 flex-wrap"' src/components/SplitPanel.tsx
```

Expected: returns line 100.

- [ ] **Step 2: Replace the block with the extended version**

Locate `src/components/SplitPanel.tsx:100-102`. The current block is:

```tsx
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
          </div>
```

Replace it with:

```tsx
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
            {lead.latestRdvAt && (
              <span className="status-badge bg-cream-darker text-text flex items-center gap-1">
                <Icon name="calendar" size={11} />
                {formatRdvDateTime(lead.latestRdvAt)}
              </span>
            )}
            {commercialName && (
              <span className="status-badge bg-cream-darker text-text flex items-center gap-1">
                <Icon name="users" size={11} />
                {commercialName}
              </span>
            )}
          </div>
```

- [ ] **Step 3: Verify `Icon` and `STATUS_BADGE`/`STATUS_LABEL` are already imported**

Run:
```bash
cd /root/ECOI_frontend && grep -n "^import.*Icon\|^import.*STATUS_BADGE\|^import.*STATUS_LABEL" src/components/SplitPanel.tsx
```

Expected: existing imports already include `Icon`, `STATUS_BADGE`, `STATUS_LABEL`. They're used elsewhere in the file (verified at line 101 and 113 of the original code). Do NOT add new imports.

- [ ] **Step 4: Verify `calendar` and `users` icon names exist**

Run:
```bash
cd /root/ECOI_frontend && grep -E "'calendar'|'users'" src/components/Icon.tsx | head -5
```

Expected: both `'calendar'` (line 11) and `'users'` (line 10) appear in the `IconName` union. If either is missing, report as BLOCKED.

- [ ] **Step 5: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/SplitPanel.tsx && git commit -m "$(cat <<'EOF'
feat(splitpanel): show RDV date + commercial chips in header

Two conditional chips next to the status badge — one for latestRdvAt
(calendar icon, Indian/Reunion timezone) and one for the assigned
commercial name (users icon). Both render only when data is present.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual verification in dev server

**Files:** none (manual UI testing)

- [ ] **Step 1: Start dev server**

Run:
```bash
cd /root/ECOI_frontend && npm run dev
```

Expected: Vite dev server starts (typically at `http://localhost:5173`).

- [ ] **Step 2: Open a lead WITH a RDV in BDD (status `qualifie` / `rdv_pris` / `rdv_honore` / `signe`)**

Pick any qualified lead from the Leads list. Open its detail (the SplitPanel opens on the right).

Expected:
- Header shows: avatar, name, phone, then a row with `[Qualifié]`/`[RDV honoré]`/etc + `[📅 JJ/MM HH:MM]` + `[👤 Commercial name]`.
- Date format is e.g. `28/05 14h00` (using `h` as separator in French locale).
- Timezone reflects Reunion time (test by checking a known RDV's expected time on the agenda).

- [ ] **Step 3: Open a lead WITH a RDV but NO commercial assigned**

Find a lead where `latestRdvCommercialId` is null but `latestRdvAt` exists (rare — typically GHL appointments come with a commercial, but local RDVs created via `createRdv` may not).

Expected: only the date chip appears, no commercial chip.

- [ ] **Step 4: Open a lead with NO RDV (status `nouveau`)**

Expected: header looks exactly like before — only `[Nouveau]` badge, no extra chips.

- [ ] **Step 5: Open a "déjà qualifié par spécialiste" lead (from the previous feature)**

Pick a lead that was marked `qualifie` via the `qualifie_specialiste` button (no GHL RDV created, no `latestRdvAt`, no `latestRdvCommercialId`).

Expected: only `[Qualifié]` badge, no date chip, no commercial chip. This visually confirms there's no RDV in the SaaS BDD.

- [ ] **Step 6: Test wrap behavior**

Find or create a lead whose assigned commercial has a long name (>15 chars). Check that the chips wrap to a new line gracefully (no horizontal overflow).

Expected: `flex-wrap` makes the third chip drop to a new line if needed.

- [ ] **Step 7: Stop dev server**

Ctrl+C in the terminal.

---

## Task 5: Final build + commit cleanup

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
cd /root/ECOI_frontend && git log --oneline -6
```

Expected: 3 new feat commits on top of the previous HEAD (`3607765` docs commit). If the count is wrong, investigate before pushing.

- [ ] **Step 3: Report to user**

Surface:
- ✅ 3 chip-related commits applied
- ✅ Build green
- ✅ Manual verification complete (or list any step that didn't pass)
- 💡 Next step suggestion: push to `Elevenprocess/ECOI_frontend` so Render auto-deploys.

---

## Out of Scope (reminder)

- ❌ No refactor of the 3 duplicate `formatDateTime` helpers in other files.
- ❌ No modification of `CommercialLeadTrackingSidebar.tsx`.
- ❌ No tooltip, no long date format, no click action on the chips.
- ❌ No styling for cancelled / no-show RDV status.
- ❌ No automated tests (no test framework installed).
