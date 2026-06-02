import { describe, it, expect } from 'vitest'
import {
  computeTechnicienStats,
  computeTerrainPipeline,
  selectUnassignedVt,
  REFUS_VT_REASONS,
} from './technicienStats'
import type { ClientResponse, UserResponse } from './types'

const user = (id: string, name: string): UserResponse =>
  ({ id, name, role: 'technicien' } as UserResponse)

const dossier = (over: Partial<ClientResponse> & { steps: ClientResponse['steps'] }): ClientResponse =>
  ({
    id: Math.random().toString(36).slice(2),
    leadId: 'l', rdvId: null,
    lead: { fullName: 'X', city: 'Y', phone: null },
    technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'nouveau', currentPhase: 'vt', blocked: false, signedAt: null,
    ...over,
  } as ClientResponse)

const NOW = new Date('2026-06-02T12:00:00Z')

describe('computeTechnicienStats', () => {
  it('compte la charge VT en cours (a_faire/planifie/en_cours) du technicien', () => {
    const t = user('t1', 'Alice')
    const clients = [
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-10', dateRealisee: null, problemReason: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null } } }),
      dossier({ technicienVtId: 't2', steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null } } }),
    ]
    const [stat] = computeTechnicienStats(clients, [t], { from: NOW, to: NOW }, NOW)
    expect(stat.chargeEnCours).toBe(2)
  })

  it('compte les VT en retard (planifiée, date passée) ou en problème', () => {
    const t = user('t1', 'Alice')
    const clients = [
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-01', dateRealisee: null, problemReason: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-10', dateRealisee: null, problemReason: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'probleme', datePlanifiee: null, dateRealisee: null, problemReason: 'vt_client_absent' } } }),
    ]
    const [stat] = computeTechnicienStats(clients, [t], { from: NOW, to: NOW }, NOW)
    expect(stat.retardOuProbleme).toBe(2)
  })

  it('compte les VT réalisées dans la période et le taux de validation', () => {
    const t = user('t1', 'Alice')
    const periode = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') }
    const clients = [
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-05', problemReason: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'probleme', datePlanifiee: null, dateRealisee: '2026-06-06', problemReason: 'vt_a_refaire' } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-05-01', problemReason: null } } }),
    ]
    const [stat] = computeTechnicienStats(clients, [t], periode, NOW)
    expect(stat.realiseesPeriode).toBe(1)
    expect(stat.tauxValidation).toBe(50)
  })
})

describe('computeTerrainPipeline', () => {
  it('compte les dossiers par stade VT et Installation', () => {
    const clients = [
      dossier({ steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null } } }),
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null }, installation: { status: 'planifie', datePlanifiee: '2026-06-20', dateRealisee: null, problemReason: null } } }),
    ]
    const pipe = computeTerrainPipeline(clients)
    expect(pipe.vt.a_faire).toBe(1)
    expect(pipe.vt.fait).toBe(1)
    expect(pipe.installation.planifie).toBe(1)
  })
})

describe('selectUnassignedVt', () => {
  it('renvoie les dossiers sans technicien dont la VT n\'est pas terminée', () => {
    const clients = [
      dossier({ technicienVtId: null, steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null } } }),
      dossier({ technicienVtId: null, steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null } } }),
    ]
    expect(selectUnassignedVt(clients)).toHaveLength(1)
  })
})

describe('REFUS_VT_REASONS', () => {
  it('contient les motifs de refus de VT', () => {
    expect(REFUS_VT_REASONS).toEqual(['vt_a_refaire', 'vt_invalide', 'vt_anomalie_structurelle'])
  })
})
