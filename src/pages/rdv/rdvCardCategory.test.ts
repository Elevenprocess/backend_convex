import { describe, it, expect } from 'vitest'
import type { RdvResponse } from '../../lib/types'
import { rdvCardCategory } from './rdvCardCategory'

const NOW = '2026-06-10T08:00:00.000Z'

function rdv(over: Partial<RdvResponse>): RdvResponse {
  return {
    id: 'r', externalId: null, leadId: 'l', commercialId: 'c',
    scheduledAt: '2026-06-09T08:00:00.000Z', locationType: 'domicile',
    status: 'honore', result: null, signatureAt: null, montantTotal: null,
    financingType: null, objections: null, nonSaleReason: null, kits: null,
    notes: null, debriefFilledAt: null, debriefDueAt: null,
    hasDevisEnAttente: false, cancelReason: null, receptionAlertAt: null, receptionAlertKind: null,
    createdAt: NOW, updatedAt: NOW, lead: null,
    ...over,
  }
}

describe('rdvCardCategory', () => {
  it('devis en attente prioritaire sur débrief fait', () => {
    expect(rdvCardCategory(rdv({ hasDevisEnAttente: true, debriefFilledAt: NOW }), NOW)).toBe('devis')
  })

  it('débrief fait → debrief', () => {
    expect(rdvCardCategory(rdv({ debriefFilledAt: NOW }), NOW)).toBe('debrief')
  })

  it('no_show / annule / reporte → autre (gris)', () => {
    expect(rdvCardCategory(rdv({ status: 'no_show' }), NOW)).toBe('autre')
    expect(rdvCardCategory(rdv({ status: 'annule' }), NOW)).toBe('autre')
    expect(rdvCardCategory(rdv({ status: 'reporte' }), NOW)).toBe('autre')
  })

  it('planifié à venir → avenir (blanc)', () => {
    expect(rdvCardCategory(rdv({ status: 'planifie', scheduledAt: '2026-06-11T08:00:00.000Z' }), NOW)).toBe('avenir')
  })

  it('frontière scheduledAt === now → avenir', () => {
    expect(rdvCardCategory(rdv({ status: 'planifie', scheduledAt: NOW }), NOW)).toBe('avenir')
  })

  it('passé sans débrief ni devis → absent (rouge)', () => {
    expect(rdvCardCategory(rdv({ status: 'honore', scheduledAt: '2026-06-09T08:00:00.000Z' }), NOW)).toBe('absent')
  })
})
