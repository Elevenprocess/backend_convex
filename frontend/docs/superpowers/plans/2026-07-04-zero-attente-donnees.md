# « 0 seconde d'attente » données frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer toute attente perçue sur les données : pages déjà visitées peintes instantanément (même après expiration TTL ou reload), première navigation servie par un prefetch global au boot, actions reflétées immédiatement dans les listes.

**Architecture:** On étend le cache de fetch existant de `src/lib/hooks.ts` (Map mémoire clé `path?JSON(query)` + stale-while-refetch) : le TTL devient non destructif (stale au lieu de purge), la persistance passe de localStorage (5 routes) à IndexedDB (toutes les routes principales, hydratée vers la Map au boot), un module de prefetch précharge les requêtes par défaut de chaque page après login, et le patch de cache post-mutation (déjà en place pour les leads) est généralisé aux RDV et aux suppressions.

**Tech Stack:** React 18 + Vite, vitest 3 + jsdom + @testing-library/react, IndexedDB (fake-indexeddb en test), zustand (auth), socket.io (realtime existant, non modifié).

**Spec:** `docs/superpowers/specs/2026-07-04-zero-attente-donnees-design.md`

## Global Constraints

- Tout le travail est dans `ECOI_frontend` — AUCUN fichier backend (`ECOI_backend`) n'est touché.
- **Repo partagé** : `src/lib/api.ts` et `src/components/suivi/NewClientModal*.tsx` sont du WIP d'une autre session. Ne PAS modifier `api.ts`. À chaque commit, `git add` uniquement les fichiers listés dans la tâche (jamais `git add -A` ni `git add .`).
- Validation TypeScript : `npx tsc -b` depuis `ECOI_frontend` (le build Render rejette ce que `--noEmit` laisse passer). Ne JAMAIS lancer tsc sur le backend (OOM du conteneur).
- Tests : `npx vitest run <fichier>` pour une suite, `npm test` pour tout.
- Le cache de fetch a pour clé `` `${path}?${JSON.stringify(query ?? {})}` `` — l'ORDRE des propriétés du query compte. Toute requête préchargée doit être construite par la MÊME fonction que celle du hook de page.
- Les tests de hooks partagent la Map de cache module-scope : utiliser des valeurs de query uniques par test (ex. une `city` distincte) ou les helpers `__test*` ajoutés en Task 1.
- Style : commentaires en français, mêmes conventions que l'existant (pas de point-virgule superflu, single quotes).

---

### Task 1: TTL non destructif

Une entrée de cache expirée (> 10 min) n'est plus supprimée : elle est servie immédiatement, marquée `stale`, et un refetch de fond se déclenche au montage — plus jamais de loader plein écran sur une page déjà visitée.

**Files:**
- Modify: `src/lib/hooks.ts` (fonction `readCachedEntry`, ~ligne 64)
- Test: `src/lib/hooks.cache-ttl.test.tsx` (nouveau)

**Interfaces:**
- Consumes: `fetchCache`, `FETCH_CACHE_TTL_MS`, `readPersistedCache` (existants dans hooks.ts)
- Produces: exports test-only `__testSeedFetchCache(cacheKey: string, entry: { data: unknown; timestamp: number; stale?: boolean }): void`, `__testReadFetchCacheEntry(cacheKey: string): { data: unknown; timestamp: number; stale?: boolean } | undefined`, `__testResetFetchCache(): void` — réutilisés par les tests des Tasks 2 et 4.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/lib/hooks.cache-ttl.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LeadResponse } from './types'

vi.mock('./api', () => ({
  API_BASE: 'http://test.local/api',
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  assignLeadToCommercial: vi.fn(),
}))

import { api } from './api'
import { useLeads, __testSeedFetchCache, __testResetFetchCache } from './hooks'

const apiMock = vi.mocked(api)

const lead = (firstName: string): LeadResponse => ({ id: `lead-${firstName}`, firstName } as LeadResponse)

function LeadsProbe({ city }: { city: string }) {
  const { data, loading } = useLeads({ city })
  if (loading) return <div>chargement…</div>
  return <div>{data?.map((l) => l.firstName).join(',') || 'vide'}</div>
}

// Clé produite par useLeads({ city }) : spread des filtres puis limit par défaut (250).
const leadsKey = (city: string) => `/leads?${JSON.stringify({ city, limit: 250 })}`

beforeEach(() => {
  apiMock.mockReset()
  __testResetFetchCache()
  window.localStorage.clear()
})

