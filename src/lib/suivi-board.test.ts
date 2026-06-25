import { describe, it, expect } from 'vitest'
import { groupSubsteps, slaGaugeInfo, SUIVI_SECTIONS, PHASE_LABEL, clientCardSummary, fileKind, substepDocStatus } from './suivi-board'
import type { ClientResponse, SubstepResponse } from './types'

function sub(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: over.key ?? 'x', stepId: 's', clientId: 'c', key: 'vt_planifie',
    position: 1, label: 'L', actionLabel: 'A', phase: 'vt', status: 'a_faire',
    optional: false, dateRealisee: null, heure: null, deadline: null, responsableId: null,
    notes: null, problemReason: null, problemNotes: null, problemResolvedAt: null,
    metadata: {}, unlocked: true, missingDocument: false,
    expectedDocs: [], documents: [], depositOnly: false,
    createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('SUIVI_SECTIONS', () => {
  it('définit 3 sections dont une back-office à 2 colonnes', () => {
    expect(SUIVI_SECTIONS.map((s) => s.key)).toEqual(['amont', 'backoffice', 'aval'])
    const bo = SUIVI_SECTIONS.find((s) => s.key === 'backoffice')!
    expect(bo.layout).toBe('parallel')
    expect(bo.columns?.map((c) => c.key)).toEqual(['dp', 'racco'])
  })
})

describe('groupSubsteps', () => {
  const subs = [
    sub({ key: 'consuel_valide', phase: 'consuel', position: 2 }),
    sub({ key: 'racco_a_faire', phase: 'racco', position: 1 }),
    sub({ key: 'vt_mandat', phase: 'vt', position: 4 }),
    sub({ key: 'vt_planifie', phase: 'vt', position: 1 }),
    sub({ key: 'dp_a_faire', phase: 'dp', position: 1 }),
    sub({ key: 'install_a_faire', phase: 'installation', position: 1 }),
    sub({ key: 'enquete_satisfaction', phase: 'mes', position: 1 }),
  ]
  const g = groupSubsteps(subs)

  it('range la VT dans amont, triée par position', () => {
    expect(g.amont.map((s) => s.key)).toEqual(['vt_planifie', 'vt_mandat'])
  })
  it('sépare DP et Racco en 2 colonnes (racco seul, sans consuel)', () => {
    expect(g.backoffice.dp.map((s) => s.key)).toEqual(['dp_a_faire'])
    expect(g.backoffice.racco.map((s) => s.key)).toEqual(['racco_a_faire'])
  })
  it('range installation + consuel + mes dans aval (consuel après installation)', () => {
    expect(g.aval.map((s) => s.key)).toEqual(['install_a_faire', 'consuel_valide', 'enquete_satisfaction'])
  })
})

describe('slaGaugeInfo', () => {
  it('null sans deadline', () => {
    expect(slaGaugeInfo(null, '2026-06-02')).toBeNull()
  })
  it('J-x quand échéance future', () => {
    expect(slaGaugeInfo('2026-06-30', '2026-06-02')).toEqual({ daysLeft: 28, label: 'J-28', tone: 'ok' })
  })
  it("tone 'soon' à 7j ou moins", () => {
    expect(slaGaugeInfo('2026-06-07', '2026-06-02')).toMatchObject({ daysLeft: 5, tone: 'soon' })
  })
  it("aujourd'hui", () => {
    expect(slaGaugeInfo('2026-06-02', '2026-06-02')).toMatchObject({ daysLeft: 0, label: "Aujourd'hui", tone: 'late' })
  })
  it('retard', () => {
    expect(slaGaugeInfo('2026-05-30', '2026-06-02')).toMatchObject({ daysLeft: -3, label: 'Retard J+3', tone: 'late' })
  })
})

describe('PHASE_LABEL', () => {
  it('donne un libellé lisible par phase', () => {
    expect(PHASE_LABEL.consuel).toBe('Consuel')
    expect(PHASE_LABEL.vt).toMatch(/visite/i)
  })
})

function client(over: Partial<ClientResponse>): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', rdvId: null,
    lead: { fullName: 'Jean', city: 'Lyon', phone: null },
    technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'en_cours', currentPhase: 'consuel', blocked: false,
    signedAt: null, steps: {}, missingDocsCount: 2, ...over,
  } as ClientResponse
}

describe('clientCardSummary', () => {
  it('retourne null sans client', () => {
    expect(clientCardSummary(undefined)).toBeNull()
  })
  it('mappe phase, bloqué et pièces manquantes', () => {
    const s = clientCardSummary(client({}))!
    expect(s.phaseLabel).toBe('Consuel')
    expect(s.blocked).toBe(false)
    expect(s.missingDocsCount).toBe(2)
    expect(s.delivered).toBe(false)
    expect(s.installed).toBe(false)
  })
  it('delivered=true quand la phase MES est faite', () => {
    const s = clientCardSummary(client({ steps: { mes: { status: 'fait', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }))!
    expect(s.delivered).toBe(true)
  })
  it('installed=true quand la phase installation est faite', () => {
    const s = clientCardSummary(client({ steps: { installation: { status: 'fait', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }))!
    expect(s.installed).toBe(true)
  })
})

describe('fileKind', () => {
  it('classe par mimeType', () => {
    expect(fileKind('application/pdf')).toBe('pdf')
    expect(fileKind('image/jpeg')).toBe('image')
    expect(fileKind('application/msword')).toBe('doc')
  })
})

function subForDocs(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: 'x', stepId: 's', clientId: 'c', key: 'consuel_valide', position: 1,
    label: 'L', actionLabel: 'A', phase: 'consuel', status: 'a_faire', optional: false,
    dateRealisee: null, heure: null, deadline: null, responsableId: null, notes: null, problemReason: null,
    problemNotes: null, problemResolvedAt: null, metadata: {}, unlocked: true, missingDocument: false,
    expectedDocs: [], documents: [], depositOnly: false, createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('substepDocStatus', () => {
  it('sépare présentes et types manquants', () => {
    const sub = subForDocs({
      expectedDocs: ['consuel', 'autre'],
      documents: [{ id: 'd1', type: 'consuel', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1024, uploadedAt: '' }],
    })
    const r = substepDocStatus(sub)
    expect(r.present).toHaveLength(1)
    expect(r.missingTypes).toEqual(['autre'])
  })
})
