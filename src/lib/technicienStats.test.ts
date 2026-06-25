import { describe, it, expect } from 'vitest'
import {
  computeTechnicienStats,
  computeTerrainPipeline,
  selectUnassignedVt,
  computeMonthlyTerrain,
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
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-10', dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't2', steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
    ]
    const [stat] = computeTechnicienStats(clients, [t], { from: NOW, to: NOW }, NOW)
    expect(stat.chargeEnCours).toBe(2)
  })

  it('compte les VT en retard (planifiée, date passée) ou en problème', () => {
    const t = user('t1', 'Alice')
    const clients = [
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-01', dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-10', dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'probleme', datePlanifiee: null, dateRealisee: null, problemReason: 'vt_client_absent', responsableId: null } } }),
    ]
    const [stat] = computeTechnicienStats(clients, [t], { from: NOW, to: NOW }, NOW)
    expect(stat.retardOuProbleme).toBe(2)
  })

  it('compte les VT réalisées dans la période et le taux de validation', () => {
    const t = user('t1', 'Alice')
    const periode = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59Z') }
    const clients = [
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-05', problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'probleme', datePlanifiee: null, dateRealisee: '2026-06-06', problemReason: 'vt_a_refaire', responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-05-01', problemReason: null, responsableId: null } } }),
    ]
    const [stat] = computeTechnicienStats(clients, [t], periode, NOW)
    expect(stat.realiseesPeriode).toBe(1)
    expect(stat.tauxValidation).toBe(50)
  })
})

describe('computeTerrainPipeline', () => {
  it('compte les dossiers par stade VT et Installation', () => {
    const clients = [
      dossier({ steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null, responsableId: null }, installation: { status: 'planifie', datePlanifiee: '2026-06-20', dateRealisee: null, problemReason: null, responsableId: null } } }),
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
      dossier({ technicienVtId: null, steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: 't1', steps: { vt: { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      dossier({ technicienVtId: null, steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null, responsableId: null } } }),
    ]
    expect(selectUnassignedVt(clients)).toHaveLength(1)
  })
})

describe('REFUS_VT_REASONS', () => {
  it('contient les motifs de refus de VT', () => {
    expect(REFUS_VT_REASONS).toEqual(['vt_a_refaire', 'vt_invalide', 'vt_anomalie_structurelle'])
  })
})

describe('computeMonthlyTerrain', () => {
  it('retourne un tableau vide si aucun dossier', () => {
    expect(computeMonthlyTerrain([])).toEqual([])
  })

  it('ignore les VT fait avec dateRealisee null', () => {
    const clients = [
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
    ]
    expect(computeMonthlyTerrain(clients)).toEqual([])
  })

  it('ignore les installations fait avec dateRealisee null', () => {
    const clients = [
      dossier({ steps: { installation: { status: 'fait', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
    ]
    expect(computeMonthlyTerrain(clients)).toEqual([])
  })

  it('agrège plusieurs VT du même mois', () => {
    const clients = [
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-04-10', problemReason: null, responsableId: null } } }),
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-04-22', problemReason: null, responsableId: null } } }),
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-05-03', problemReason: null, responsableId: null } } }),
    ]
    const result = computeMonthlyTerrain(clients)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ month: '2026-04', vtCount: 2, installCount: 0 })
    expect(result[1]).toEqual({ month: '2026-05', vtCount: 1, installCount: 0 })
  })

  it('agrège VT et installations indépendamment sur le même mois', () => {
    const clients = [
      dossier({ steps: {
        vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-03-15', problemReason: null, responsableId: null },
        installation: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-03-20', problemReason: null, responsableId: null },
      } }),
    ]
    const [pt] = computeMonthlyTerrain(clients)
    expect(pt).toEqual({ month: '2026-03', vtCount: 1, installCount: 1 })
  })

  it('trie les mois chronologiquement', () => {
    const clients = [
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-06-01', problemReason: null, responsableId: null } } }),
      dossier({ steps: { installation: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-01-05', problemReason: null, responsableId: null } } }),
      dossier({ steps: { vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-03-20', problemReason: null, responsableId: null } } }),
    ]
    const result = computeMonthlyTerrain(clients)
    expect(result.map((r) => r.month)).toEqual(['2026-01', '2026-03', '2026-06'])
  })

  it('n\'inclut que les étapes avec status fait (ignore planifie, probleme)', () => {
    const clients = [
      dossier({ steps: {
        vt: { status: 'planifie', datePlanifiee: '2026-05-10', dateRealisee: null, problemReason: null, responsableId: null },
        installation: { status: 'probleme', datePlanifiee: null, dateRealisee: '2026-05-15', problemReason: 'xxx', responsableId: null },
      } }),
      dossier({ steps: {
        vt: { status: 'fait', datePlanifiee: null, dateRealisee: '2026-05-20', problemReason: null, responsableId: null },
      } }),
    ]
    const result = computeMonthlyTerrain(clients)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ month: '2026-05', vtCount: 1, installCount: 0 })
  })
})
