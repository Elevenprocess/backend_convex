# Commercial Debrief Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre `CommercialDebriefSidebar.tsx` d'un formulaire single-page scrollable en wizard step-by-step (3 à 5 steps selon branche), avec logique conditionnelle plus stricte (objection non surmontée seulement si `suivi_prevu`) et contenu allégé (sous-cas chips + commentaire libre par raison supprimés). Zéro impact backend.

**Architecture:** Refactor sur 1 fichier (`src/components/leads/CommercialDebriefSidebar.tsx`, ~760 lignes). Approche incrémentale : ajout du state machine wizard + helpers en premier (mort), extraction des sections en sub-components inline, puis swap du render single-page → wizard, puis animation/cascade/polish. Backward-compat assurée par parsing legacy de `[Précision: ...]` au read. Payload `updateRdv` inchangé. Pas de migration DB.

**Tech Stack:** React 19 + Vite + TypeScript 6. Build verification via `npm run build` (= `tsc -b && vite build`). Pas de test framework — smoke check via dev server (`npm run dev`) avec curl/browser. Convention repo (feedback memory) : **toujours `npm run build` avant push** (tsc -b plus strict que tsc --noEmit seul).

**Spec reference:** [`docs/superpowers/specs/2026-05-26-commercial-debrief-wizard-design.md`](../specs/2026-05-26-commercial-debrief-wizard-design.md)

---

## Pre-flight

### Task 0: Baseline build check

**Files:** none

- [ ] **Step 1: Vérifier le build propre avant changements**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected: build réussit. Si échec, STOP et reporter — l'échec est pré-existant, il faut une baseline verte.

- [ ] **Step 2: Capturer le SHA de base**

Run:
```bash
cd /root/ECOI_frontend && git rev-parse HEAD
```

Noter le SHA pour le scoping du code review.

- [ ] **Step 3: Vérifier qu'on est sur `main` à jour**

Run:
```bash
cd /root/ECOI_frontend && git status --short && git branch --show-current
```

Expected : `main`, et soit working tree clean soit changements WIP de Mario (Sidebar.tsx, main.tsx, Delivrabilite.tsx). Si on est sur une autre branche, **STOP** et demander confirmation.

---

## Task 1: Ajouter les types et helpers wizard (code mort, build OK)

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — ajouter en dessous des types existants (autour de la ligne 60, avant `DEBRIEF_STATUS_META`)

Cette task ajoute uniquement des **types et helpers non utilisés**. Le rendu actuel reste identique. Objectif : valider que les types compilent en isolation avant d'attaquer le rendu.

- [ ] **Step 1: Localiser le bon emplacement d'insertion**

Run:
```bash
cd /root/ECOI_frontend && grep -n "^type DebriefStatus\|^const DEBRIEF_STATUS_META" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : `type DebriefStatus` à la ligne 60 environ, `const DEBRIEF_STATUS_META` à la ligne 62 environ. On insère **avant** `type DebriefStatus`.

- [ ] **Step 2: Ajouter les types wizard**

Insérer dans `src/components/leads/CommercialDebriefSidebar.tsx`, immédiatement avant `type DebriefStatus`, ce bloc :

```ts
// ─── Wizard state machine ───────────────────────────────────────────
type WizardStepId =
  | 'result'        // Step 1 (toutes branches)
  | 'objection_v'   // Step 2V — objection surmontée (Vente)
  | 'acceptance_v'  // Step 3V — facteurs d'acceptation (Vente)
  | 'details_v'     // Step 4V — devis/date/kits/paiement (Vente)
  | 'reason_nv'     // Step 2NV — raison non-vente (Non-vente)
  | 'objection_nv'  // Step 3NV-A — objection non surmontée (Non-vente / Suivi prévu uniquement)
  | 'notes'         // Step final (toutes branches)

```

- [ ] **Step 3: Ajouter `getStepSequence(form)` helper**

Insérer ensuite, juste après le bloc précédent :

```ts
function getStepSequence(form: FormState): WizardStepId[] {
  if (form.outcome === '') return ['result']
  if (form.outcome === 'vente') {
    return ['result', 'objection_v', 'acceptance_v', 'details_v', 'notes']
  }
  // Non-vente
  if (form.nonSaleReason === '') return ['result', 'reason_nv']
  if (form.nonSaleReason === 'suivi_prevu') {
    return ['result', 'reason_nv', 'objection_nv', 'notes']
  }
  // Non qualifié, no_show, contact_annule, annulation_administrative, pas_interesse
  return ['result', 'reason_nv', 'notes']
}

```

- [ ] **Step 4: Ajouter `canAdvanceStep(stepId, form)` validation helper**

Toujours dans le même bloc, juste après `getStepSequence` :

```ts
function canAdvanceStep(stepId: WizardStepId, form: FormState): boolean {
  switch (stepId) {
    case 'result': return form.outcome !== ''
    case 'objection_v': return true // optionnel
    case 'acceptance_v': return true // optionnel
    case 'details_v':
      return form.quoteAmount.trim() !== ''
        && form.signedAt !== ''
        && form.kits.trim() !== ''
        && form.paymentMethod !== ''
    case 'reason_nv': return form.nonSaleReason !== ''
    case 'objection_nv': return true // optionnel
    case 'notes': return true // step final, le bouton submit fait sa propre validation
  }
}
```

- [ ] **Step 5: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit. TypeScript peut warn que les nouveaux helpers sont unused — c'est attendu, on les câble à la Task 4. Si erreur de compilation, **STOP** et reporter.

- [ ] **Step 6: Commit**

Run:
```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
refactor(debrief): types et helpers wizard (code mort, build OK)

Ajoute WizardStepId, getStepSequence, canAdvanceStep. Pas encore câblés
au rendu — préparation pour la Task suivante.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Ajouter state currentStep + navigation handlers (toujours mort)

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — dans le composant `CommercialDebriefSidebar`, après les `useState` existants (autour ligne 187-190)

