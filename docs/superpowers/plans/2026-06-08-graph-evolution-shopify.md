# Graphe « Évolution » façon Shopify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ancrer la courbe d'évolution sur un axe X temporel (fin de la diagonale plein-cadre quand il y a peu de points), avec labels qui s'adaptent à la plage et une pointe « live » animée façon Shopify.

**Architecture:** Extraire deux fonctions pures (`computeEvolutionDomain`, `buildEvolutionTicks`) dans un nouveau module testable `src/lib/evolutionAxis.ts`. Ajouter un timestamp `t` à chaque `LeadEvolutionPoint`. Réécrire `LeadEvolutionChart` (`src/pages/Overview.tsx`) pour projeter X via le temps (`xFor(t)`), générer les graduations depuis le domaine, et afficher une pointe live animée en CSS. Aucun changement backend.

**Tech Stack:** React + TypeScript + Vite, SVG custom (pas de librairie de charting), Vitest (jsdom), CSS animations.

---

## File Structure

- **Create** `src/lib/evolutionAxis.ts` — module pur : type `EvolutionGranularity`, `computeEvolutionDomain`, `buildEvolutionTicks`, helpers de formatage de dates FR. Aucune dépendance React.
- **Create** `src/lib/evolutionAxis.test.ts` — tests unitaires Vitest des deux fonctions pures.
- **Modify** `src/pages/Overview.tsx` — importer depuis `evolutionAxis`, supprimer le `type EvolutionGranularity` local, ajouter `t` au type `LeadEvolutionPoint` et le peupler dans tous les builders, réécrire `LeadEvolutionChart`, passer `range` au composant.
- **Modify** `src/index.css` — classes + keyframes d'animation de la pointe live + bloc `prefers-reduced-motion`.

> **Note repo (mémoire projet) :** le working tree contient souvent du WIP concurrent. Toujours `git add` **fichier par fichier** nos propres fichiers (jamais `git add -A`). Valider via `npm run build` (le `tsc -b` refuse les imports/vars inutilisés) avant chaque commit.

---

### Task 1: Module pur `evolutionAxis.ts` (domaine + graduations)

**Files:**
- Create: `src/lib/evolutionAxis.ts`
- Test: `src/lib/evolutionAxis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/evolutionAxis.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildEvolutionTicks, computeEvolutionDomain } from './evolutionAxis'

describe('computeEvolutionDomain', () => {
  it('hour granularity spans 8h→21h of the range start day', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour')
    const start = new Date(domain.start)
    const end = new Date(domain.end)
    expect(start.getHours()).toBe(8)
    expect(end.getHours()).toBe(21)
    expect(start.getFullYear()).toBe(2026)
    expect(end.getTime()).toBeGreaterThan(start.getTime())
  })

  it('day granularity spans from start-of-from to end-of-to', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-01T10:00:00.000Z', to: '2026-06-07T18:00:00.000Z' }, 'day')
    expect(domain.end).toBeGreaterThan(domain.start)
    expect(new Date(domain.start).getHours()).toBe(0)
  })
})

describe('buildEvolutionTicks', () => {
  it('hour granularity yields fixed 8/11/14/17/20h labels', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-08T00:00:00.000Z', to: '2026-06-08T23:59:59.999Z' }, 'hour')
    const ticks = buildEvolutionTicks(domain, 'hour')
    expect(ticks.map((t) => t.label)).toEqual(['8h', '11h', '14h', '17h', '20h'])
    // ticks must lie inside the domain
    ticks.forEach((tick) => {
      expect(tick.t).toBeGreaterThanOrEqual(domain.start)
      expect(tick.t).toBeLessThanOrEqual(domain.end)
    })
  })

  it('day granularity yields at most ~6 ticks spanning the range', () => {
    const domain = computeEvolutionDomain({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-07T23:59:59.999Z' }, 'day')
    const ticks = buildEvolutionTicks(domain, 'day')
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.length).toBeLessThanOrEqual(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/evolutionAxis.test.ts`
Expected: FAIL — `Failed to resolve import "./evolutionAxis"` (module does not exist yet).

- [ ] **Step 3: Write the module**

Create `src/lib/evolutionAxis.ts`:

