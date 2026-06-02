import { describe, it, expect } from 'vitest'
import { groupSubsteps, slaGaugeInfo, SUIVI_SECTIONS } from './suivi-board'
import type { SubstepResponse } from './types'

function sub(over: Partial<SubstepResponse>): SubstepResponse {
  return {
    id: over.key ?? 'x', stepId: 's', clientId: 'c', key: 'vt_planifie',
    position: 1, label: 'L', actionLabel: 'A', phase: 'vt', status: 'a_faire',
    optional: false, dateRealisee: null, deadline: null, responsableId: null,
    notes: null, problemReason: null, problemNotes: null, problemResolvedAt: null,
    metadata: {}, unlocked: true, missingDocument: false,
    createdAt: '', updatedAt: '', ...over,
  } as SubstepResponse
}

describe('SUIVI_SECTIONS', () => {
  it('définit 3 sections dont une back-office à 2 colonnes', () => {
    expect(SUIVI_SECTIONS.map((s) => s.key)).toEqual(['amont', 'backoffice', 'aval'])
    const bo = SUIVI_SECTIONS.find((s) => s.key === 'backoffice')!
    expect(bo.layout).toBe('parallel')
    expect(bo.columns?.map((c) => c.key)).toEqual(['dp', 'racco_consuel'])
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
  it('sépare DP et Racco→Consuel en 2 colonnes (racco avant consuel)', () => {
    expect(g.backoffice.dp.map((s) => s.key)).toEqual(['dp_a_faire'])
    expect(g.backoffice.racco_consuel.map((s) => s.key)).toEqual(['racco_a_faire', 'consuel_valide'])
  })
  it('range installation + mes dans aval', () => {
    expect(g.aval.map((s) => s.key)).toEqual(['install_a_faire', 'enquete_satisfaction'])
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