- [ ] **Step 1: Localiser le bloc des useState**

Run:
```bash
cd /root/ECOI_frontend && grep -n "const \[form, setForm\]\|const \[saving, setSaving\]\|const \[error, setError\]\|const \[savedAt, setSavedAt\]" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : 4 lignes ~188-191 dans le composant.

- [ ] **Step 2: Ajouter `currentStep` state**

Insérer dans `src/components/leads/CommercialDebriefSidebar.tsx`, immédiatement après `const [savedAt, setSavedAt] = useState<string | null>(null)` (ligne 191 actuelle) :

```ts
  const [currentStep, setCurrentStep] = useState<number>(0)
```

- [ ] **Step 3: Ajouter `stepSequence` derived + handlers `goNext`/`goBack`**

Juste après le `update` function (`const update = (patch: Partial<FormState>) => ...`, ligne 203 environ), ajouter :

```ts
  const stepSequence = useMemo(() => getStepSequence(form), [form.outcome, form.nonSaleReason])
  const currentStepId = stepSequence[Math.min(currentStep, stepSequence.length - 1)]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep >= stepSequence.length - 1

  function goNext() {
    if (!canAdvanceStep(currentStepId, form)) return
    if (isLastStep) return
    setCurrentStep((s) => s + 1)
  }

  function goBack() {
    if (isFirstStep) return
    setCurrentStep((s) => Math.max(0, s - 1))
  }
```

- [ ] **Step 4: Reset `currentStep` à 0 quand le RDV sélectionné change**

Dans le `useEffect` qui reset le form quand `selectedRdv?.id` change (autour ligne 197-201), ajouter le reset de currentStep :

Le bloc actuel :
```ts
  useEffect(() => {
    setError(null)
    setSavedAt(null)
    setForm(selectedRdv ? rdvToForm(selectedRdv) : EMPTY_FORM)
  }, [selectedRdv?.id])
```

Devient :
```ts
  useEffect(() => {
    setError(null)
    setSavedAt(null)
    setForm(selectedRdv ? rdvToForm(selectedRdv) : EMPTY_FORM)
    setCurrentStep(0)
  }, [selectedRdv?.id])
```

- [ ] **Step 5: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit. `currentStep`, `stepSequence`, `currentStepId`, `isFirstStep`, `isLastStep`, `goNext`, `goBack` sont déclarés mais pas encore utilisés (warnings TS unused possibles).

- [ ] **Step 6: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
refactor(debrief): state currentStep + handlers goNext/goBack

Câble le state machine wizard côté composant. Pas encore utilisé dans
le rendu (Task suivante).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extraire les sections existantes en sub-components

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — extraire 6 fonctions sub-component

Objectif : isoler chaque section dans un composant pur, prêt à être rendu par index dans la Task suivante. Le rendu actuel single-page reste fonctionnellement identique.

- [ ] **Step 1: Localiser la fin du composant principal**

Run:
```bash
cd /root/ECOI_frontend && grep -n "^function EmptyDebrief\|^function RdvSelector\|^function FieldGroup" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : ces fonctions existent autour de ligne 481, 493, 527. C'est là qu'on va ajouter les nouveaux sub-components, juste **avant `EmptyDebrief`**.

- [ ] **Step 2: Ajouter les 6 sub-components avant `EmptyDebrief`**

Insérer dans `src/components/leads/CommercialDebriefSidebar.tsx`, immédiatement avant `function EmptyDebrief()` :

