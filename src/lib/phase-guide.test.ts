import { describe, it, expect } from 'vitest'
import { PHASE_GUIDE, nextActionLabel } from './phase-guide'
import { DELIVERY_PHASES } from './deliveryOverview'
import type { ClientResponse, WorkflowPhase } from './types'

function makeClient(over: Partial<ClientResponse> = {}): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', projectId: null, rdvId: null,
    lead: { fullName: 'Jean Test', city: 'Pau', phone: null },
    technicienVtId: null, techniciens: [], poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'actif', currentPhase: 'vt', blocked: false, missingDocsCount: 0,
    signedAt: null, steps: {},
    ...over,
  }
}

describe('PHASE_GUIDE', () => {
  it('couvre les 6 phases avec un contenu complet', () => {
    for (const phase of DELIVERY_PHASES) {
      const g = PHASE_GUIDE[phase]
      expect(g, phase).toBeDefined()
      expect(g.objectif.length, `${phase}.objectif`).toBeGreaterThan(10)
      expect(g.cloture.length, `${phase}.cloture`).toBeGreaterThan(5)
      expect(g.action.length, `${phase}.action`).toBeGreaterThan(5)
    }
  })

  it('chaîne les phases dans l\'ordre du pipeline (vt → … → mes → null)', () => {
    const chain: WorkflowPhase[] = ['vt']
    while (chain.length < 10) {
      const next = PHASE_GUIDE[chain[chain.length - 1]].suivante
      if (next == null) break
      chain.push(next)
    }
    expect(chain).toEqual(DELIVERY_PHASES)
  })
})

describe('nextActionLabel', () => {
  it('bloqué → « Débloquer — <phase> »', () => {
    const row = { client: makeClient({ currentPhase: 'racco', blocked: true }), reason: 'blocked' as const, lateSince: null }
    expect(nextActionLabel(row)).toBe('Débloquer — Raccordement')
  })

  it('docs manquants → « Compléter N document(s) » (singulier/pluriel)', () => {
    const one = { client: makeClient({ missingDocsCount: 1 }), reason: 'missing_docs' as const, lateSince: null }
    const three = { client: makeClient({ missingDocsCount: 3 }), reason: 'missing_docs' as const, lateSince: null }
    expect(nextActionLabel(one)).toBe('Compléter 1 document')
    expect(nextActionLabel(three)).toBe('Compléter 3 documents')
  })

  it('retard → action du guide pour la phase courante', () => {
    const row = { client: makeClient({ currentPhase: 'consuel' }), reason: 'late' as const, lateSince: Date.now() }
    expect(nextActionLabel(row)).toBe(PHASE_GUIDE.consuel.action)
  })
})