```ts
import { addDays, endOfDay, startOfDay, startOfWeek } from './period'

export type EvolutionGranularity = 'hour' | 'day' | 'week' | 'month'

export type EvolutionDomain = { start: number; end: number }
export type EvolutionTick = { t: number; label: string }

// Fenêtre horaire active du dashboard (cohérent avec le filtre hour 8h–21h côté data).
const HOUR_WINDOW_START = 8
const HOUR_WINDOW_END = 21

function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
}

function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}

/** Bornes temporelles (ms) de l'axe X, selon la granularité et la plage. */
export function computeEvolutionDomain(range: { from: string; to: string }, granularity: EvolutionGranularity): EvolutionDomain {
  if (granularity === 'hour') {
    const start = startOfDay(new Date(range.from))
    start.setHours(HOUR_WINDOW_START, 0, 0, 0)
    const end = startOfDay(new Date(range.from))
    end.setHours(HOUR_WINDOW_END, 0, 0, 0)
    return { start: start.getTime(), end: end.getTime() }
  }
  if (granularity === 'week') {
    const start = startOfWeek(new Date(range.from))
    const end = endOfDay(addDays(startOfWeek(new Date(range.to)), 6))
    return { start: start.getTime(), end: end.getTime() }
  }
  if (granularity === 'month') {
    const from = new Date(range.from)
    const to = new Date(range.to)
    const start = startOfDay(new Date(from.getFullYear(), from.getMonth(), 1))
    const end = endOfDay(new Date(to.getFullYear(), to.getMonth() + 1, 0))
    return { start: start.getTime(), end: end.getTime() }
  }
  // day
  return { start: startOfDay(new Date(range.from)).getTime(), end: endOfDay(new Date(range.to)).getTime() }
}

function sampleTicks(ticks: EvolutionTick[], maxCount = 6): EvolutionTick[] {
  if (ticks.length <= maxCount) return ticks
  const step = Math.max(1, Math.ceil(ticks.length / maxCount))
  return ticks.filter((_, index) => index % step === 0 || index === ticks.length - 1)
}

/** Graduations de l'axe X générées depuis le domaine (≈ 5–6 max), labels selon la granularité. */
export function buildEvolutionTicks(domain: EvolutionDomain, granularity: EvolutionGranularity): EvolutionTick[] {
  const { start, end } = domain
  if (!(end > start)) return [{ t: start, label: '' }]

  if (granularity === 'hour') {
    return [8, 11, 14, 17, 20].map((hour) => {
      const d = new Date(start)
      d.setHours(hour, 0, 0, 0)
      return { t: d.getTime(), label: `${hour}h` }
    })
  }

  if (granularity === 'week') {
    const weeks: EvolutionTick[] = []
    let cursor = startOfWeek(new Date(start))
    while (cursor.getTime() <= end) {
      weeks.push({ t: addDays(cursor, 3).getTime(), label: `sem. ${formatDayMonth(cursor)}` })
      cursor = addDays(cursor, 7)
    }
    return sampleTicks(weeks)
  }

  if (granularity === 'month') {
    const months: EvolutionTick[] = []
    const startDate = new Date(start)
    let year = startDate.getFullYear()
    let month = startDate.getMonth()
    while (new Date(year, month, 1).getTime() <= end) {
      months.push({ t: new Date(year, month, 15).getTime(), label: formatMonthLabel(new Date(year, month, 1)) })
      month += 1
      if (month > 11) { month = 0; year += 1 }
    }
    return sampleTicks(months)
  }

  // day
  const days: EvolutionTick[] = []
  let cursor = startOfDay(new Date(start))
  const endDay = startOfDay(new Date(end))
  while (cursor.getTime() <= endDay.getTime()) {
    const mid = new Date(cursor)
    mid.setHours(12, 0, 0, 0)
    days.push({ t: mid.getTime(), label: dayLabel(cursor.toISOString().slice(0, 10)) })
    cursor = addDays(cursor, 1)
  }
  return sampleTicks(days)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/evolutionAxis.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/evolutionAxis.ts src/lib/evolutionAxis.test.ts
git commit -m "feat(overview): module pur evolutionAxis (domaine temporel + graduations)"
```

---

### Task 2: Ajouter le timestamp `t` à `LeadEvolutionPoint`

**Files:**
- Modify: `src/pages/Overview.tsx` (type line 913, builders, placeholders)

Le champ `t` (ms) permet de projeter chaque point à sa vraie position temporelle. Pour `hour`, l'heure est dérivée du champ `hour` ; pour les autres, midi du jour représentatif.

- [ ] **Step 1: Étendre le type**

Modifier `src/pages/Overview.tsx:913` :

