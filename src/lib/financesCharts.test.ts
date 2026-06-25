import { describe, it, expect } from 'vitest'
import { buildEncaissementSeries } from './financesCharts'
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

describe('buildEncaissementSeries', () => {
  it('retourne [] si aucune tranche encaissée', () => {
    const rows = [makeRow()]
    expect(buildEncaissementSeries(rows)).toEqual([])
  })

  it('retourne un point par mois unique', () => {
    const rows = [
      makeRow({
        resteAPayer: '6000',
        echeances: [
          { ordre: 1, label: 'T1', jalonKey: null, jalonAtteint: false, percent: 40, montantPrevu: '4000', statut: 'encaisse', montantReel: '4000', dateEcheance: null, dateEncaissement: '2026-01-15', notes: null, recordedById: null, updatedAt: null },
          { ordre: 2, label: 'T2', jalonKey: null, jalonAtteint: false, percent: 60, montantPrevu: '6000', statut: 'en_attente', montantReel: null, dateEcheance: '2026-03-01', dateEncaissement: null, notes: null, recordedById: null, updatedAt: null },
        ],
      }),
    ]
    const series = buildEncaissementSeries(rows)
    expect(series).toHaveLength(1)
    expect(series[0].month).toBe('2026-01')
    expect(series[0].cumulEncaisse).toBe(4000)
    expect(series[0].resteTotal).toBe(6000)
  })

  it('calcule le cumul croissant sur plusieurs mois', () => {
    const rows = [
      makeRow({
        resteAPayer: '5000',
        echeances: [
          { ordre: 1, label: 'T1', jalonKey: null, jalonAtteint: false, percent: 40, montantPrevu: '3000', statut: 'encaisse', montantReel: '3000', dateEcheance: null, dateEncaissement: '2026-01-10', notes: null, recordedById: null, updatedAt: null },
          { ordre: 2, label: 'T2', jalonKey: null, jalonAtteint: false, percent: 60, montantPrevu: '2000', statut: 'encaisse', montantReel: '2000', dateEcheance: null, dateEncaissement: '2026-02-20', notes: null, recordedById: null, updatedAt: null },
        ],
      }),
    ]
    const series = buildEncaissementSeries(rows)
    expect(series).toHaveLength(2)
    expect(series[0]).toMatchObject({ month: '2026-01', cumulEncaisse: 3000 })
    expect(series[1]).toMatchObject({ month: '2026-02', cumulEncaisse: 5000 })
  })

  it('agrège plusieurs ventes dans le même mois', () => {
    const encaissement = (date: string, montant: string): AcompteResponse =>
      makeRow({
        resteAPayer: '0',
        echeances: [{
          ordre: 1, label: 'T', jalonKey: null, jalonAtteint: false, percent: 100,
          montantPrevu: montant, statut: 'encaisse', montantReel: montant,
          dateEcheance: null, dateEncaissement: date,
          notes: null, recordedById: null, updatedAt: null,
        }],
      })
    const rows = [encaissement('2026-03-01', '1000'), encaissement('2026-03-28', '2500')]
    const series = buildEncaissementSeries(rows)
    expect(series).toHaveLength(1)
    expect(series[0].cumulEncaisse).toBe(3500)
  })

  it('les points sont triés chronologiquement', () => {
    const rows = [
      makeRow({
        resteAPayer: '0',
        echeances: [
          { ordre: 1, label: 'T1', jalonKey: null, jalonAtteint: false, percent: 50, montantPrevu: '5000', statut: 'encaisse', montantReel: '5000', dateEcheance: null, dateEncaissement: '2026-03-01', notes: null, recordedById: null, updatedAt: null },
          { ordre: 2, label: 'T2', jalonKey: null, jalonAtteint: false, percent: 50, montantPrevu: '5000', statut: 'encaisse', montantReel: '5000', dateEcheance: null, dateEncaissement: '2026-01-15', notes: null, recordedById: null, updatedAt: null },
        ],
      }),
    ]
    const series = buildEncaissementSeries(rows)
    expect(series[0].month).toBe('2026-01')
    expect(series[1].month).toBe('2026-03')
    // cumul = 5000 en jan puis 10000 en mar
    expect(series[1].cumulEncaisse).toBe(10000)
  })
})
