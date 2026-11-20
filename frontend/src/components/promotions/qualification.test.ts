import { describe, expect, it } from 'vitest'
import { bureauSlotHint, nextStepAfterQualification, previousStepFromRdv } from './qualification'

describe('parcours de qualification', () => {
  it('bureau saute l’étape secteur, dans les deux sens', () => {
    expect(nextStepAfterQualification('domicile')).toBe('secteur')
    expect(nextStepAfterQualification('bureau')).toBe('rdv')
    expect(previousStepFromRdv('domicile')).toBe('secteur')
    expect(previousStepFromRdv('bureau')).toBe('qualification')
  })
  it('message quand le calendrier bureau n’a aucun créneau', () => {
    expect(bureauSlotHint(0, true)).toMatch(/vendredi ou un samedi/)
    expect(bureauSlotHint(3, true)).toBeNull()
    expect(bureauSlotHint(0, false)).toBeNull()
  })
})
