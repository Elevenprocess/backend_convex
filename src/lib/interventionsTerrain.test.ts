import { describe, it, expect } from 'vitest'
import { buildTerrainInterventions } from './interventionsTerrain'
import type { ClientResponse, ClientPhaseStep, WorkflowStatus } from './types'

function step(status: WorkflowStatus, datePlanifiee: string | null = null, dateRealisee: string | null = null): ClientPhaseStep {
  return { status, datePlanifiee, dateRealisee, problemReason: null, responsableId: null }
}

function client(over: Partial<ClientResponse>): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', projectId: null, rdvId: null,
    lead: { fullName: 'Aline Bee', city: 'Saint-Denis', phone: null },
    technicienVtId: 't1', techniciens: [], poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'vt_a_faire', currentPhase: 'vt', blocked: false, signedAt: null,
    missingDocsCount: 0,
    steps: {}, ...over,
  }
}

describe('buildTerrainInterventions', () => {
  it('mappe les statuts étape → statut intervention (fait→réalisée, probleme→à refaire, daté→planifiée)', () => {
    const rows = buildTerrainInterventions([
      client({ steps: {
        vt: step('fait', '2026-06-10', '2026-06-11'),
        installation: step('planifie', '2026-06-20'),
      } }),
      client({ id: 'c2', leadId: 'l2', steps: { vt: step('probleme', '2026-06-05') } }),
    ])
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.id === 'c1:vt')).toMatchObject({ status: 'realisee', date: '2026-06-11', type: 'vt' })
    expect(rows.find((r) => r.id === 'c1:installation')).toMatchObject({ status: 'planifiee', date: '2026-06-20' })
    expect(rows.find((r) => r.id === 'c2:vt')).toMatchObject({ status: 'a_refaire' })
  })

  it('ignore les étapes non datées non faites, les annulées et les absentes', () => {
    const rows = buildTerrainInterventions([
      client({ steps: {
        vt: step('a_faire'),
        installation: step('annule', '2026-06-20'),
      } }),
    ])
    expect(rows).toHaveLength(0)
  })

  it('résout les techniciens : liste VT du dossier, chef de pose via usersById', () => {
    const rows = buildTerrainInterventions(
      [client({
        techniciens: [{ id: 't1', name: 'Théo' }, { id: 't2', name: 'Sam' }],
        poseTeamLeadId: 'u9',
        steps: { vt: step('planifie', '2026-06-10'), installation: step('planifie', '2026-06-20') },
      })],
      new Map([['u9', 'Paul Pose']]),
    )
    expect(rows.find((r) => r.type === 'vt')?.technicienNames).toEqual(['Théo', 'Sam'])
    expect(rows.find((r) => r.type === 'installation')?.technicienNames).toEqual(['Paul Pose'])
  })

  it('trie par date décroissante, dates absentes en queue', () => {
    const rows = buildTerrainInterventions([
      client({ id: 'c1', steps: { vt: step('planifie', '2026-06-01') } }),
      client({ id: 'c2', leadId: 'l2', steps: { vt: step('fait', null, null) } }),
      client({ id: 'c3', leadId: 'l3', steps: { installation: step('planifie', '2026-07-01') } }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['c3:installation', 'c1:vt', 'c2:vt'])
  })
})