```ts
type LeadEvolutionPoint = { key: string; t: number; date: string; label: string; leads: number; rdv: number; signed: number }
```

- [ ] **Step 2: Peupler `t` dans `distributeTotalsAcrossHours`**

Dans `src/pages/Overview.tsx` (~ligne 1264), ajouter `t` à l'objet retourné :

```ts
  return points.map((point, index) => ({
    key: `${point.date}-${point.hour}`,
    t: new Date(`${point.date}T${String(point.hour).padStart(2, '0')}:00:00`).getTime(),
    date: point.date,
    label: `${dayLabel(point.date)} ${point.hour}h`,
    leads: leadValues[index] ?? 0,
    rdv: rdvValues[index] ?? 0,
    signed: signedValues[index] ?? 0,
  }))
```

- [ ] **Step 3: Peupler `t` dans le builder journalier**

Dans `buildLeadEvolutionPoints`, branche `daily` (~ligne 1138), ajouter `t` :

```ts
      return {
        key: date,
        t: new Date(`${date}T12:00:00`).getTime(),
        date,
        label: funnelPoint?.label || summaryPoint?.label || dayLabel(date),
        leads: Math.max(funnelPoint?.answered ?? 0, funnelPoint?.qualified ?? 0, funnelPoint?.rdv ?? 0),
        rdv: summaryPoint?.rdv ?? funnelPoint?.rdv ?? 0,
        signed: summaryPoint?.signed ?? 0,
      }
```

Et le placeholder vide (~ligne 1149), ajouter `t: 0` :

```ts
  return hydrateMissingEvolutionTotals(Array.from({ length: Math.min(7, Math.max(1, range.days)) }, (_, index) => ({
    key: `empty-${index}`,
    t: 0,
    date: '',
    label: index === 0 ? 'Live' : '—',
    leads: 0,
    rdv: 0,
    signed: 0,
  })), totals)
```

- [ ] **Step 4: Peupler `t` dans le builder hebdomadaire**

Dans `buildWeeklyEvolutionPoints`, l'objet `buckets.set(...)` (~ligne 1174), ajouter `t` (basé sur `weekStart`) :

```ts
      buckets.set(key, {
        key,
        t: new Date(`${key}T12:00:00`).getTime(),
        date: key,
        label: `sem. ${formatDayMonth(weekStart)}`,
        leads,
        rdv,
        signed,
      })
```

Et le placeholder vide de cette fonction (~ligne 1208), `t: 0` :

```ts
    return hydrateMissingEvolutionTotals([{ key: 'empty', t: 0, date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }], totals)
```

- [ ] **Step 5: Peupler `t` dans le builder mensuel**

Dans `buildMonthlyEvolutionPoints`, l'objet `buckets.set(monthKey, ...)` (~ligne 1234), ajouter `t` :

```ts
      buckets.set(monthKey, {
        key: monthKey,
        t: new Date(`${monthKey}-15T12:00:00`).getTime(),
        date: `${monthKey}-01`,
        label: formatMonthLabel(new Date(`${monthKey}-01`)),
        leads,
        rdv,
```

