import { describe, expect, it } from 'vitest'
import { isRelanceCourtTerme, isRetourSettersActive } from './leadRetour'
import type { LeadResponse } from './types'

const lead = (over: Partial<LeadResponse>): LeadResponse =>
  ({ status: 'pas_de_reponse', retourSetters: { at: '2026-08-27T10:00:00.000Z', fromStage: '5. RDV Planifié 📅', fromStatus: 'rdv_pris' }, ...over }) as LeadResponse

describe('isRetourSettersActive', () => {
  it('sans marqueur → false', () => {
    expect(isRetourSettersActive(lead({ retourSetters: null }))).toBe(false)
  })
  it('actif sur les statuts setters (sans réponse, à rappeler, nouveau, perdu…)', () => {
    for (const status of ['pas_de_reponse', 'a_rappeler', 'relance', 'nouveau', 'perdu', 'pas_qualifie'] as const) {
      expect(isRetourSettersActive(lead({ status }))).toBe(true)
    }
  })
  it('inactif dès que le lead est repris (qualifié / RDV / signature)', () => {
    for (const status of ['qualifie', 'rdv_pris', 'rdv_honore', 'signature_en_cours', 'signe'] as const) {
      expect(isRetourSettersActive(lead({ status }))).toBe(false)
    }
  })
})

describe('isRelanceCourtTerme', () => {
  const now = Date.parse('2026-09-28T08:00:00.000Z')
  const sansMarqueur = (over: Partial<LeadResponse>) => lead({ retourSetters: null, latestRdvStatus: null, latestRdvAt: null, ...over })

  it('retour aux setters actif → relance court terme (sauf perdu / non qualifié)', () => {
    expect(isRelanceCourtTerme(lead({}), now)).toBe(true)
    expect(isRelanceCourtTerme(lead({ status: 'a_rappeler' }), now)).toBe(true)
    expect(isRelanceCourtTerme(lead({ status: 'perdu' }), now)).toBe(false)
    expect(isRelanceCourtTerme(lead({ status: 'pas_qualifie' }), now)).toBe(false)
  })
  it('sans réponse après un RDV honoré / non honoré / reporté → relance court terme', () => {
    for (const latestRdvStatus of ['honore', 'no_show', 'reporte'] as const) {
      expect(isRelanceCourtTerme(sansMarqueur({ latestRdvStatus, latestRdvAt: '2026-07-30T06:00:00.000Z' }), now)).toBe(true)
    }
  })
  it('RDV planifié déjà passé → compte comme vu ; planifié à venir → non', () => {
    expect(isRelanceCourtTerme(sansMarqueur({ latestRdvStatus: 'planifie', latestRdvAt: '2026-09-20T06:00:00.000Z' }), now)).toBe(true)
    expect(isRelanceCourtTerme(sansMarqueur({ latestRdvStatus: 'planifie', latestRdvAt: '2026-10-02T06:00:00.000Z' }), now)).toBe(false)
  })
  it('RDV annulé ou aucun RDV → reste « Sans réponse »', () => {
    expect(isRelanceCourtTerme(sansMarqueur({ latestRdvStatus: 'annule', latestRdvAt: '2026-07-30T06:00:00.000Z' }), now)).toBe(false)
    expect(isRelanceCourtTerme(sansMarqueur({}), now)).toBe(false)
  })
  it('RDV passé mais statut autre que sans réponse → pas concerné', () => {
    expect(isRelanceCourtTerme(sansMarqueur({ status: 'a_rappeler', latestRdvStatus: 'honore', latestRdvAt: '2026-07-30T06:00:00.000Z' }), now)).toBe(false)
    expect(isRelanceCourtTerme(sansMarqueur({ status: 'perdu', latestRdvStatus: 'honore', latestRdvAt: '2026-07-30T06:00:00.000Z' }), now)).toBe(false)
  })
})
