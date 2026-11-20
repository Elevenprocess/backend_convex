import { describe, expect, it } from 'vitest'
import { bureauSlotHint, formatRdvTransferNote, nextStepAfterQualification, previousStepFromRdv } from './qualification'

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

describe('note de transfert RDV', () => {
  const base = { eligibilitySummary: '', commentaire: 'Rappeler après 17h' }
  it('bureau sans secteur : commence par RDV BUREAU, jamais de secteur', () => {
    const note = formatRdvTransferNote({ ...base, sector: '', bureau: { address: '1 rue X' } })
    expect(note.split('\n')[0]).toBe('RDV BUREAU — 1 rue X')
    expect(note).not.toMatch(/RDV ECOI —/)
    expect(note).toContain('Rappeler après 17h')
  })
  it('domicile : note inchangée', () => {
    expect(formatRdvTransferNote({ ...base, sector: 'Nord' })).toBe('RDV ECOI — Nord\nCommentaire setter :\nRappeler après 17h')
  })
})
