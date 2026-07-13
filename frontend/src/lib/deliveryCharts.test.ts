import { describe, it, expect } from 'vitest'
import type { ClientPhaseStep, ClientResponse, WorkflowPhase } from './types'
import { currentPhaseDistribution, deliveriesByMonth, PHASE_COLOR } from './deliveryCharts'

const NOW = new Date('2026-06-15T12:00:00Z')

function step(partial: Partial<ClientPhaseStep>): ClientPhaseStep {
  return { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null, ...partial }
}

function client(partial: Partial<ClientResponse> & { currentPhase: WorkflowPhase }): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', rdvId: null,
    lead: { fullName: 'Test', city: 'Lyon', phone: null },
    technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'en_cours', blocked: false, missingDocsCount: 0,
    signedAt: '2026-06-05', steps: {}, ...partial,
  } as ClientResponse
}

describe('currentPhaseDistribution', () => {
  it('compte les dossiers par phase courante, non cumulatif', () => {
    const rows = currentPhaseDistribution([
      client({ currentPhase: 'vt' }),
      client({ currentPhase: 'racco' }),
      client({ currentPhase: 'racco' }),
    ])
    const by = Object.fromEntries(rows.map((r) => [r.phase, r.count]))
    expect(by.vt).toBe(1)
    expect(by.racco).toBe(2)
    expect(by.installation).toBe(0)
  })

  it('exclut les dossiers annulés / clôturés', () => {
    const rows = currentPhaseDistribution([
      client({ currentPhase: 'mes', statusGlobal: 'cloture' }),
      client({ currentPhase: 'vt', statusGlobal: 'annule' }),
      client({ currentPhase: 'vt' }),
    ])
    const by = Object.fromEntries(rows.map((r) => [r.phase, r.count]))
    expect(by.vt).toBe(1)
    expect(by.mes).toBe(0)
  })

  it('renvoie les 6 phases dans l’ordre avec une couleur', () => {
    const rows = currentPhaseDistribution([])
    expect(rows.map((r) => r.phase)).toEqual(['vt', 'dp', 'racco', 'installation', 'consuel', 'mes'])
    expect(rows.every((r) => r.color === PHASE_COLOR[r.phase])).toBe(true)
  })
})

describe('deliveriesByMonth', () => {
  it('bucketise installations et mises en service sur les N derniers mois', () => {
    const clients = [
      client({ currentPhase: 'mes', steps: { installation: step({ dateRealisee: '2026-05-10' }), mes: step({ dateRealisee: '2026-06-02' }) } }),
      client({ currentPhase: 'installation', steps: { installation: step({ dateRealisee: '2026-06-20' }) } }),
    ]
    const series = deliveriesByMonth(clients, 3, NOW)
    expect(series).toHaveLength(3)
    expect(series.map((s) => s.month)).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(series[1]).toMatchObject({ installed: 1, delivered: 0 }) // mai
    expect(series[2]).toMatchObject({ installed: 1, delivered: 1 }) // juin
  })

  it('ignore les réalisations hors fenêtre et les dates invalides', () => {
    const clients = [
      client({ currentPhase: 'mes', steps: { mes: step({ dateRealisee: '2025-01-01' }) } }),
      client({ currentPhase: 'vt', steps: { installation: step({ dateRealisee: 'pas-une-date' }) } }),
    ]
    const series = deliveriesByMonth(clients, 3, NOW)
    expect(series.every((s) => s.installed === 0 && s.delivered === 0)).toBe(true)
  })
})