> Vérifier le placeholder éventuel en fin de `buildMonthlyEvolutionPoints` (s'il existe un `{ key: 'empty', date: '', ... }` similaire au weekly, lui ajouter `t: 0`).

- [ ] **Step 6: Build pour vérifier qu'aucun objet `LeadEvolutionPoint` n'oublie `t`**

Run: `npm run build`
Expected: PASS. Si erreur `Property 't' is missing in type ...`, ajouter `t` à l'objet pointé (notamment le default `rawPoints` dans le chart — traité Task 3, donc ici l'erreur peut subsister sur `Overview.tsx:950` ; si c'est le seul échec, appliquer dès maintenant le correctif de Task 3 Step 2).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat(overview): timestamp t sur chaque point d'évolution"
```

---

### Task 3: Axe X temporel + graduations dans `LeadEvolutionChart`

**Files:**
- Modify: `src/pages/Overview.tsx` (import, suppression type local, signature + corps du composant, call site)

- [ ] **Step 1: Imports & suppression du type dupliqué**

En haut de `src/pages/Overview.tsx`, ajouter l'import (à placer près des autres imports `./lib/...`) :

```ts
import { buildEvolutionTicks, computeEvolutionDomain, type EvolutionGranularity } from '../lib/evolutionAxis'
```

Puis **supprimer** la ligne locale `src/pages/Overview.tsx:19` :

```ts
type EvolutionGranularity = 'hour' | 'day' | 'week' | 'month'
```

(Le type vient désormais de `evolutionAxis`.)

- [ ] **Step 2: Default point + signature du composant**

Dans `LeadEvolutionChart`, corriger le `rawPoints` par défaut (~ligne 950) pour inclure `t` :

```ts
  const rawPoints = points.length > 0 ? points : [{ key: 'empty', t: 0, date: '', label: 'Live', leads: 0, rdv: 0, signed: 0 }]
```

Modifier la signature pour recevoir `range` (ligne 947) :

```ts
function LeadEvolutionChart({ points, comparePoints = [], granularity, range, rangeLabel, compareLabel, totals }: { points: LeadEvolutionPoint[]; comparePoints?: LeadEvolutionPoint[]; granularity: EvolutionGranularity; range: FunnelPeriodRange; rangeLabel: string; compareLabel?: string; totals: { leads: number; rdv: number; signed: number } }) {
```

- [ ] **Step 3: Domaine, mode temporel, projections X**

Remplacer la définition de `xFor` (ligne 969) par le bloc suivant (le reste des constantes `width…chartHeight`, `clamp`, `max`, `yFor` reste inchangé) :

```ts
  const domain = computeEvolutionDomain(range, granularity)
  const ticks = buildEvolutionTicks(domain, granularity)
  const useTime = domain.end > domain.start && safePoints.every((point) => Number.isFinite(point.t) && point.t > 0)
  const xForTime = (t: number) => padX + ((clamp(t, domain.start, domain.end) - domain.start) / (domain.end - domain.start)) * chartWidth
  const xForIndex = (index: number) => padX + (safePoints.length === 1 ? chartWidth / 2 : (index / (safePoints.length - 1)) * chartWidth)
  const xFor = (index: number) => (useTime ? xForTime(safePoints[index].t) : xForIndex(index))
  const xForCompare = (index: number) => padX + (comparePts.length <= 1 ? chartWidth / 2 : (index / (comparePts.length - 1)) * chartWidth)
```

- [ ] **Step 4: Coordonnées de comparaison via `xForCompare`**

Remplacer la ligne `compareCoords` (ligne 973) :

```ts
  const compareCoords = comparePts.map((point, index) => ({ x: xForCompare(index), y: yFor(point[activeKey]) }))
```

- [ ] **Step 5: Hover par point le plus proche (gère les 2 modes)**

Remplacer le corps de `onMove` (lignes 982-988) :

```ts
  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const cursorX = clamp(((event.clientX - rect.left) / rect.width) * width, padX, width - padX)
    let index = 0
    let best = Infinity
    for (let i = 0; i < safePoints.length; i += 1) {
      const dist = Math.abs(xFor(i) - cursorX)
      if (dist < best) { best = dist; index = i }
    }
    setHover({ index, cursorX: xFor(index) })
  }
```

- [ ] **Step 6: Graduations d'axe X depuis le domaine**

Remplacer le bloc des labels X (lignes 1034-1042 : `xLabelIndexes.map(...)`) par un rendu basé sur `ticks` quand `useTime`, sinon fallback sur l'ancien comportement par points. D'abord, **supprimer** les lignes 979-980 (`xLabelStep` / `xLabelIndexes`) devenues inutiles en mode temporel, et les remplacer par :

```ts
  const fallbackLabelStep = Math.max(1, Math.ceil((safePoints.length - 1) / 5))
  const fallbackLabelIndexes = safePoints.length <= 1 ? [0] : safePoints.map((_, index) => index).filter((index) => index % fallbackLabelStep === 0 || index === safePoints.length - 1)
```

Puis, dans le JSX, remplacer le `{xLabelIndexes.map(...)}` par :

```tsx
          {useTime
            ? ticks.map((tick, index) => (
                <text
                  key={`x-${tick.t}`}
                  x={xForTime(tick.t)}
                  y={height - 10}
                  className="lead-evolution-axis"
                  textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
                >{tick.label}</text>
              ))
            : fallbackLabelIndexes.map((index) => (
                <text
                  key={`x-${index}`}
                  x={xForIndex(index)}
                  y={height - 10}
                  className="lead-evolution-axis"
                  textAnchor={index === 0 ? 'start' : index === safePoints.length - 1 ? 'end' : 'middle'}
                >{safePoints[index].label}</text>
              ))}
```

- [ ] **Step 7: Passer `range` au composant (call site)**

Modifier le call site `src/pages/Overview.tsx:832` pour ajouter la prop `range` :

```tsx
            <LeadEvolutionChart
              points={evolutionPoints}
              comparePoints={comparePoints}
              granularity={evolutionGranularity}
              range={funnelRange}
              rangeLabel={`Du ${formatShortDate(new Date(funnelRange.from))} au ${formatShortDate(new Date(funnelRange.to))}`}
              compareLabel={`Du ${formatShortDate(new Date(prevRange.from))} au ${formatShortDate(new Date(prevRange.to))}`}
              totals={{ leads: stats.leads, rdv: stats.rdvPris, signed: stats.ventes }}
            />
```

- [ ] **Step 8: Build & test**

Run: `npm run build`
Expected: PASS (aucune erreur de type, aucune var inutilisée — `xLabelStep`/`xLabelIndexes` ont bien été retirés).

Run: `npm test -- src/lib/evolutionAxis.test.ts`
Expected: PASS (régression nulle).

- [ ] **Step 9: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat(overview): axe X temporel + graduations adaptées à la plage"
```

---

### Task 4: Pointe « live » animée (markup SVG)

**Files:**
- Modify: `src/pages/Overview.tsx` (corps du chart : groupe d'anim + pointe live + `key` de rejouage)

- [ ] **Step 1: Clés d'animation + coordonnées de la pointe**

Dans `LeadEvolutionChart`, juste après la définition de `currentPath`/`comparePath`/`areaPath` (~ligne 976), ajouter :

```ts
  const animKey = `${range.from}|${range.to}|${granularity}|${activeKey}`
  const lastIndex = safePoints.length - 1
  const liveX = xFor(lastIndex)
  const liveY = yFor(safePoints[lastIndex][activeKey])
  const showLive = useTime && currentPath !== ''
```

- [ ] **Step 2: Envelopper aire + ligne dans le groupe « montée », et ajouter la pointe live**

Remplacer le bloc de rendu de l'aire et de la ligne courante (lignes 1031-1033) :

```tsx
          {areaPath ? <path d={areaPath} fill="url(#leadEvolutionFill)" stroke="none" /> : null}
          {comparePath ? <path d={comparePath} className="lead-evolution-compare" /> : null}
          {currentPath ? <path d={currentPath} className="lead-evolution-line" /> : null}
```

par :

```tsx
          {comparePath ? <path d={comparePath} className="lead-evolution-compare" /> : null}
          <g key={animKey} className="lead-evolution-anim">
            {areaPath ? <path d={areaPath} fill="url(#leadEvolutionFill)" stroke="none" /> : null}
            {currentPath ? <path d={currentPath} className="lead-evolution-line lead-evolution-line--draw" /> : null}
          </g>
          {showLive ? (
            <g key={`live-${animKey}`} className="lead-evolution-live" pointerEvents="none">
              <line className="lead-evolution-live-spark" x1={liveX} x2={liveX} y1={liveY} y2={liveY - 26} />
              <circle className="lead-evolution-live-halo" cx={liveX} cy={liveY} r="9" />
              <circle className="lead-evolution-live-dot" cx={liveX} cy={liveY} r="4.5" />
            </g>
          ) : null}
```

> La comparaison reste hors du groupe animé (ghost statique). Le groupe `lead-evolution-anim` porte l'animation « montée + tracé » ; la pointe live porte pulsation/halo/spark. Le `key={animKey}` force React à remonter le groupe à chaque changement de plage/métrique → les animations CSS rejouent.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Overview.tsx
git commit -m "feat(overview): pointe live animée (point pulsant, halo, spark, tracé)"
```

---

### Task 5: Animations CSS

**Files:**
- Modify: `src/index.css` (après le bloc « Graphe LeadEvolution — style Shopify », ~ligne 4853)

- [ ] **Step 1: Ajouter les classes + keyframes**

Insérer juste après la ligne `.lead-evolution-legend i.swatch-dashed { ... }` (fin du bloc Shopify, ~ligne 4853) :

```css
/* --- Animations pointe live (façon Shopify) ------------------------- */
.lead-evolution-anim {
  transform-box: fill-box;
  transform-origin: bottom;
  animation: leadEvoRise .9s cubic-bezier(.22,.61,.36,1) both;
}
@keyframes leadEvoRise {
  from { transform: translateY(14px) scaleY(.7); opacity: .35; }
  to { transform: none; opacity: 1; }
}

.lead-evolution-line--draw {
  stroke-dasharray: 1200;
  stroke-dashoffset: 1200;
  animation: leadEvoDraw 1.1s ease forwards;
}
@keyframes leadEvoDraw { to { stroke-dashoffset: 0; } }

.lead-evolution-live { animation: leadEvoLiveIn .45s ease .95s both; }
@keyframes leadEvoLiveIn { from { opacity: 0; } to { opacity: 1; } }

.lead-evolution-live-dot {
  fill: var(--color-or);
  stroke: #fff;
  stroke-width: 2;
  transform-box: fill-box;
  transform-origin: center;
  animation: leadEvoPulse 1.8s ease-in-out 1.1s infinite;
}
@keyframes leadEvoPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.35); }
}