```tsx
// ─── Wizard step components ─────────────────────────────────────────

type StepProps = {
  form: FormState
  update: (patch: Partial<FormState>) => void
}

function Step1Result({ form, update }: StepProps) {
  return (
    <FieldGroup label="Résultat de l'appel" required>
      <div className="grid grid-cols-2 gap-2">
        <ChoicePill active={form.outcome === 'vente'} icon="check" label="Vente réalisée" tone="success" onClick={() => update({ outcome: 'vente' })} />
        <ChoicePill active={form.outcome === 'non_vente'} icon="x" label="Vente non réalisée" tone="rouille" onClick={() => update({ outcome: 'non_vente' })} />
      </div>
    </FieldGroup>
  )
}

function Step2VObjection({ form, update }: StepProps) {
  return (
    <FieldGroup label="Quelle objection avez-vous surmontée ?">
      <div className="grid grid-cols-2 gap-1.5">
        {OBJECTIONS.map((o) => (
          <ChoiceChip
            key={o.value}
            active={form.objection === o.value}
            label={o.label}
            sublabel={o.hint}
            onClick={() => update({ objection: form.objection === o.value ? '' : o.value })}
          />
        ))}
      </div>
    </FieldGroup>
  )
}

type Step3VProps = StepProps & {
  toggleAcceptance: (factor: AcceptanceFactor) => void
}

function Step3VAcceptance({ form, toggleAcceptance }: Step3VProps) {
  return (
    <FieldGroup label="Facteurs d'acceptation">
      <div className="grid grid-cols-2 gap-1.5">
        {ACCEPTANCE_FACTORS.map((f) => (
          <ChoiceChip
            key={f.value}
            active={form.acceptanceFactors.includes(f.value)}
            label={f.label}
            onClick={() => toggleAcceptance(f.value)}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-faint">Sélection multiple — pourquoi le prospect a dit oui.</p>
    </FieldGroup>
  )
}

function Step4VDetails({ form, update }: StepProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldGroup label="Valeur du devis signé (€)" required>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.quoteAmount}
            onChange={(e) => update({ quoteAmount: e.target.value })}
            placeholder="0,00"
            className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm font-bold text-text outline-none focus:border-or"
          />
        </FieldGroup>
        <FieldGroup label="Date signature devis" required>
          <input
            type="date"
            value={form.signedAt}
            onChange={(e) => update({ signedAt: e.target.value })}
            className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm font-bold text-text outline-none focus:border-or"
          />
        </FieldGroup>
      </div>

      <FieldGroup label="Kits vendus" required>
        <input
          type="text"
          value={form.kits}
          onChange={(e) => update({ kits: e.target.value })}
          placeholder="Ex. : 8 PV + 1 onduleur + 1 batterie 5 kWh"
          className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm text-text outline-none focus:border-or"
        />
      </FieldGroup>

      <FieldGroup label="Type de paiement" required>
        <div className="grid grid-cols-2 gap-1.5">
          {PAYMENT_METHODS.map((p) => (
            <ChoiceChip key={p.value} active={form.paymentMethod === p.value} label={p.label} onClick={() => update({ paymentMethod: p.value })} />
          ))}
        </div>
      </FieldGroup>
    </div>
  )
}

function Step2NVReason({ form, update }: StepProps) {
  return (
    <FieldGroup label="Raison de la non-vente" required>
      <div className="grid grid-cols-2 gap-1.5">
        {NON_SALE_REASONS.map((r) => (
          <ChoiceChip
            key={r.value}
            active={form.nonSaleReason === r.value}
            label={r.label}
            sublabel={r.hint}
            onClick={() => update({ nonSaleReason: r.value })}
          />
        ))}
      </div>
    </FieldGroup>
  )
}

function Step3NVObjection({ form, update }: StepProps) {
  return (
    <FieldGroup label="Quelle objection n'avez-vous pas pu surmonter ?">
      <div className="grid grid-cols-2 gap-1.5">
        {OBJECTIONS.map((o) => (
          <ChoiceChip
            key={o.value}
            active={form.objection === o.value}
            label={o.label}
            sublabel={o.hint}
            onClick={() => update({ objection: form.objection === o.value ? '' : o.value })}
          />
        ))}
      </div>
    </FieldGroup>
  )
}

function StepFinalNotes({ form, update }: StepProps) {
  return (
    <FieldGroup label="Notes supplémentaires">
      <AutoGrowTextarea
        value={form.notes}
        onChange={(e) => update({ notes: e.target.value })}
        minRows={4}
        maxRows={20}
        placeholder={notesPlaceholder(form)}
        className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or"
      />
    </FieldGroup>
  )
}
```

- [ ] **Step 3: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit. Sub-components déclarés mais pas appelés ; warnings unused possibles.

- [ ] **Step 4: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
refactor(debrief): extrait les sections en sub-components Step*

Prépare le swap vers le rendu wizard (Task suivante). Les sub-components
encapsulent les blocs FieldGroup existants sans changement de logique.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Activer le rendu wizard (un step à la fois) — la migration core

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — remplacer le bloc JSX entre `{rdvsLoading && !sortedRdvs.length ?` et le footer (lignes 281-456 environ)

C'est la task la plus importante : on bascule du rendu single-page au rendu wizard. Le footer existant est aussi remanié pour avoir Retour / Continuer / Enregistrer.

- [ ] **Step 1: Localiser le bloc JSX à remplacer**

Run:
```bash
cd /root/ECOI_frontend && grep -n "rdvsLoading && !sortedRdvs.length\|disabled={!canSubmit || saving || readOnly}" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : `rdvsLoading && !sortedRdvs.length` à ~ligne 281, le bouton Enregistrer à ~ligne 462. Tout entre ces deux marqueurs est à refactorer.

- [ ] **Step 2: Remplacer le rendu principal par le rendu wizard**

Dans `src/components/leads/CommercialDebriefSidebar.tsx`, **localiser** ce bloc qui démarre à ~ligne 280 :

```tsx
      <div className="flex-1 px-5 py-4 space-y-4">
        {rdvsLoading && !sortedRdvs.length ? (
          // ... skeleton
        ) : sortedRdvs.length === 0 ? (
          <EmptyDebrief />
        ) : (
          <>
            <RdvSelector ... />
            {/* Q3 — Résultat */}
            ... TOUS LES BLOCS Vente/Non-vente conditionnels ...
            <FieldGroup label="Notes supplémentaires"> ... </FieldGroup>
            {error && ...}
            {savedAt && !error && ...}
          </>
        )}
      </div>
```

**Remplacer intégralement** ce `<div className="flex-1 px-5 py-4 space-y-4">...</div>` par :

```tsx
      <div className="flex-1 px-5 py-4 space-y-4">
        {rdvsLoading && !sortedRdvs.length ? (
          <div className="space-y-3">
            <div className="h-12 animate-pulse rounded-2xl bg-cream-darker" />
            <div className="h-32 animate-pulse rounded-2xl bg-cream-darker" />
          </div>
        ) : sortedRdvs.length === 0 ? (
          <EmptyDebrief />
        ) : (
          <>
            <RdvSelector rdvs={sortedRdvs} selectedId={selectedRdv?.id ?? null} onSelect={setSelectedRdvId} />

            <ProgressDots total={stepSequence.length} currentIndex={currentStep} />

            {currentStepId === 'result' && <Step1Result form={form} update={update} />}
            {currentStepId === 'objection_v' && <Step2VObjection form={form} update={update} />}
            {currentStepId === 'acceptance_v' && <Step3VAcceptance form={form} update={update} toggleAcceptance={toggleAcceptance} />}
            {currentStepId === 'details_v' && <Step4VDetails form={form} update={update} />}
            {currentStepId === 'reason_nv' && <Step2NVReason form={form} update={update} />}
            {currentStepId === 'objection_nv' && <Step3NVObjection form={form} update={update} />}
            {currentStepId === 'notes' && <StepFinalNotes form={form} update={update} />}

            {error && (
              <div className="rounded-xl border border-rouille/40 bg-rouille-tint px-3 py-2 text-xs font-bold text-rouille">{error}</div>
            )}
            {savedAt && !error && (
              <div className="rounded-xl border border-success/40 bg-success-tint px-3 py-2 text-xs font-bold text-success">
                Débrief enregistré · {formatTime(savedAt)}
              </div>
            )}
          </>
        )}
      </div>
