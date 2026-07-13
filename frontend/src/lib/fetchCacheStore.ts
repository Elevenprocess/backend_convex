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
