import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRealtimeRefreshCoalescer } from './realtimeRefreshQueue'
import type { RealtimeRefreshPayload } from './realtime'

describe('createRealtimeRefreshCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('laisse passer le premier event immédiatement (leading edge)', () => {
    const emitted: RealtimeRefreshPayload[] = []
    const schedule = createRealtimeRefreshCoalescer((p) => emitted.push(p), 30_000)

    schedule({ event: 'lead:new', paths: ['/leads'] })

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toEqual({ event: 'lead:new', paths: ['/leads'] })
  })

  it('coalesce les events suivants dans la fenêtre en un seul flush trailing', () => {
    const emitted: RealtimeRefreshPayload[] = []
    const schedule = createRealtimeRefreshCoalescer((p) => emitted.push(p), 30_000)

    schedule({ event: 'lead:new', paths: ['/leads', '/analytics/summary'] })
    schedule({ event: 'call-log:new', paths: ['/call-logs', '/leads'] })
    schedule({ event: 'rdv:new', paths: ['/rdv', '/leads'] })
    expect(emitted).toHaveLength(1)

    vi.advanceTimersByTime(30_000)

    expect(emitted).toHaveLength(2)
    expect(emitted[1].paths.sort()).toEqual(['/call-logs', '/leads', '/rdv'])
  })

  it("n'émet rien au bout de la fenêtre si aucun event n'est arrivé pendant", () => {
    const emitted: RealtimeRefreshPayload[] = []
    const schedule = createRealtimeRefreshCoalescer((p) => emitted.push(p), 30_000)

    schedule({ event: 'lead:new', paths: ['/leads'] })
    vi.advanceTimersByTime(30_000)

    expect(emitted).toHaveLength(1)
  })

  it('redevient leading après une fenêtre calme', () => {
    const emitted: RealtimeRefreshPayload[] = []
    const schedule = createRealtimeRefreshCoalescer((p) => emitted.push(p), 30_000)

    schedule({ event: 'lead:new', paths: ['/leads'] })
    vi.advanceTimersByTime(30_000)
    schedule({ event: 'rdv:new', paths: ['/rdv'] })

    expect(emitted).toHaveLength(2)
    expect(emitted[1]).toEqual({ event: 'rdv:new', paths: ['/rdv'] })
  })

  it('un flush trailing rouvre une fenêtre de cooldown (pas de rafale après flush)', () => {
    const emitted: RealtimeRefreshPayload[] = []
    const schedule = createRealtimeRefreshCoalescer((p) => emitted.push(p), 30_000)

    schedule({ event: 'lead:new', paths: ['/leads'] })
    schedule({ event: 'call-log:new', paths: ['/call-logs'] })
    vi.advanceTimersByTime(30_000) // flush trailing → 2 émissions
    schedule({ event: 'rdv:new', paths: ['/rdv'] }) // toujours en cooldown → coalescé

    expect(emitted).toHaveLength(2)

    vi.advanceTimersByTime(30_000)
    expect(emitted).toHaveLength(3)
    expect(emitted[2].paths).toEqual(['/rdv'])
  })
})