```

- [ ] **Step 3: Remplacer le footer**

**Localiser** le footer actuel (~ligne 458-476) qui contient `<button ... onClick={handleSubmit}> Enregistrer le débrief </button>`. Le bloc complet est :

```tsx
      {sortedRdvs.length > 0 && (
        <footer className="sticky bottom-0 z-10 border-t border-line bg-white/95 px-5 py-3 backdrop-blur-2xl">
          <button
            type="button"
            disabled={!canSubmit || saving || readOnly}
            onClick={handleSubmit}
            className={`w-full rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${
              canSubmit && !saving
                ? 'bg-text text-white hover:bg-text/90 shadow-md'
                : 'bg-cream-darker text-faint cursor-not-allowed'
            }`}
          >
            {saving ? 'Enregistrement…' : readOnly ? 'Lecture seule — impersonation' : 'Enregistrer le débrief'}
          </button>
          {!canSubmit && form.outcome === '' && (
            <p className="mt-2 text-center text-[11px] text-faint">Choisis un résultat pour activer l'enregistrement</p>
          )}
        </footer>
      )}
```

**Remplacer** par :

```tsx
      {sortedRdvs.length > 0 && (
        <footer className="sticky bottom-0 z-10 border-t border-line bg-white/95 px-5 py-3 backdrop-blur-2xl space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={isFirstStep || saving}
              className={`rounded-2xl border border-line px-4 py-3 text-sm font-bold transition ${
                isFirstStep || saving
                  ? 'bg-cream-darker text-faint cursor-not-allowed'
                  : 'bg-white text-text hover:bg-cream'
              }`}
            >
              ← Retour
            </button>
            {!isLastStep ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canAdvanceStep(currentStepId, form) || saving}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${
                  canAdvanceStep(currentStepId, form) && !saving
                    ? 'bg-text text-white hover:bg-text/90 shadow-md'
                    : 'bg-cream-darker text-faint cursor-not-allowed'
                }`}
              >
                Continuer →
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSubmit || saving || readOnly}
                onClick={handleSubmit}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${
                  canSubmit && !saving
                    ? 'bg-success text-white hover:bg-success/90 shadow-md'
                    : 'bg-cream-darker text-faint cursor-not-allowed'
                }`}
              >
                {saving ? 'Enregistrement…' : readOnly ? 'Lecture seule — impersonation' : 'Enregistrer le débrief'}
              </button>
            )}
          </div>
        </footer>
      )}
```

- [ ] **Step 4: Ajouter le composant `ProgressDots`**

Insérer dans le même fichier, immédiatement après `function StepFinalNotes` (qu'on a ajouté à la Task 3), ce nouveau composant :

```tsx
function ProgressDots({ total, currentIndex }: { total: number; currentIndex: number }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === currentIndex
                ? 'w-6 bg-or'
                : i < currentIndex
                ? 'w-1.5 bg-or-dark'
                : 'w-1.5 bg-line'
            }`}
          />
        ))}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
        Étape {currentIndex + 1} sur {total}
      </span>
    </div>
  )
}
```

- [ ] **Step 5: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit. Si `bg-or` ou `bg-or-dark` n'existent pas comme classes Tailwind du projet, le build TS peut passer mais le visuel sera cassé. Vérifier en lançant `cd /root/ECOI_frontend && grep -E "bg-or-dark|bg-or-tint|bg-or\b" src/index.css tailwind.config*.{ts,js} 2>/dev/null | head -5` — devrait retourner des matches dans `index.css` ou config.

- [ ] **Step 6: Smoke test dev server**

Run:
```bash
cd /root/ECOI_frontend && npm run dev
```

