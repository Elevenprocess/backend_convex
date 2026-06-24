import { describe, it, expect } from 'vitest'
import { buildTechnicienEvents } from './technicienCalendar'
import type { ClientResponse } from './types'

function client(over: Partial<ClientResponse>): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', projectId: null, rdvId: null,
    lead: { fullName: 'Aline Bee', city: 'Saint-Denis', phone: null },
    technicienVtId: 't1', poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'vt_a_faire', currentPhase: 'vt', blocked: false, signedAt: null,
    missingDocsCount: 0,
    steps: {}, ...over,
  }
}

describe('buildTechnicienEvents', () => {
  it('produit un événement VT et un événement installation datés', () => {
    const events = buildTechnicienEvents([
      client({ steps: {
        vt: { status: 'planifie', datePlanifiee: '2026-06-10', dateRealisee: null, problemReason: null, responsableId: null },
        installation: { status: 'a_faire', datePlanifiee: '2026-06-20', dateRealisee: null, problemReason: null, responsableId: null },
      } }),
    ])
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ date: '2026-06-10', type: 'vt', clientName: 'Aline Bee' })
    expect(events[1]).toMatchObject({ date: '2026-06-20', type: 'installation' })
  })

  it('ignore les phases sans date planifiée', () => {
    const events = buildTechnicienEvents([
      client({ steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
    ])
    expect(events).toHaveLength(0)
  })

  it('trie par date croissante', () => {
    const events = buildTechnicienEvents([
      client({ id: 'c2', steps: { installation: { status: 'a_faire', datePlanifiee: '2026-07-01', dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ id: 'c1', steps: { vt: { status: 'a_faire', datePlanifiee: '2026-06-01', dateRealisee: null, problemReason: null, responsableId: null } } }),
    ])
    expect(events.map((e) => e.date)).toEqual(['2026-06-01', '2026-07-01'])
  })
})
