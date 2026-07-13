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
    // totalPlanned = 4000 (T1 encaisse) + 6000 (T2 en_attente) = 10000
    // après Jan : cumulEncaisse=4000, resteTotal = 10000 - 4000 = 6000
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
    // resteTotal doit être décroissant : totalPlanned(10000) - cumulEncaisse(4000) = 6000
    expect(series[0].resteTotal).toBe(6000)
  })

  it('calcule le cumul croissant et le reste décroissant sur plusieurs mois', () => {
    // totalPlanned = 3000 + 2000 = 5000 ; tout encaissé
    // Jan : cumulEncaisse=3000, resteTotal=5000-3000=2000
    // Fév : cumulEncaisse=5000, resteTotal=5000-5000=0
    const rows = [
      makeRow({
        resteAPayer: '0',
        echeances: [
          { ordre: 1, label: 'T1', jalonKey: null, jalonAtteint: false, percent: 40, montantPrevu: '3000', statut: 'encaisse', montantReel: '3000', dateEcheance: null, dateEncaissement: '2026-01-10', notes: null, recordedById: null, updatedAt: null },
          { ordre: 2, label: 'T2', jalonKey: null, jalonAtteint: false, percent: 60, montantPrevu: '2000', statut: 'encaisse', montantReel: '2000', dateEcheance: null, dateEncaissement: '2026-02-20', notes: null, recordedById: null, updatedAt: null },
        ],
      }),
    ]
    const series = buildEncaissementSeries(rows)
    expect(series).toHaveLength(2)
    expect(series[0]).toMatchObject({ month: '2026-01', cumulEncaisse: 3000, resteTotal: 2000 })
    expect(series[1]).toMatchObject({ month: '2026-02', cumulEncaisse: 5000, resteTotal: 0 })
    // resteTotal décroît bien mois après mois
    expect(series[1].resteTotal).toBeLessThan(series[0].resteTotal)
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
    // totalPlanned = 1000 + 2500 = 3500, tout encaissé en mars
    const rows = [encaissement('2026-03-01', '1000'), encaissement('2026-03-28', '2500')]
    const series = buildEncaissementSeries(rows)
    expect(series).toHaveLength(1)
    expect(series[0].cumulEncaisse).toBe(3500)
    // tout encaissé → reste = 0
    expect(series[0].resteTotal).toBe(0)
  })

  it('les points sont triés chronologiquement et le reste décroît', () => {
    // totalPlanned = 5000 + 5000 = 10000 (toutes encaissées)
    // Jan : cumulEncaisse=5000, resteTotal=5000
    // Mar : cumulEncaisse=10000, resteTotal=0
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
    // cumul croissant
    expect(series[0].cumulEncaisse).toBe(5000)
    expect(series[1].cumulEncaisse).toBe(10000)
    // reste décroissant
    expect(series[0].resteTotal).toBe(5000)
    expect(series[1].resteTotal).toBe(0)
  })
})
