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
