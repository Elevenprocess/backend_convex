import { describe, expect, it } from 'vitest'
import { isRetourSettersActive } from './leadRetour'
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
