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