Dans un autre terminal, accéder à `http://localhost:5173` (ou le port que Vite affiche), se logger comme commercial, ouvrir un lead avec un RDV honoré, et vérifier visuellement :
- [ ] Le sidebar de débrief affiche **un seul step à la fois** (Step 1 : "Résultat de l'appel" avec 2 boutons)
- [ ] Progress dots en haut affichent `● ○` (Étape 1 sur 2 par défaut, car outcome vide)
- [ ] Bouton "Retour" est désactivé
- [ ] Bouton "Continuer" est désactivé tant qu'on n'a pas choisi Vente/Non-vente
- [ ] Cliquer "Vente réalisée" → "Continuer" → step 2 affiche "Quelle objection avez-vous surmontée ?"
- [ ] Retour fonctionne
- [ ] Test branche Non-vente : Step 2 = "Raison de la non-vente"
- [ ] Test Non-vente / Suivi prévu → step 3 = objection non surmontée, step 4 = notes
- [ ] Test Non-vente / Non qualifié → step 3 = notes direct (pas d'objection)
- [ ] Dernier step → bouton vert "Enregistrer le débrief" qui sauvegarde

Stop le dev server (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
feat(debrief): basculement vers wizard step-by-step

Le sidebar débrief commercial affiche maintenant un seul step à la fois
avec progress dots, navigation Retour/Continuer, et bouton final
Enregistrer. Logique conditionnelle : objection non surmontée seulement
pour 'Suivi prévu' (déviation explicite vs sidebar legacy).

Steps par branche :
- Vente : 5 (Résultat → Objection → Acceptation → Détails → Notes)
- Non-vente / Suivi prévu : 4
- Non-vente / autres raisons : 3

Suppression des sous-cas chips et du commentaire libre par raison.

Spec : docs/superpowers/specs/2026-05-26-commercial-debrief-wizard-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Reset cascade quand l'outcome ou la raison change

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — modifier la fonction `update` pour ajouter les resets

Problème actuel après Task 4 : si l'user choisit Vente → remplit tout → revient au step 1 → choisit Non-vente, les champs Vente (quoteAmount, signedAt, etc.) restent en mémoire. À la sauvegarde, ils seraient envoyés malgré `outcome=non_vente`. À fixer côté state.

- [ ] **Step 1: Modifier la fonction `update` pour gérer les resets cascade**

Localiser la ligne `const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }))` (ligne 203 environ) et remplacer par :

```ts
  const update = (patch: Partial<FormState>) => {
    setForm((current) => {
      const next = { ...current, ...patch }

      // Reset cascade si outcome change
      if ('outcome' in patch && patch.outcome !== current.outcome) {
        next.nonSaleReason = ''
        next.objection = ''
        next.acceptanceFactors = []
        next.quoteAmount = ''
        next.signedAt = ''
        next.kits = ''
        next.paymentMethod = ''
        // notes préservées (saisie commune)
      }

      // Reset objection si on quitte la branche Suivi prévu
      if ('nonSaleReason' in patch && patch.nonSaleReason !== current.nonSaleReason) {
        if (patch.nonSaleReason !== 'suivi_prevu') {
          next.objection = ''
        }
      }

      return next
    })
    // Si l'user revient en arrière et change un champ d'aiguillage, ramener au step actuel
    // (le useMemo recalcule stepSequence, donc currentStep peut être out-of-bounds → géré par Math.min dans currentStepId)
  }
```

- [ ] **Step 2: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit.

- [ ] **Step 3: Smoke test dev server**

Run `npm run dev`. Scenarios à vérifier :
- [ ] Choisir Vente → step Détails → remplir devis € → retour à Step 1 → switcher sur Non-vente → repartir à Vente : les champs devis sont vides (reset OK)
- [ ] Choisir Non-vente → Suivi prévu → step Objection → choisir "Argent" → retour à Step 2 → choisir Non qualifié → repasser à Suivi prévu : l'objection est vide (reset OK car on a quitté Suivi prévu)
- [ ] Choisir Non-vente → Non qualifié → step Notes → écrire qqchose → retour Step 1 → Vente : les notes **sont préservées**

- [ ] **Step 4: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
feat(debrief): reset cascade des steps abandonnés

Quand l'user change outcome ou nonSaleReason en revenant en arrière, on
purge les champs des steps qui ne sont plus dans la branche active.
Évite d'envoyer des données fantômes au backend. Notes préservées
(saisie commune à toutes les branches).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Animation slide horizontal entre steps

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — wrapper d'animation autour du step actif

Spec : transition slide horizontale 220ms ease-out entre steps. Implémentation pur CSS (pas de lib externe — Framer Motion absent du projet).

- [ ] **Step 1: Ajouter un state pour la direction de transition**

Dans `src/components/leads/CommercialDebriefSidebar.tsx`, juste après le state `currentStep`, ajouter :

```ts
  const [transitionDirection, setTransitionDirection] = useState<'forward' | 'backward'>('forward')
```

- [ ] **Step 2: Mettre à jour `goNext`/`goBack` pour set la direction**

Remplacer les deux fonctions :

```ts
  function goNext() {
    if (!canAdvanceStep(currentStepId, form)) return
    if (isLastStep) return
    setTransitionDirection('forward')
    setCurrentStep((s) => s + 1)
  }

  function goBack() {
    if (isFirstStep) return
    setTransitionDirection('backward')
    setCurrentStep((s) => Math.max(0, s - 1))
  }
```

- [ ] **Step 3: Wrapper le step actif dans un div animé**

Localiser le bloc qui rend les steps (ligne ajoutée en Task 4 ~290) :

```tsx
            {currentStepId === 'result' && <Step1Result form={form} update={update} />}
            {currentStepId === 'objection_v' && <Step2VObjection form={form} update={update} />}
            ...
            {currentStepId === 'notes' && <StepFinalNotes form={form} update={update} />}
```

**Wrapper** ce bloc dans un container animé. Remplacer par :

```tsx
            <div
              key={currentStepId}
              className={`animate-slide-${transitionDirection}`}
            >
              {currentStepId === 'result' && <Step1Result form={form} update={update} />}
              {currentStepId === 'objection_v' && <Step2VObjection form={form} update={update} />}
              {currentStepId === 'acceptance_v' && <Step3VAcceptance form={form} update={update} toggleAcceptance={toggleAcceptance} />}
              {currentStepId === 'details_v' && <Step4VDetails form={form} update={update} />}
              {currentStepId === 'reason_nv' && <Step2NVReason form={form} update={update} />}
              {currentStepId === 'objection_nv' && <Step3NVObjection form={form} update={update} />}
              {currentStepId === 'notes' && <StepFinalNotes form={form} update={update} />}
            </div>
```

**Note :** le `key={currentStepId}` force React à remount le div à chaque changement de step → l'animation CSS se rejoue.

- [ ] **Step 4: Ajouter les keyframes dans `src/index.css`**

Run:
```bash
cd /root/ECOI_frontend && grep -n "@keyframes\|^@layer" src/index.css | head -10
```

Selon ce qui existe, ajouter à la fin de `src/index.css` (ou dans la section `@layer utilities` si elle existe) :

```css
@keyframes slide-forward {
  from { transform: translateX(16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes slide-backward {
  from { transform: translateX(-16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.animate-slide-forward {
  animation: slide-forward 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.animate-slide-backward {
  animation: slide-backward 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 5: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit.

- [ ] **Step 6: Smoke test dev server**

Run `npm run dev`. Vérifier visuellement :
- [ ] Cliquer "Continuer" → le nouveau step apparaît avec un léger fade + slide depuis la droite (~220ms)
- [ ] Cliquer "Retour" → le step précédent apparaît avec slide depuis la gauche
- [ ] Pas de glitch visuel, pas de double-rendu

- [ ] **Step 7: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx src/index.css && git commit -m "$(cat <<'EOF'
feat(debrief): animation slide horizontale entre steps (220ms)

Direction dynamique (forward/backward) selon goNext/goBack. Pur CSS,
pas de dépendance externe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Backward compat — supprimer `[Précision: ...]` write, parser legacy au read

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — fonctions `composeNotes` et `splitNotes`

La spec impose : on n'écrit plus `[Précision: ...]` dans `notes` (puisque le commentaire libre par raison est supprimé). Mais on doit pouvoir relire les anciens débriefs qui en contiennent — on les merge dans `freeText` avec un préfixe visible.

- [ ] **Step 1: Modifier `composeNotes` pour ne plus écrire `[Précision: ...]`**

Localiser `function composeNotes` (~ligne 688). Le bloc actuel :

```ts
function composeNotes(form: FormState): string | null {
  const parts: string[] = []
  if (form.outcome === 'vente' && form.acceptanceFactors.length > 0) {
    const labels = form.acceptanceFactors.map(labelFromAcceptance).join(' | ')
    parts.push(`[Acceptation: ${labels}]`)
  }
  if (form.outcome === 'non_vente') {
    const comment = form.nonSaleComment.trim()
    if (comment) parts.push(`[Précision: ${comment}]`)
  }
  const free = form.notes.trim()
  if (free) parts.push(free)
  return parts.length ? parts.join('\n') : null
}
```

**Remplacer** par :

```ts
function composeNotes(form: FormState): string | null {
  const parts: string[] = []
  if (form.outcome === 'vente' && form.acceptanceFactors.length > 0) {
    const labels = form.acceptanceFactors.map(labelFromAcceptance).join(' | ')
    parts.push(`[Acceptation: ${labels}]`)
  }
  // Plus de [Précision: ...] — supprimé avec le commentaire libre par raison
  const free = form.notes.trim()
  if (free) parts.push(free)
  return parts.length ? parts.join('\n') : null
}
```

- [ ] **Step 2: Modifier `splitNotes` pour fusionner `[Précision: ...]` legacy dans freeText**

Localiser `function splitNotes` (~ligne 703). Le bloc actuel :

```ts
function splitNotes(raw: string | null): { acceptance: string[]; precision: string; freeText: string } {
  if (!raw) return { acceptance: [], precision: '', freeText: '' }
  let rest = raw
  let acceptance: string[] = []
  let precision = ''

  const accMatch = rest.match(ACCEPTANCE_PREFIX_RE)
  if (accMatch) {
    acceptance = accMatch[1].split('|').map((s) => s.trim()).filter(Boolean)
    rest = rest.replace(ACCEPTANCE_PREFIX_RE, '')
  }
  const precMatch = rest.match(PRECISION_PREFIX_RE)
  if (precMatch) {
    precision = precMatch[1].trim()
    rest = rest.replace(PRECISION_PREFIX_RE, '')
  }

  return { acceptance, precision, freeText: rest.trim() }
}
```

**Remplacer** par :

```ts
function splitNotes(raw: string | null): { acceptance: string[]; freeText: string } {
  if (!raw) return { acceptance: [], freeText: '' }
  let rest = raw
  let acceptance: string[] = []

  const accMatch = rest.match(ACCEPTANCE_PREFIX_RE)
  if (accMatch) {
    acceptance = accMatch[1].split('|').map((s) => s.trim()).filter(Boolean)
    rest = rest.replace(ACCEPTANCE_PREFIX_RE, '')
  }

  // Backward compat : si [Précision: ...] existe (ancien format), le merger dans freeText
  // avec préfixe visible "Précision : ..." pour que le commercial le voie et puisse l'éditer.
  const precMatch = rest.match(PRECISION_PREFIX_RE)
  if (precMatch) {
    const precision = precMatch[1].trim()
    rest = rest.replace(PRECISION_PREFIX_RE, '')
    rest = precision ? `Précision : ${precision}\n\n${rest.trim()}`.trim() : rest
  }

  return { acceptance, freeText: rest.trim() }
}
```

- [ ] **Step 3: Mettre à jour les callers de `splitNotes`**

Run:
```bash
cd /root/ECOI_frontend && grep -n "splitNotes\|precision" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : `splitNotes` est appelé dans `rdvToForm` (~ligne 622). Le caller utilise `{ acceptance, precision, freeText }`. **Mettre à jour** ce caller pour ne plus déstructurer `precision` :

Localiser dans `rdvToForm` (~ligne 619-636) :
```ts
  const { acceptance, precision, freeText } = splitNotes(rdv.notes)
```

**Remplacer** par :
```ts
  const { acceptance, freeText } = splitNotes(rdv.notes)
```

Et juste en-dessous, retirer la ligne qui assigne `nonSaleComment: precision,` (le champ existe encore dans le FormState mais n'est plus utilisé visuellement — on le set à `''`) :

```ts
    nonSaleComment: '',
```

(Ne pas supprimer le champ `nonSaleComment` du FormState — c'est utilisé ailleurs et le retirer demanderait plus de refactor. On l'aplatit juste à `''` ; il deviendra dead state qu'on pourra purger dans un cleanup futur.)

- [ ] **Step 4: Run build**

Run:
```bash
cd /root/ECOI_frontend && npm run build
```

Expected : build réussit. Si TypeScript se plaint que `precision` est déclaré nul part dans `splitNotes`, c'est qu'on a oublié le caller — vérifier avec le grep du Step 3.

- [ ] **Step 5: Smoke test backward compat**

Run `npm run dev`. Idéalement, ouvrir un lead qui a un RDV débriefé **avant** le refactor (donc avec un `notes` contenant potentiellement `[Précision: ...]`). Si pas dispo dans la DB de dev, créer manuellement via API :

```bash
# Récupérer un RDV existant et patcher ses notes (à adapter selon ton accès DB)
curl -b cookies.txt -X PATCH http://localhost:4000/rdv/<RDV_ID> \
  -H "Content-Type: application/json" \
  -d '{"notes": "[Précision: Le contact a hésité sur le financement]\nCommercial était stressé"}'
```

Puis ouvrir ce RDV dans le wizard et vérifier visuellement (step Notes final) :
- [ ] Le textarea affiche `Précision : Le contact a hésité sur le financement\n\nCommercial était stressé`
- [ ] Le commercial peut éditer/effacer cette précision librement

- [ ] **Step 6: Commit**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
feat(debrief): backward compat [Précision: ...] legacy notes

- composeNotes n'écrit plus [Précision: ...] (commentaire libre par
  raison supprimé du wizard)
- splitNotes parse l'ancien préfixe et le fusionne dans freeText avec
  un préfixe visible "Précision : ..." que le commercial peut éditer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Cleanup et polish final

**Files:**
- Modify: `src/components/leads/CommercialDebriefSidebar.tsx` — supprimer code mort, polish visuel

- [ ] **Step 1: Supprimer les helpers maintenant inutilisés**

Run:
```bash
cd /root/ECOI_frontend && grep -n "NON_SALE_SUB_REASONS\|labelFromNonSaleReason\|nonSaleCommentPlaceholder" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : `NON_SALE_SUB_REASONS` (les sous-cas chips) est déclaré ligne ~84 mais n'est plus utilisé dans le rendu wizard. `nonSaleCommentPlaceholder` (placeholder du commentaire libre par raison) idem. `labelFromNonSaleReason` peut encore être utilisé par `composeNonSaleReason` et le titre du FieldGroup — vérifier avant suppression.

**Supprimer** :
- Le `const NON_SALE_SUB_REASONS: Record<NonSaleReason, string[]> = { ... }` (lignes ~84-133)
- La `function nonSaleCommentPlaceholder` (lignes ~723-733)

**Garder** `labelFromNonSaleReason` (utilisé par `composeNonSaleReason` qui reste dans le payload).

- [ ] **Step 2: Simplifier `composeNonSaleReason`**

Localiser `function composeNonSaleReason` (~ligne 675). Le bloc actuel :

```ts
function composeNonSaleReason(reason: NonSaleReason, sub: string): string {
  const main = labelFromNonSaleReason(reason)
  if (!sub.trim()) return main
  return `${main}${NON_SALE_REASON_SEPARATOR}${sub.trim()}`
}
```

**Remplacer** par (signature simplifiée — plus de `sub`) :

```ts
function composeNonSaleReason(reason: NonSaleReason): string {
  return labelFromNonSaleReason(reason)
}
```

- [ ] **Step 3: Mettre à jour le caller dans `handleSubmit`**

Localiser dans `handleSubmit` (~ligne 232) :
```ts
      const composedNonSaleReason =
        form.outcome === 'non_vente' && form.nonSaleReason
          ? composeNonSaleReason(form.nonSaleReason, form.nonSaleSubReason)
          : null
```

**Remplacer** par :
```ts
      const composedNonSaleReason =
        form.outcome === 'non_vente' && form.nonSaleReason
          ? composeNonSaleReason(form.nonSaleReason)
          : null
```

- [ ] **Step 4: Supprimer la constante `NON_SALE_REASON_SEPARATOR` si plus utilisée**

Run:
```bash
cd /root/ECOI_frontend && grep -n "NON_SALE_REASON_SEPARATOR" src/components/leads/CommercialDebriefSidebar.tsx
```

Expected : encore référencée dans `splitNonSaleReason` qui parse le legacy. **Garder** la constante et la fonction `splitNonSaleReason` (utile au backward-compat read des anciens débriefs qui contiennent ` — sub`).

- [ ] **Step 5: Run build et lint**

Run:
```bash
cd /root/ECOI_frontend && npm run build && npm run lint 2>&1 | tail -20
```

Expected : build réussit, lint propre (ou warnings inchangés vs baseline).

- [ ] **Step 6: Smoke test final end-to-end sur dev server**

Run `npm run dev`. Tester les 3 branches complètes :

**Branche Vente :**
- [ ] Ouvrir un lead avec RDV honoré
- [ ] Step 1 : Cliquer "Vente réalisée" → Continuer
- [ ] Step 2 : Cliquer "Argent" → Continuer
- [ ] Step 3 : Cocher "Prix convenable" + "Garanties" → Continuer
- [ ] Step 4 : Remplir devis 15000€, date du jour, kits "8 PV", paiement "Comptant" → Continuer
- [ ] Step 5 : Écrire notes "Signature dans 2h"
- [ ] Cliquer "Enregistrer le débrief" → toast vert apparait
- [ ] Vérifier en DB ou via API que le RDV a : `result=signe`, `objections=Argent`, `montantTotal=15000`, `kits=8 PV`, `financingType=comptant`, `notes` contient `[Acceptation: Prix convenable | Garanties]\nSignature dans 2h`

**Branche Non-vente / Suivi prévu :**
- [ ] Ouvrir un autre RDV
- [ ] Step 1 : Non-vente → Continuer
- [ ] Step 2 : Suivi prévu → Continuer
- [ ] Step 3 : "La logistique" → Continuer
- [ ] Step 4 : Notes "Reprendre dans 7 jours"
- [ ] Enregistrer → vérifier `result=reflexion`, `nonSaleReason=Suivi prévu`, `objections=La logistique`

**Branche Non-vente / Non qualifié (3 steps) :**
- [ ] Step 1 : Non-vente → Continuer
- [ ] Step 2 : Non Qualifié → Continuer
- [ ] **Vérifier visuellement** que le step suivant est **direct le step Notes** (pas d'objection)
- [ ] Progress dots affichent `● ● ●` (3 steps) avec étape 3 sur 3
- [ ] Notes → "Locataire, pas propriétaire" → Enregistrer
- [ ] Vérifier `result=perdu`, `nonSaleReason=Non Qualifié`, `objections=null`

**Branche Non-vente / No-show (3 steps) :**
- [ ] Step 1 : Non-vente → Step 2 : No-show → Step 3 : Notes direct
- [ ] Vérifier `result=no_show`

**Re-ouverture d'un RDV déjà débriefé :**
- [ ] Fermer le sidebar
- [ ] Re-cliquer sur le même lead
- [ ] Le wizard démarre à Step 1
- [ ] Les champs sont pré-remplis (outcome, raison, objection, notes, etc.)
- [ ] Cliquer Continuer enchaîne jusqu'au step final qui montre les notes existantes

**Impersonation read-only :**
- [ ] Activer une impersonation comme `commercial` depuis admin
- [ ] Le bouton final "Enregistrer le débrief" est désactivé avec libellé "Lecture seule — impersonation"

**Analytics intact :**
- [ ] Ouvrir page `/analytics` en admin
- [ ] Le donut "Facteurs d'acceptation" continue d'afficher les valeurs (incluant les nouveaux débriefs Vente faits via le wizard)

- [ ] **Step 7: Commit final**

```bash
cd /root/ECOI_frontend && git add src/components/leads/CommercialDebriefSidebar.tsx && git commit -m "$(cat <<'EOF'
chore(debrief): cleanup code mort post-wizard

Supprime NON_SALE_SUB_REASONS et nonSaleCommentPlaceholder (sous-cas
chips et placeholder du commentaire libre par raison — features
retirées du wizard). Simplifie composeNonSaleReason (plus de sub-cas
à concaténer). Conserve splitNonSaleReason pour backward-compat read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Vérification finale + push

**Files:** aucun

- [ ] **Step 1: Vérifier l'état git**

Run:
```bash
cd /root/ECOI_frontend && git log --oneline <BASE_SHA>..HEAD
```

(`<BASE_SHA>` = celui capturé au Task 0 Step 2.)

Expected : 8 commits, un par task fonctionnelle (Task 1 → Task 8 ; Task 0 et 9 ne commitent rien).

- [ ] **Step 2: Build final + lint**

Run:
```bash
cd /root/ECOI_frontend && npm run build && npm run lint
```

Expected : tous deux verts. Si lint warning ajouté par le refactor, soit fixer, soit documenter dans le commit message ("warning pré-existant" si déjà présent baseline).

- [ ] **Step 3: Diff stat pour vérifier le scope**

Run:
```bash
cd /root/ECOI_frontend && git diff --stat <BASE_SHA>..HEAD
```

Expected : changements concentrés sur `src/components/leads/CommercialDebriefSidebar.tsx` (+/- ~300 lignes net) et `src/index.css` (+~20 lignes). Aucun autre fichier touché (sauf si Mario a des WIP préalables à part).

- [ ] **Step 4: Push**

Run:
```bash
cd /root/ECOI_frontend && git push origin main
```

Expected : push réussit. Sur Render le déploiement frontend se déclenche automatiquement.

- [ ] **Step 5: Smoke test post-deploy en prod**

Attendre que Render finisse le build (~3 min). Aller sur `https://crm.electroconceptoi.com`, se logger comme commercial, ouvrir un lead avec RDV honoré, et refaire le smoke test de la branche Vente avec des données réelles. Si OK → done.

Si KO → diagnostiquer, fixer dans un commit séparé.

---

## Critères d'acceptation (rappel)

Reprise des 12 critères de la spec :

1. ✅ Sur un lead sans RDV : `EmptyDebrief` (préservé)
2. ✅ Wizard démarre à Step 1 "Résultat"
3. ✅ Vente → 5 steps, bouton final = "Enregistrer le débrief" (vert)
4. ✅ Non-vente / Suivi prévu → 4 steps
5. ✅ Non-vente / Non qualifié → 3 steps (pas d'objection)
6. ✅ Progress dots corrects (total + index)
7. ✅ Retour préserve les saisies non touchées ; changement outcome reset les fields downstream
8. ✅ Animation slide horizontale visible (220ms)
9. ✅ Re-ouverture pré-remplit ; backward-compat `[Précision: ...]` et sub-cas legacy
10. ✅ Payload `updateRdv` strictement identique à aujourd'hui
11. ✅ `DebriefAnalytics` continue d'afficher le donut facteurs d'acceptation
12. ✅ Impersonation read-only désactive submit

---

## Notes pour l'agent qui exécute

- **Frequent commits** : 1 commit par task. Si un step échoue, fix dans un NOUVEAU commit, pas en amend.
- **Pas de tests automatisés** sur le frontend de ce projet — les smoke tests sont manuels via dev server. Si une régression est suspectée, faire l'aller-retour avec `npm run dev`.
- **`npm run build` est plus strict que `tsc --noEmit` seul** (convention repo). Toujours utiliser `build` comme verif.
- **Backward compat à vérifier** : si tu as des RDV débriefés en DB de dev qui contiennent `[Précision: ...]` ou ` — sub-cas` dans `nonSaleReason`, ouvre-les pour valider que le parsing legacy marche.
- **Pas de modification backend** dans ce plan. Si tu remarques un bug backend pendant le smoke (ex. `PATCH /rdv` 422 sur un payload qu'on envoie), STOP et reporter — c'est out-of-scope.
- **Pas de modification de `DebriefModal.tsx`** ni de `RdvDetail.tsx` dans ce plan — ils utilisent un autre flow (modal), à migrer plus tard.