.lead-evolution-live-halo {
  fill: var(--color-or);
  opacity: .25;
  transform-box: fill-box;
  transform-origin: center;
  animation: leadEvoHalo 1.8s ease-out 1.1s infinite;
}
@keyframes leadEvoHalo {
  0% { transform: scale(.6); opacity: .35; }
  70% { opacity: 0; }
  100% { transform: scale(2.4); opacity: 0; }
}

.lead-evolution-live-spark {
  stroke: var(--color-or);
  stroke-width: 2;
  stroke-linecap: round;
  transform-box: fill-box;
  transform-origin: bottom;
  animation: leadEvoSpark 1.8s ease-out 1.1s infinite;
}
@keyframes leadEvoSpark {
  0% { transform: scaleY(0); opacity: 0; }
  35% { transform: scaleY(1); opacity: .9; }
  100% { transform: scaleY(1); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .lead-evolution-anim,
  .lead-evolution-line--draw,
  .lead-evolution-live,
  .lead-evolution-live-dot,
  .lead-evolution-live-halo,
  .lead-evolution-live-spark { animation: none; }
  .lead-evolution-line--draw { stroke-dashoffset: 0; }
  .lead-evolution-live-halo,
  .lead-evolution-live-spark { opacity: 0; }
}
```

> Ces règles sont placées **après** le bloc `.lead-evolution-line { animation: none; stroke-dasharray: none; }` (ligne 4818) ; la cascade fait gagner `.lead-evolution-line--draw` pour `animation`/`stroke-dasharray`. `var(--color-or)` existe déjà dans le thème.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS (CSS compilé sans erreur).

- [ ] **Step 3: Vérification visuelle manuelle**

Run: `npm run dev` puis ouvrir l'Overview.
Attendu :
- Sur « aujourd'hui » avec peu d'heures : la courbe occupe la partie gauche (≈ heures écoulées), espace vide à droite, axe `8h 11h 14h 17h 20h`.
- Pointe droite : point pulsant + halo + petit trait qui monte ; au chargement la courbe se dessine et « monte ».
- Changer de plage rejoue les animations et adapte les labels (jours/semaines/mois).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(overview): animations CSS de la pointe live du graphe d'évolution"
```

---

## Self-Review

**Spec coverage :**
- §1 Axe X temporel (timestamp `t`, domaine, `xFor(t)`) → Tasks 1, 2, 3. ✔
- §1 Aire fermée sous premier/dernier point réel → conservée (`areaPath` utilise `xFor(0)`/`xFor(last)`), Task 3. ✔
- §2 Labels générés depuis le domaine → Task 1 (`buildEvolutionTicks`) + Task 3 Step 6. ✔
- §3 4 animations (tracé, montée, point pulsant, halo+spark) + `key` de rejouage + reduced-motion → Tasks 4 & 5. ✔
- Fenêtre `hour` fixe 8h–21h → Task 1 (`HOUR_WINDOW_*`). ✔
- Tests helpers → Task 1. ✔

**Placeholder scan :** aucun TBD/TODO ; tout step de code montre le code complet. ✔

**Type consistency :** `EvolutionGranularity` exporté par `evolutionAxis` et importé dans Overview (type local supprimé) ; `LeadEvolutionPoint` gagne `t:number` partout (incl. placeholders + default `rawPoints`) ; `computeEvolutionDomain`/`buildEvolutionTicks` mêmes signatures entre module, test et chart ; nouvelle prop `range: FunnelPeriodRange` ajoutée à la signature ET au call site. ✔

**Compare overlay :** projeté via `xForCompare` (fraction sur toute la largeur = période précédente complète), aligné comme un ghost — choix assumé, indépendant du domaine temporel courant. ✔
