import { describe, it, expect } from 'vitest'
import { filterAcomptesByEncaissementDate } from './financesFilters'
import type { AcompteResponse } from './types'

function makeRow(overrides: Partial<AcompteResponse> = {}): AcompteResponse {
  return {
    debriefId: 'test-id',
    leadId: null,
    projectId: null,
    projectName: null,
    clientName: null,
    commercialName: null,
    montantTotal: null,
    financingType: null,
    paymentSubMethod: null,
    financingOrg: null,
    acomptePercent: null,
    acompteAmount: null,
    customEcheancier: false,
    signedAt: null,
    edfRecepisse: false,
    echeances: [],
    totalEncaisse: null,
    resteAPayer: null,
    ...overrides,
  }
}

const rowWithEncaissement = (date: string): AcompteResponse =>
  makeRow({
    echeances: [{
      ordre: 1,
      label: 'Tranche 1',
      jalonKey: null,
      jalonAtteint: false,
      percent: 40,
      montantPrevu: '4800',
      statut: 'encaisse',
      montantReel: '4800',
      dateEcheance: null,
      dateEncaissement: date,
      notes: null,
      recordedById: null,
      updatedAt: null,
    }],
  })

describe('filterAcomptesByEncaissementDate', () => {
  it('retourne tout si from et to sont null', () => {
    const rows = [rowWithEncaissement('2026-01-15'), makeRow()]
    expect(filterAcomptesByEncaissementDate(rows, null, null)).toHaveLength(2)
  })

  it('filtre par borne inférieure (from)', () => {
    const rows = [rowWithEncaissement('2026-01-10'), rowWithEncaissement('2026-02-01')]
    const result = filterAcomptesByEncaissementDate(rows, '2026-01-15', null)
    expect(result).toHaveLength(1)
    expect(result[0].echeances[0].dateEncaissement).toBe('2026-02-01')
  })

  it('filtre par borne supérieure (to)', () => {
    const rows = [rowWithEncaissement('2026-01-10'), rowWithEncaissement('2026-02-01')]
    const result = filterAcomptesByEncaissementDate(rows, null, '2026-01-31')
    expect(result).toHaveLength(1)
    expect(result[0].echeances[0].dateEncaissement).toBe('2026-01-10')
  })

  it('conserve une vente si au moins une tranche encaissée est dans la plage', () => {
    const row = makeRow({
      echeances: [
        { ordre: 1, label: 'T1', jalonKey: null, jalonAtteint: false, percent: 40, montantPrevu: '4000', statut: 'encaisse', montantReel: '4000', dateEcheance: null, dateEncaissement: '2026-01-05', notes: null, recordedById: null, updatedAt: null },
        { ordre: 2, label: 'T2', jalonKey: null, jalonAtteint: false, percent: 60, montantPrevu: '6000', statut: 'encaisse', montantReel: '6000', dateEcheance: null, dateEncaissement: '2026-03-10', notes: null, recordedById: null, updatedAt: null },
      ],
    })
    // T1 est hors plage, T2 est dans la plage → la vente est conservée
    const result = filterAcomptesByEncaissementDate([row], '2026-02-01', '2026-04-30')
    expect(result).toHaveLength(1)
  })

  it('exclut les ventes sans tranche encaissée dans la plage', () => {
    const rows = [
      makeRow({ echeances: [] }),
      makeRow({ echeances: [{ ordre: 1, label: 'T1', jalonKey: null, jalonAtteint: false, percent: 100, montantPrevu: '10000', statut: 'en_attente', montantReel: null, dateEcheance: '2026-03-01', dateEncaissement: null, notes: null, recordedById: null, updatedAt: null }] }),
    ]
    expect(filterAcomptesByEncaissementDate(rows, '2026-01-01', '2026-12-31')).toHaveLength(0)
  })

  it('est inclusif aux deux bornes', () => {
    const rows = [rowWithEncaissement('2026-01-01'), rowWithEncaissement('2026-01-31')]
    const result = filterAcomptesByEncaissementDate(rows, '2026-01-01', '2026-01-31')
    expect(result).toHaveLength(2)
  })
})