describe('cache TTL non destructif', () => {
  it('sert une entrée expirée immédiatement (pas de loader) puis refetch en fond', async () => {
    const ELEVEN_MINUTES = 11 * 60 * 1000
    __testSeedFetchCache(leadsKey('TTL-Ville'), {
      data: [lead('Ancienne')],
      timestamp: Date.now() - ELEVEN_MINUTES,
    })
    apiMock.mockResolvedValueOnce([lead('Fraiche')])

    render(<LeadsProbe city="TTL-Ville" />)

    // La donnée expirée est peinte tout de suite — jamais « chargement… ».
    expect(screen.getByText('Ancienne')).toBeTruthy()
    expect(screen.queryByText('chargement…')).toBeNull()

    // Le refetch de fond remplace par la donnée fraîche.
    expect(await screen.findByText('Fraiche')).toBeTruthy()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it("une entrée fraîche est servie sans aucun appel réseau", () => {
    __testSeedFetchCache(leadsKey('TTL-Fraiche'), {
      data: [lead('Recente')],
      timestamp: Date.now(),
    })

    render(<LeadsProbe city="TTL-Fraiche" />)

    expect(screen.getByText('Recente')).toBeTruthy()
    expect(apiMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npx vitest run src/lib/hooks.cache-ttl.test.tsx`
Expected: FAIL — `__testSeedFetchCache` n'existe pas encore (erreur d'import), puis après ajout des helpers seuls, le 1er test échoue sur « chargement… » affiché (l'entrée expirée est purgée par `readCachedEntry`).

- [ ] **Step 3: Implémenter**

Dans `src/lib/hooks.ts`, remplacer `readCachedEntry` (qui supprime l'entrée expirée) :

```ts
function readCachedEntry(cacheKey: string | null): FetchCacheEntry | null {
  if (!cacheKey) return null
  const entry = fetchCache.get(cacheKey) ?? readPersistedCache(cacheKey)
  if (!entry) return null
  // TTL non destructif : une entrée expirée n'est JAMAIS purgée — elle est
  // servie immédiatement, marquée stale, et le montage relance un refetch de
  // fond. Le loader plein écran ne réapparaît plus sur une page déjà visitée.
  const expired = Date.now() - entry.timestamp > FETCH_CACHE_TTL_MS
  const effective = expired && !entry.stale ? { ...entry, stale: true } : entry
  fetchCache.set(cacheKey, effective)
  return effective
}
```

Ajouter en fin de fichier les helpers test-only :

```ts
// ─── Helpers test-only ─────────────────────────────────────
// Le cache est une Map module-scope : les tests ont besoin de la semer et de
// la vider sans passer par le réseau. Ne pas utiliser en code de prod.
export function __testSeedFetchCache(cacheKey: string, entry: FetchCacheEntry): void {
  fetchCache.set(cacheKey, entry)
}

export function __testReadFetchCacheEntry(cacheKey: string): FetchCacheEntry | undefined {
  return fetchCache.get(cacheKey)
}

export function __testResetFetchCache(): void {
  fetchCache.clear()
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest run src/lib/hooks.cache-ttl.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Vérifier la non-régression des tests de cache existants**

Run: `npx vitest run src/lib/hooks.realtime-refresh.test.tsx src/lib/realtimeRefreshQueue.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/hooks.ts src/lib/hooks.cache-ttl.test.tsx
git commit -m "feat(cache): TTL non destructif — une entrée expirée est servie puis rafraîchie en fond"
```

---

### Task 2: Persistance IndexedDB étendue + hydratation au boot

Remplacer la persistance localStorage (5 routes, plafond ~5 Mo) par IndexedDB couvrant toutes les routes principales, hydratée vers la Map mémoire avant le premier rendu (plafond 150 ms), vidée au logout.

**Files:**
- Create: `src/lib/cachePersist.ts`
- Create: `src/lib/fetchCacheStore.ts`
- Modify: `src/lib/hooks.ts` (persistance localStorage → IndexedDB, Map déplacée)
- Modify: `src/main.tsx` (hydratation avant `createRoot`)
- Modify: `src/lib/auth.ts` (`signOut` vide le cache)
- Test: `src/lib/cachePersist.test.ts` (nouveau)

**Interfaces:**
- Produces (`fetchCacheStore.ts`): `type FetchCacheEntry = { data: unknown; timestamp: number; stale?: boolean }`, `const fetchCache: Map<string, FetchCacheEntry>`, `async function clearFetchCache(): Promise<void>`.
- Produces (`cachePersist.ts`): `async function loadAllEntries(): Promise<Array<[string, FetchCacheEntry]>>`, `function persistEntry(key: string, entry: FetchCacheEntry): void` (débouncée), `function removeEntry(key: string): void`, `async function clearAllEntries(): Promise<void>`, `async function migrateLegacyLocalStorage(prefix: string): Promise<void>`.
- Produces (`hooks.ts`): `async function hydrateFetchCache(): Promise<void>` (consommée par `main.tsx`).
- Consumes: helpers `__test*` de Task 1 (inchangés — ils manipulent la même Map, désormais importée de `fetchCacheStore`).

- [ ] **Step 1: Installer fake-indexeddb (dev)**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npm install -D fake-indexeddb
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `src/lib/cachePersist.test.ts` :

```ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadAllEntries,
  persistEntry,
  removeEntry,
  clearAllEntries,
  migrateLegacyLocalStorage,
  __testFlushWrites,
} from './cachePersist'

beforeEach(async () => {
  await clearAllEntries()
  window.localStorage.clear()
})

describe('cachePersist (IndexedDB)', () => {
  it('persiste puis recharge une entrée', async () => {
    persistEntry('/leads?{}', { data: [{ id: 'l1' }], timestamp: Date.now() })
    await __testFlushWrites()
    const entries = await loadAllEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0][0]).toBe('/leads?{}')
    expect(entries[0][1].data).toEqual([{ id: 'l1' }])
  })

  it('supprime une entrée', async () => {
    persistEntry('/users?{}', { data: [], timestamp: Date.now() })
    await __testFlushWrites()
    removeEntry('/users?{}')
    await __testFlushWrites()
    expect(await loadAllEntries()).toHaveLength(0)
  })

  it('purge les entrées de plus de 7 jours au chargement', async () => {
    const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000
    persistEntry('/leads?{"old":1}', { data: [], timestamp: Date.now() - EIGHT_DAYS })
    persistEntry('/leads?{"new":1}', { data: [], timestamp: Date.now() })
    await __testFlushWrites()
    const entries = await loadAllEntries()
    expect(entries.map(([k]) => k)).toEqual(['/leads?{"new":1}'])
  })

  it('vide tout', async () => {
    persistEntry('/leads?{}', { data: [], timestamp: Date.now() })
    await __testFlushWrites()
    await clearAllEntries()
    expect(await loadAllEntries()).toHaveLength(0)
  })

  it('migre les anciennes clés localStorage puis les supprime', async () => {
    const legacy = { data: [{ id: 'l9' }], timestamp: Date.now() }
    window.localStorage.setItem('ecoi.fetchCache.v1:/leads?{}', JSON.stringify(legacy))
    await migrateLegacyLocalStorage('ecoi.fetchCache.v1:')
    expect(window.localStorage.getItem('ecoi.fetchCache.v1:/leads?{}')).toBeNull()
    const entries = await loadAllEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0][1].data).toEqual([{ id: 'l9' }])
  })
})
```

- [ ] **Step 3: Vérifier que le test échoue**

Run: `npx vitest run src/lib/cachePersist.test.ts`
Expected: FAIL — module `./cachePersist` inexistant.

- [ ] **Step 4: Créer `src/lib/fetchCacheStore.ts`**

```ts
import { clearAllEntries } from './cachePersist'

// La Map de cache des fetchs vit ici (et non dans hooks.ts) pour que auth.ts
// puisse la vider au logout sans importer hooks.ts (hooks → realtime → auth :
// l'import inverse créerait un cycle de modules).
export type FetchCacheEntry = {
  data: unknown
  timestamp: number
  // Marqué par un event realtime ou par l'expiration TTL : la donnée reste
  // affichable immédiatement, mais le prochain montage relance un refetch.
  stale?: boolean
}

export const fetchCache = new Map<string, FetchCacheEntry>()

// Au logout : les données métier ne doivent pas survivre à un changement
// d'utilisateur (ni en mémoire, ni sur disque).
export async function clearFetchCache(): Promise<void> {
  fetchCache.clear()
  await clearAllEntries()
}
```

- [ ] **Step 5: Créer `src/lib/cachePersist.ts`**

```ts
import type { FetchCacheEntry } from './fetchCacheStore'

// Persistance IndexedDB du cache de fetch — remplace localStorage (plafond
// ~5 Mo dépassé par les grosses listes). Best-effort : toute erreur IndexedDB
// (navigation privée, quota, jsdom sans IDB) dégrade en cache mémoire seul.
const DB_NAME = 'velora-cache'
const DB_VERSION = 1
const STORE = 'entries'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TOTAL_BYTES = 15 * 1024 * 1024
const WRITE_DEBOUNCE_MS = 500

type PersistedRow = { key: string; entry: FetchCacheEntry; bytes: number }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function requestDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

// Écritures débouncées et fusionnées : une rafale de writeCache (refetch de
// plusieurs listes) produit UNE transaction IndexedDB, pas une par entrée.
const pendingWrites = new Map<string, FetchCacheEntry | null>() // null = suppression
let writeTimer: ReturnType<typeof setTimeout> | null = null

async function flushWrites(): Promise<void> {
  writeTimer = null
  if (pendingWrites.size === 0) return
  const batch = new Map(pendingWrites)
  pendingWrites.clear()
  const db = await openDb()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [key, entry] of batch) {
      if (entry === null) store.delete(key)
      else {
        const bytes = JSON.stringify(entry.data)?.length ?? 0
        store.put({ key, entry, bytes } satisfies PersistedRow)
      }
    }
    await requestDone(tx)
  } catch {
    // best-effort
  }
}

function scheduleFlush(): void {
  if (writeTimer !== null) return
  writeTimer = setTimeout(() => { void flushWrites() }, WRITE_DEBOUNCE_MS)
}

export function persistEntry(key: string, entry: FetchCacheEntry): void {
  pendingWrites.set(key, entry)
  scheduleFlush()
}

export function removeEntry(key: string): void {
  pendingWrites.set(key, null)
  scheduleFlush()
}

export async function clearAllEntries(): Promise<void> {
  pendingWrites.clear()
  const db = await openDb()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await requestDone(tx)
  } catch {
    // best-effort
  }
}

// Charge tout le store en purgeant : entrées > 7 jours, puis les plus
// anciennes si le total dépasse ~15 Mo (estimation JSON).
export async function loadAllEntries(): Promise<Array<[string, FetchCacheEntry]>> {
  const db = await openDb()
  if (!db) return []
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const rows = await new Promise<PersistedRow[]>((resolve) => {
      const req = store.getAll()
      req.onsuccess = () => resolve((req.result as PersistedRow[]) ?? [])
      req.onerror = () => resolve([])
    })
    const now = Date.now()
    const fresh = rows.filter((r) => now - r.entry.timestamp <= MAX_AGE_MS)
    const expired = rows.filter((r) => now - r.entry.timestamp > MAX_AGE_MS)
    // Plafond de taille : on sacrifie les plus anciennes.
    fresh.sort((a, b) => b.entry.timestamp - a.entry.timestamp)
    let total = 0
    const kept: PersistedRow[] = []
    const evicted: PersistedRow[] = []
    for (const row of fresh) {
      total += row.bytes ?? 0
      if (total <= MAX_TOTAL_BYTES) kept.push(row)
      else evicted.push(row)
    }
    for (const row of [...expired, ...evicted]) store.delete(row.key)
    await requestDone(tx)
    return kept.map((r) => [r.key, r.entry])
  } catch {
    return []
  }
}

// Migration one-shot : les anciennes entrées localStorage (ecoi.fetchCache.v1:*)
// sont importées dans IndexedDB puis retirées de localStorage.
export async function migrateLegacyLocalStorage(prefix: string): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const storage = window.localStorage
    const toRemove: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const storageKey = storage.key(i)
      if (!storageKey?.startsWith(prefix)) continue
      toRemove.push(storageKey)
      const raw = storage.getItem(storageKey)
      if (!raw) continue
      try {
        const entry = JSON.parse(raw) as FetchCacheEntry
        if (entry && typeof entry.timestamp === 'number') {
          persistEntry(storageKey.slice(prefix.length), entry)
        }
      } catch {
        // entrée corrompue — on la jette
      }
    }
    for (const storageKey of toRemove) storage.removeItem(storageKey)
    await __testFlushWrites()
  } catch {
    // best-effort
  }
}

// Force le flush des écritures débouncées (tests + fin de migration).
export async function __testFlushWrites(): Promise<void> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  await flushWrites()
}
```

- [ ] **Step 6: Vérifier que les tests cachePersist passent**

Run: `npx vitest run src/lib/cachePersist.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Brancher hooks.ts sur la nouvelle persistance**

Dans `src/lib/hooks.ts` :

1. Supprimer la déclaration locale `type FetchCacheEntry`, la constante `const fetchCache = new Map(...)` et `const PERSISTED_CACHE_PREFIX = 'ecoi.fetchCache.v1:'`. Importer à la place :

```ts
import { fetchCache, type FetchCacheEntry } from './fetchCacheStore'
import { persistEntry, removeEntry, loadAllEntries, migrateLegacyLocalStorage } from './cachePersist'
```

2. Remplacer `PERSISTED_CACHE_PATHS` (5 routes, match `${path}?`) par des préfixes larges (match simple sur la clé) :

```ts
// Routes persistées sur disque (IndexedDB) : tout ce qui peint une page
// principale. Exclusions implicites : binaires (/attachments/*/raw,
// /documents/*/raw ne passent pas par useFetch) et auth.
const PERSISTED_PATH_PREFIXES = [
  '/leads', '/users', '/clients', '/rdv', '/call-logs', '/debriefs',
  '/payments/acomptes', '/analytics/', '/notifications',
  '/ghl-calendar/events', '/commercial-objectives', '/substeps',
  '/interventions', '/projects',
]

function shouldPersistCache(cacheKey: string): boolean {
  return PERSISTED_PATH_PREFIXES.some((prefix) => cacheKey.startsWith(prefix))
}
```

3. Supprimer `readPersistedCache` entièrement. Dans `readCachedEntry`, la ligne de lecture devient `const entry = fetchCache.get(cacheKey)` (après l'hydratation au boot, la Map est LA source ; plus de fallback localStorage synchrone).

4. `writeCache` devient :

```ts
function writeCache(cacheKey: string | null, entry: FetchCacheEntry) {
  if (!cacheKey) return
  fetchCache.set(cacheKey, entry)
  if (shouldPersistCache(cacheKey)) persistEntry(cacheKey, entry)
}
```

5. Recréer `deleteCache` (supprimée en Task 1 : plus aucun appelant après le TTL non destructif, et `noUnusedLocals` interdit une fonction morte) :

```ts
function deleteCache(cacheKey: string) {
  fetchCache.delete(cacheKey)
  removeEntry(cacheKey)
}
```

6. Dans `markCachesStaleForPrefixes`, supprimer TOUTE la partie localStorage (le `try` qui scanne `storage`) ; la boucle sur la Map doit maintenant aussi persister le marquage stale :

```ts
function markCachesStaleForPrefixes(prefixes: string[]) {
  const matches = (cacheKey: string) => prefixes.some((prefix) => cacheKey.startsWith(prefix))
  for (const [key, entry] of fetchCache.entries()) {
    if (!matches(key) || entry.stale) continue
    const stale = { ...entry, stale: true }
    fetchCache.set(key, stale)
    if (shouldPersistCache(key)) persistEntry(key, stale)
  }
}
```

7. Ajouter l'hydratation, exportée pour `main.tsx` :

```ts
// Hydratation au boot : recharge le cache disque (IndexedDB) vers la Map
// mémoire AVANT le premier rendu, pour que les pages peignent immédiatement
// les données de la dernière session. Migration one-shot de l'ancien
// localStorage au passage.
export async function hydrateFetchCache(): Promise<void> {
  try {
    await migrateLegacyLocalStorage('ecoi.fetchCache.v1:')
    const entries = await loadAllEntries()
    for (const [key, entry] of entries) {
      if (!fetchCache.has(key)) fetchCache.set(key, entry)
    }
  } catch {
    // best-effort : sans hydratation on retombe sur le comportement réseau
  }
}
```

8. Dans `readCachedEntry` (version Task 1), garder la logique TTL→stale inchangée.

- [ ] **Step 8: Brancher main.tsx et auth.ts**

Dans `src/main.tsx`, ajouter l'import :

```ts
import { hydrateFetchCache } from './lib/hooks'
```

et remplacer le bloc final `createRoot(document.getElementById('root')!).render(...)` par :

```ts
// Hydrate le cache disque avant le premier rendu (peinture immédiate avec les
// données de la dernière session), plafonné à 150 ms pour ne jamais retarder
// le boot : au-delà, on rend et l'hydratation complète la Map en arrière-plan.
void (async () => {
  await Promise.race([
    hydrateFetchCache(),
    new Promise((resolve) => setTimeout(resolve, 150)),
  ])
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {convexClient ? <ConvexProvider client={convexClient}>{app}</ConvexProvider> : app}
    </StrictMode>
  )
})()
```

Dans `src/lib/auth.ts`, importer :

```ts
import { clearFetchCache } from './fetchCacheStore'
```

et dans `signOut`, juste avant le `set({ user: null, ... })` final, ajouter :

```ts
    // Les données métier en cache ne survivent pas au logout.
    void clearFetchCache()
```

- [ ] **Step 9: Adapter le test TTL de Task 1 si besoin**

`hooks.cache-ttl.test.tsx` seedait la Map directement — toujours valide. Vérifier qu'aucun test existant ne dépendait de la persistance localStorage :

Run: `npx vitest run src/lib/hooks.cache-ttl.test.tsx src/lib/hooks.realtime-refresh.test.tsx src/lib/realtime.test.ts src/lib/realtimeRefreshQueue.test.ts`
Expected: PASS. (jsdom n'a pas d'IndexedDB : `openDb()` résout `null` et toute la persistance devient no-op silencieux — c'est le comportement voulu.)

- [ ] **Step 10: Build TypeScript**

Run: `npx tsc -b`
Expected: aucun diagnostic.

- [ ] **Step 11: Commit**

```bash
git add src/lib/cachePersist.ts src/lib/fetchCacheStore.ts src/lib/cachePersist.test.ts src/lib/hooks.ts src/main.tsx src/lib/auth.ts package.json package-lock.json
git commit -m "feat(cache): persistance IndexedDB étendue, hydratée au boot, vidée au logout"
```

---

### Task 3: Prefetch global au boot

Après login, précharger en arrière-plan (concurrence 3) les requêtes par défaut de toutes les pages principales, filtrées par rôle, pour que la PREMIÈRE navigation vers chaque page trouve le cache chaud. Les objets de filtres par défaut deviennent la source unique partagée entre pages et prefetch (aucune dérive de clé possible).

**Files:**
- Create: `src/lib/pageDefaults.ts`
- Create: `src/lib/prefetch.ts`
- Create: `src/lib/overviewPeriod.ts` (déplacement depuis `Overview.tsx`)
- Modify: `src/lib/hooks.ts` (export des builders de query + `prefetchPath`)
- Modify: `src/pages/Overview.tsx`, `src/pages/leads/LeadsList.tsx`, `src/pages/clients/ClientsList.tsx`, `src/pages/Suivi.tsx`, `src/pages/Finances.tsx`, `src/pages/Notifications.tsx` (consommer les défauts partagés)
- Modify: `src/RootLayout.tsx` (déclenchement)
- Test: `src/lib/prefetch.test.ts` (nouveau)

**Interfaces:**
- Produces (`hooks.ts`): `function buildLeadsQuery(filters?)`, `buildRdvQuery(filters?)`, `buildClientsQuery(filters?)`, `buildNotificationsQuery(filters?)` — chacune extraite du hook correspondant (`useLeads`, `useRdvList`, `useClients`, `useNotifications`) qui DOIT l'utiliser en interne ; `const prefetchPath = prefetchFetchCache` (export).
- Produces (`pageDefaults.ts`): `LEADS_LIST_FILTERS`, `LEADS_LIST_RDV_FILTERS`, `SUIVI_LEADS_FILTERS`, `SUIVI_RDV_FILTERS`, `NOTIFICATIONS_LIST_FILTERS`, `seesFullPortfolio(role)`, `clientsListFilters(userId, role)`, `canAccessFinances(role)`.
- Produces (`prefetch.ts`): `buildPrefetchPlan(user: UserResponse): Array<{ label: string; run: () => Promise<unknown> }>`, `runWithConcurrency(jobs, limit): Promise<void>`, `startGlobalPrefetch(user: UserResponse): void` (idempotent par session).
- Produces (`overviewPeriod.ts`): les symboles déplacés tels quels depuis `Overview.tsx` : `DEFAULT_FUNNEL_PERIOD`, `type FunnelPeriodState`, `buildFunnelPeriodRange`, `previousRange`, `getOverviewWarmupRanges` (noms exacts à confirmer à la lecture du fichier — tout ce dont dépendent le warmup existant et le prefetch).

- [ ] **Step 1: Extraire les builders de query dans hooks.ts**

Dans `src/lib/hooks.ts`, juste au-dessus de `useLeads` :

```ts
// Builders de query PARTAGÉS entre les hooks de pages et le prefetch global
// (src/lib/prefetch.ts). La clé de cache est `path?JSON(query)` : si le
// prefetch construisait sa query autrement (ordre des propriétés compris),
// il réchaufferait une clé que les pages ne lisent jamais.
export function buildLeadsQuery(filters?: {
  status?: LeadStatus
  setterId?: string
  assignedToId?: string
  city?: string
  search?: string
  limit?: number
  offset?: number
  notInAirtable?: boolean
  scope?: 'clients'
}): Record<string, string | number | undefined> {
  const { notInAirtable, ...rest } = filters ?? {}
  return {
    ...rest,
    limit: clampLimit(filters?.limit, 250, LEADS_LIMIT_MAX),
    notInAirtable: notInAirtable ? 'true' : undefined,
  }
}
```

et faire de `useLeads` un simple consommateur :

```ts
  return useFetch<LeadResponse[]>(
    filters === null ? null : '/leads',
    filters === null ? undefined : buildLeadsQuery(filters ?? undefined),
    opts,
  )
```

Même extraction pour les trois autres (le corps est copié tel quel depuis le hook existant, le hook appelle ensuite le builder) :

```ts
export function buildRdvQuery(filters?: {
  leadId?: string
  commercialId?: string
  setterId?: string
  fromDate?: string
  toDate?: string
  limit?: number
}): Record<string, string | number | undefined> {
  return { ...filters, limit: clampLimit(filters?.limit, 200, RDV_LIMIT_MAX) }
}

export function buildClientsQuery(filters?: {
  technicienVtId?: string
  phase?: string
  leadId?: string
  projectId?: string
  unassignedVt?: boolean
}): Record<string, string | undefined> {
  return {
    technicienVtId: filters?.technicienVtId,
    phase: filters?.phase,
    leadId: filters?.leadId,
    projectId: filters?.projectId,
    unassignedVt: filters?.unassignedVt ? 'true' : undefined,
  }
}

export function buildNotificationsQuery(filters?: { unreadOnly?: boolean; limit?: number }): Record<string, string | number | undefined> {
  return {
    unreadOnly: filters?.unreadOnly ? 'true' : undefined,
    limit: filters?.limit,
  }
}
```

⚠️ Vérifier à la lecture de chaque hook que le builder reproduit EXACTEMENT l'objet actuel (mêmes propriétés, même ordre) — c'est un refactor à comportement identique. `useClients` garde son traitement `filters === null` autour du builder, comme `useLeads`.

Exporter aussi le point d'entrée générique du prefetch (la fonction interne existe déjà) :

```ts
export const prefetchPath = prefetchFetchCache
```

- [ ] **Step 2: Vérifier la non-régression du refactor builders**

Run: `npx vitest run src/lib/hooks.realtime-refresh.test.tsx src/lib/hooks.cache-ttl.test.tsx`
Expected: PASS (les clés de cache n'ont pas bougé).

- [ ] **Step 3: Créer `src/lib/pageDefaults.ts`**

```ts
import type { Role } from './role'

// Filtres PAR DÉFAUT des pages principales — source unique partagée entre les
// pages et le prefetch global (src/lib/prefetch.ts). Modifier un défaut ici
// met à jour la page ET son préchauffage d'un même geste.

// LeadsList (src/pages/leads/LeadsList.tsx)
export const LEADS_LIST_FILTERS = { limit: 1000 }
export const LEADS_LIST_RDV_FILTERS = { limit: 500 }

// Suivi (src/pages/Suivi.tsx)
export const SUIVI_LEADS_FILTERS = { limit: 500 }
export const SUIVI_RDV_FILTERS = { limit: 200 }

// Notifications (src/pages/Notifications.tsx)
export const NOTIFICATIONS_LIST_FILTERS = { limit: 50 }

// ClientsList : managers et rôles ops voient tout le portefeuille, un
// commercial ne voit que ses clients (même logique que la page).
export function seesFullPortfolio(role: Role | undefined): boolean {
  return (
    role === 'commercial_lead' ||
    role === 'admin' ||
    role === 'delivrabilite' ||
    role === 'responsable_technique' ||
    role === 'back_office'
  )
}

export function clientsListFilters(userId: string | undefined, role: Role | undefined) {
  if (seesFullPortfolio(role) || !userId) return { scope: 'clients' as const, limit: 1000 }
  return { assignedToId: userId, scope: 'clients' as const, limit: 1000 }
}

// Finances (src/pages/Finances.tsx)
export function canAccessFinances(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'finances' ||
    role === 'delivrabilite' ||
    role === 'responsable_technique' ||
    role === 'back_office'
  )
}
```

⚠️ Ordre des propriétés de `clientsListFilters` : la page construit aujourd'hui `{ scope, limit }` et `{ assignedToId, scope, limit }` — conserver ces ordres exacts.

- [ ] **Step 4: Brancher les pages sur les défauts partagés**

- `src/pages/leads/LeadsList.tsx` : `useLeads({ limit: 1000 })` → `useLeads(LEADS_LIST_FILTERS)` ; `useRdvList({ limit: 500 })` → `useRdvList(LEADS_LIST_RDV_FILTERS)`.
- `src/pages/Suivi.tsx` : `useLeads({ limit: 500 }, NO_RT)` → `useLeads(SUIVI_LEADS_FILTERS, NO_RT)` ; `useRdvList({ limit: 200 }, NO_RT)` → `useRdvList(SUIVI_RDV_FILTERS, NO_RT)`.
- `src/pages/clients/ClientsList.tsx` : supprimer les constantes locales `isManager`/`isOps`/`seesFullPortfolio` au profit de `seesFullPortfolio(me?.role)` importé (attention : la variable locale est aussi utilisée plus bas dans la page pour les droits d'édition — remplacer chaque usage) ; remplacer le bloc `leadsFilter = ...` par `const leadsFilter = clientsListFilters(me?.id, me?.role)`.
- `src/pages/Finances.tsx` : remplacer la ligne locale `const canAccessFinances = role === 'admin' || ...` par `const financesAllowed = canAccessFinances(role)` (import) et mettre à jour ses deux usages (hook + redirect).
- `src/pages/Notifications.tsx` : `useNotifications({ limit: 50 })` → `useNotifications(NOTIFICATIONS_LIST_FILTERS)`.

Run: `npx vitest run src/pages` — Expected: PASS (mêmes valeurs, refactor pur).

- [ ] **Step 5: Déplacer les helpers de période d'Overview vers `src/lib/overviewPeriod.ts`**

Lire `src/pages/Overview.tsx` et déplacer (couper/coller, code inchangé) les déclarations de `DEFAULT_FUNNEL_PERIOD`, `FunnelPeriodState`, `buildFunnelPeriodRange`, `previousRange` et `getOverviewWarmupRanges` — ainsi que toute constante/fonction privée dont elles dépendent exclusivement — vers un nouveau fichier `src/lib/overviewPeriod.ts`, en les exportant. `Overview.tsx` les importe désormais depuis `../lib/overviewPeriod`. Aucun changement de comportement.

Run: `npx tsc -b` — Expected: aucun diagnostic.

- [ ] **Step 6: Écrire le test prefetch qui échoue**

Créer `src/lib/prefetch.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('./api', () => ({
  API_BASE: 'http://test.local/api',
  api: vi.fn().mockResolvedValue([]),
  ApiError: class ApiError extends Error {},
  assignLeadToCommercial: vi.fn(),
}))

import { buildPrefetchPlan, runWithConcurrency } from './prefetch'
import type { UserResponse } from './types'

const user = (role: string): UserResponse => ({ id: 'u1', role } as UserResponse)

describe('buildPrefetchPlan', () => {
  it('un admin précharge leads, suivi, clients, finances et analytics', () => {
    const labels = buildPrefetchPlan(user('admin')).map((j) => j.label)
    expect(labels).toContain('users')
    expect(labels).toContain('leads:list')
    expect(labels).toContain('suivi:leads')
    expect(labels).toContain('clients:list')
    expect(labels).toContain('finances:acomptes')
    expect(labels).toContain('analytics:summary')
  })

  it('un setter ne précharge pas les finances', () => {
    const labels = buildPrefetchPlan(user('setter')).map((j) => j.label)
    expect(labels).not.toContain('finances:acomptes')
    expect(labels).toContain('leads:list')
  })

  it('un technicien ne précharge que le minimum', () => {
    const labels = buildPrefetchPlan(user('technicien')).map((j) => j.label)
    expect(labels).toEqual(['users'])
  })
})

describe('runWithConcurrency', () => {
  it('ne lance jamais plus de N jobs à la fois', async () => {
    let inFlight = 0
    let peak = 0
    const jobs = Array.from({ length: 8 }, (_, i) => ({
      label: `job-${i}`,
      run: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
      },
    }))
    await runWithConcurrency(jobs, 3)
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it("un job en échec n'arrête pas les autres", async () => {
    const done: string[] = []
    const jobs = [
      { label: 'ko', run: async () => { throw new Error('boom') } },
      { label: 'ok', run: async () => { done.push('ok') } },
    ]
    await runWithConcurrency(jobs, 1)
    expect(done).toEqual(['ok'])
  })
})
```

Run: `npx vitest run src/lib/prefetch.test.ts` — Expected: FAIL (module inexistant).

- [ ] **Step 7: Créer `src/lib/prefetch.ts`**

```ts
import {
  buildClientsQuery,
  buildLeadsQuery,
  buildNotificationsQuery,
  buildRdvQuery,
  prefetchAnalyticsFunnel,
  prefetchAnalyticsSummary,
  prefetchPath,
} from './hooks'
import {
  LEADS_LIST_FILTERS,
  LEADS_LIST_RDV_FILTERS,
  NOTIFICATIONS_LIST_FILTERS,
  SUIVI_LEADS_FILTERS,
  SUIVI_RDV_FILTERS,
  canAccessFinances,
  clientsListFilters,
} from './pageDefaults'
import { DEFAULT_FUNNEL_PERIOD, buildFunnelPeriodRange, previousRange } from './overviewPeriod'
import type { Role } from './role'
import type { UserResponse } from './types'

// Prefetch global : réchauffe le cache des pages principales dès le login,
// pour que la PREMIÈRE navigation vers chacune soit instantanée. Chaque job
// passe par prefetchPath → si le cache est déjà frais (persistance IndexedDB
// de la dernière session), AUCUN appel réseau n'est émis.
export type PrefetchJob = { label: string; run: () => Promise<unknown> }

export function buildPrefetchPlan(user: UserResponse): PrefetchJob[] {
  const role = user.role as Role
  const jobs: PrefetchJob[] = [
    { label: 'users', run: () => prefetchPath('/users') },
  ]
  if (role === 'technicien') return jobs

  // Overview — période initiale + période de comparaison (le préchauffage des
  // AUTRES presets reste dans Overview.tsx, séquentiel, pour ne pas saturer la DB).
  const range = buildFunnelPeriodRange(DEFAULT_FUNNEL_PERIOD)
  const prev = previousRange(range)
  jobs.push(
    { label: 'analytics:summary', run: () => prefetchAnalyticsSummary({ from: range.from, to: range.to }) },
    { label: 'analytics:funnel', run: () => prefetchAnalyticsFunnel({ from: range.from, to: range.to }) },
    { label: 'analytics:summary-prev', run: () => prefetchAnalyticsSummary({ from: prev.from, to: prev.to }) },
  )

  // Listes de travail — mêmes filtres par défaut que les pages (pageDefaults).
  jobs.push(
    { label: 'leads:list', run: () => prefetchPath('/leads', buildLeadsQuery(LEADS_LIST_FILTERS)) },
    { label: 'leads:rdv', run: () => prefetchPath('/rdv', buildRdvQuery(LEADS_LIST_RDV_FILTERS)) },
    { label: 'suivi:leads', run: () => prefetchPath('/leads', buildLeadsQuery(SUIVI_LEADS_FILTERS)) },
    { label: 'suivi:rdv', run: () => prefetchPath('/rdv', buildRdvQuery(SUIVI_RDV_FILTERS)) },
    { label: 'suivi:clients', run: () => prefetchPath('/clients', buildClientsQuery(undefined)) },
    { label: 'clients:list', run: () => prefetchPath('/leads', buildLeadsQuery(clientsListFilters(user.id, role))) },
    { label: 'notifications', run: () => prefetchPath('/notifications', buildNotificationsQuery(NOTIFICATIONS_LIST_FILTERS)) },
  )

  if (canAccessFinances(role)) {
    jobs.push({ label: 'finances:acomptes', run: () => prefetchPath('/payments/acomptes') })
  }
  return jobs
}

// Concurrence bornée : 3 requêtes max en parallèle pour ne pas saturer le
// backend Render au boot. Les échecs sont silencieux (best-effort).
export async function runWithConcurrency(jobs: PrefetchJob[], limit: number): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next]
      next += 1
      try {
        await job.run()
      } catch {
        // préchargement best-effort — la page fera son propre fetch si besoin
      }
    }
  })
  await Promise.all(workers)
}

let prefetchStarted = false

// Idempotent par session : appelé à chaque rendu de RootLayout, ne part qu'une fois.
export function startGlobalPrefetch(user: UserResponse): void {
  if (prefetchStarted || typeof window === 'undefined') return
  prefetchStarted = true
  const kick = () => { void runWithConcurrency(buildPrefetchPlan(user), 3) }
  // Après le premier paint : le prefetch ne doit jamais concurrencer le
  // chargement de la page d'atterrissage.
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(kick, { timeout: 2000 })
  } else {
    window.setTimeout(kick, 1000)
  }
}
```

- [ ] **Step 8: Vérifier que les tests prefetch passent**

Run: `npx vitest run src/lib/prefetch.test.ts`
Expected: PASS (5 tests). Si `buildFunnelPeriodRange(DEFAULT_FUNNEL_PERIOD)` a besoin d'un environnement particulier, vérifier que le mock `./api` suffit — `overviewPeriod.ts` ne doit dépendre que de `period.tsx` (pur).

- [ ] **Step 9: Déclencher depuis RootLayout**

Dans `src/RootLayout.tsx`, importer :

```ts
import { startGlobalPrefetch } from './lib/prefetch'
```

et dans le composant `RootLayout`, après les hooks existants :

```ts
  const authedUser = useAuth((s) => s.user)
  const authStatus = useAuth((s) => s.status)
  useEffect(() => {
    if (authStatus === 'authed' && authedUser) startGlobalPrefetch(authedUser)
  }, [authStatus, authedUser])
```

- [ ] **Step 10: Build + suite complète**

Run: `npx tsc -b && npm test`
Expected: build sans diagnostic, tous les tests verts.

- [ ] **Step 11: Commit**

```bash
git add src/lib/prefetch.ts src/lib/prefetch.test.ts src/lib/pageDefaults.ts src/lib/overviewPeriod.ts src/lib/hooks.ts src/RootLayout.tsx src/pages/Overview.tsx src/pages/leads/LeadsList.tsx src/pages/clients/ClientsList.tsx src/pages/Suivi.tsx src/pages/Finances.tsx src/pages/Notifications.tsx
git commit -m "feat(perf): prefetch global au boot — cache chaud pour toutes les pages principales dès le login"
```

---

### Task 4: Post-action instantané — patchs de cache généralisés (RDV + suppressions)

Les leads ont déjà un patch de cache post-mutation (`updateLeadCaches`). Généraliser le mécanisme et le câbler sur les RDV (update, update GHL, création — qui n'émet même pas de refresh aujourd'hui) et sur la suppression de lead (idem).

**Note de périmètre :** la spec citait aussi les flux suivi (substeps) et débriefs. Leurs mutations vivent dans `src/lib/api.ts` — WIP d'une autre session, interdit de modification (voir Global Constraints) — et elles émettent DÉJÀ un `notifyRealtimeRefresh` immédiat (refetch de fond instantané). On les laisse en l'état ; le patch optimiste pourra y être ajouté quand `api.ts` sera libéré.

**Files:**
- Modify: `src/lib/hooks.ts` (helpers génériques + câblage `updateRdv`, `updateGhlAppointment`, `createRdv`, `deleteLead`)
- Test: `src/lib/hooks.cache-patch.test.tsx` (nouveau)

**Interfaces:**
- Consumes: `__testSeedFetchCache`, `__testReadFetchCacheEntry`, `__testResetFetchCache` (Task 1), `writeCache`, `deleteCache`, `fetchCache`.
- Produces (interne à hooks.ts): `patchEntityCaches<T extends { id: string }>(pathPrefix: string, updated: T): void`, `removeEntityFromCaches(pathPrefix: string, id: string): void`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/lib/hooks.cache-patch.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LeadResponse, RdvResponse } from './types'

vi.mock('./api', () => ({
  API_BASE: 'http://test.local/api',
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  assignLeadToCommercial: vi.fn(),
}))

import { api } from './api'
import {
  updateRdv,
  deleteLead,
  __testSeedFetchCache,
  __testReadFetchCacheEntry,
  __testResetFetchCache,
} from './hooks'

const apiMock = vi.mocked(api)

beforeEach(() => {
  apiMock.mockReset()
  __testResetFetchCache()
})

describe('patch de cache post-mutation', () => {
  it('updateRdv remplace le RDV dans toutes les listes /rdv en cache, sans refetch', async () => {
    const before = { id: 'r1', status: 'planifie' } as RdvResponse
    const other = { id: 'r2', status: 'planifie' } as RdvResponse
    __testSeedFetchCache('/rdv?{"limit":200}', { data: [before, other], timestamp: Date.now() })

    const after = { id: 'r1', status: 'honore' } as RdvResponse
    apiMock.mockResolvedValueOnce(after)
    await updateRdv('r1', { status: 'honore' as RdvResponse['status'] })

    const entry = __testReadFetchCacheEntry('/rdv?{"limit":200}')
    const rows = entry?.data as RdvResponse[]
    expect(rows.find((r) => r.id === 'r1')?.status).toBe('honore')
    expect(rows.find((r) => r.id === 'r2')?.status).toBe('planifie')
    // Le cache détail est aussi à jour.
    expect((__testReadFetchCacheEntry('/rdv/r1?{}')?.data as RdvResponse).status).toBe('honore')
    // Un seul appel réseau : le PATCH lui-même.
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('deleteLead retire le lead des listes /leads en cache', async () => {
    const l1 = { id: 'l1', firstName: 'A' } as LeadResponse
    const l2 = { id: 'l2', firstName: 'B' } as LeadResponse
    __testSeedFetchCache('/leads?{"limit":250}', { data: [l1, l2], timestamp: Date.now() })
    __testSeedFetchCache('/leads/l1?{}', { data: l1, timestamp: Date.now() })

    apiMock.mockResolvedValueOnce({ ok: true })
    await deleteLead('l1')

    const rows = __testReadFetchCacheEntry('/leads?{"limit":250}')?.data as LeadResponse[]
    expect(rows.map((l) => l.id)).toEqual(['l2'])
    expect(__testReadFetchCacheEntry('/leads/l1?{}')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `npx vitest run src/lib/hooks.cache-patch.test.tsx`
Expected: FAIL — `updateRdv` ne patche pas (statut reste `planifie`), `deleteLead` ne retire rien.

- [ ] **Step 3: Implémenter les helpers génériques**

Dans `src/lib/hooks.ts`, remplacer `updateLeadInCachedData` + `updateLeadCaches` par la version générique (mêmes emplacements) :

```ts
// Patch générique post-mutation : la réponse du serveur est fusionnée dans
// toutes les entrées de cache du préfixe (listes + détail) — l'UI reflète
// l'action immédiatement, sans attendre un refetch.
function updateEntityInCachedData<T extends { id: string }>(data: unknown, updated: T): unknown {
  if (Array.isArray(data)) {
    let changed = false
    const rows = data.map((item) => {
      if (!item || typeof item !== 'object' || (item as T).id !== updated.id) return item
      changed = true
      return { ...(item as T), ...updated }
    })
    return changed ? rows : data
  }
  if (data && typeof data === 'object' && (data as T).id === updated.id) {
    return { ...(data as T), ...updated }
  }
  return data
}

function patchEntityCaches<T extends { id: string }>(pathPrefix: string, updated: T): void {
  const now = Date.now()
  for (const [cacheKey, entry] of Array.from(fetchCache.entries())) {
    if (!cacheKey.startsWith(`${pathPrefix}?`) && !cacheKey.startsWith(`${pathPrefix}/${updated.id}?`)) continue
    const nextData = updateEntityInCachedData(entry.data, updated)
    if (nextData !== entry.data) writeCache(cacheKey, { data: nextData, timestamp: now })
  }
  writeCache(`${pathPrefix}/${updated.id}?{}`, { data: updated, timestamp: now })
}

// Suppression : retire l'entité des listes du préfixe et purge son cache détail.
function removeEntityFromCaches(pathPrefix: string, id: string): void {
  const now = Date.now()
  for (const [cacheKey, entry] of Array.from(fetchCache.entries())) {
    if (cacheKey.startsWith(`${pathPrefix}/${id}?`)) {
      deleteCache(cacheKey)
      continue
    }
    if (!cacheKey.startsWith(`${pathPrefix}?`) || !Array.isArray(entry.data)) continue
    const rows = (entry.data as Array<{ id?: string }>).filter((item) => item?.id !== id)
    if (rows.length !== (entry.data as unknown[]).length) writeCache(cacheKey, { data: rows, timestamp: now })
  }
}

function updateLeadCaches(updated: LeadResponse) {
  patchEntityCaches('/leads', updated)
}
```

(Les appels existants à `updateLeadCaches` — `createLead`, `updateLead`, etc. — restent inchangés.)

- [ ] **Step 4: Câbler les mutations RDV et la suppression de lead**

Toujours dans `src/lib/hooks.ts` :

`updateRdv` — ajouter le patch avant le notify :

```ts
export async function updateRdv(id: string, input: UpdateRdvPayload): Promise<RdvResponse> {
  const updated = await api<RdvResponse>(`/rdv/${id}`, { method: 'PATCH', body: input })
  patchEntityCaches('/rdv', updated)
  notifyRealtimeRefresh({ event: 'rdv:updated', paths: ['/rdv', '/leads', '/analytics/summary', '/analytics/funnel', '/ghl-calendar/events'] })
  return updated
}
```

`updateGhlAppointment` — patcher avec `updated.rdv` :

```ts
  const updated = await api<{ rdv: RdvResponse; ghl: unknown }>(`/ghl-calendar/appointments/${encodeURIComponent(rdvId)}`, {
    method: 'PATCH',
    body: input,
  })
  patchEntityCaches('/rdv', updated.rdv)
  notifyRealtimeRefresh({ event: 'rdv:updated', paths: ['/rdv', '/leads', '/analytics/summary', '/analytics/funnel', '/ghl-calendar/events'] })
  return updated
```

`createRdv` — aujourd'hui il n'émet AUCUN refresh (les listes attendent l'event socket coalescé, jusqu'à 30 s) :

```ts
export async function createRdv(input: CreateRdvInput): Promise<RdvResponse> {
  const created = await api<RdvResponse>('/rdv', { method: 'POST', body: input })
  patchEntityCaches('/rdv', created)
  // L'insertion en liste dépend du tri serveur : on laisse le refetch immédiat
  // remettre les listes en ordre (le patch couvre déjà le cache détail).
  notifyRealtimeRefresh({ event: 'rdv:new', paths: ['/rdv', '/leads', '/ghl-calendar/events', '/analytics/summary', '/analytics/funnel'] })
  return created
}
```

`deleteLead` — retirer des caches + prévenir les vues montées :

```ts
export async function deleteLead(id: string): Promise<{ ok: true }> {
  const result = await api<{ ok: true }>(`/leads/${id}`, { method: 'DELETE' })
  removeEntityFromCaches('/leads', id)
  notifyRealtimeRefresh({ event: 'lead:deleted', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] })
  return result
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npx vitest run src/lib/hooks.cache-patch.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Suite complète + build**

Run: `npx tsc -b && npm test`
Expected: tout vert. Vigilance particulière sur les tests qui touchent aux leads/RDV (`hooks.realtime-refresh.test.tsx`, tests de pages) — le refactor `updateLeadCaches` doit être iso-comportement.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hooks.ts src/lib/hooks.cache-patch.test.tsx
git commit -m "feat(cache): patchs post-mutation généralisés — RDV et suppressions reflétés sans attendre le refetch"
```

---

### Task 5: Validation de bout en bout

**Files:** aucun nouveau — vérification.

- [ ] **Step 1: Suite complète + build de prod**

```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npm test && npx tsc -b && npm run build
```

Expected: tests verts, build Vite OK. (Rappel : Vite exige Node 22 sur ce projet.)

- [ ] **Step 2: Vérification manuelle dans le navigateur (dev server)**

Lancer `npm run dev` et vérifier, connecté en admin :
1. Naviguer Overview → Leads → Suivi → Client → Finances **dès le login** : grâce au prefetch, aucune page ne doit montrer un loader plein écran après quelques secondes de session.
2. Recharger l'app (F5) : les pages déjà visitées peignent leurs données immédiatement (hydratation IndexedDB), puis se rafraîchissent en fond.
3. Attendre 10 min (ou modifier temporairement `FETCH_CACHE_TTL_MS` à 10 s) et revisiter une page : la donnée s'affiche instantanément, pas de loader.
4. Modifier un RDV (statut/débrief) : la liste RDV et le calendrier reflètent le changement immédiatement.
5. Se déconnecter puis rouvrir DevTools → Application → IndexedDB : `velora-cache` doit être vide.

- [ ] **Step 3: État git propre**

```bash
git status --short
```

Expected: seuls les fichiers WIP de l'autre session restent non commités (`src/lib/api.ts`, `src/components/suivi/NewClientModal*`). Ne PAS les toucher.
