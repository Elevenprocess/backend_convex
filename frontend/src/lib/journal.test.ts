import { describe, expect, it } from 'vitest'
import { detailRows, entityPath, entityTarget, initialsOf, toCsv } from '../lib/journal'
import type { ConvexActivityDoc } from '../lib/convexApi'

const base: ConvexActivityDoc = {
  _id: 'a1', _creationTime: 0, at: Date.UTC(2026, 7, 17, 8, 5), actorName: 'Alice Setter', actorRole: 'setter',
  domain: 'setting', action: 'lead.status_changed', entityType: 'lead', entityId: 'l1', leadId: 'l1',
  subject: 'Sophie Martin', summary: 'a passé le prospect Sophie Martin de « Nouveau » à « À rappeler »',
  details: { before: { status: 'nouveau' }, after: { status: 'a_rappeler' } },
}

describe('Journal helpers', () => {
  it('initialsOf ignore la source entre parenthèses', () => {
    expect(initialsOf('Alice Setter')).toBe('AS')
    expect(initialsOf('Carl Dupont (via GHL)')).toBe('CD')
    expect(initialsOf('GHL')).toBe('GH')
    expect(initialsOf('')).toBe('?')
  })

  it('entityTarget : prospect → liste du rôle + panneau ; dossier → /suivi/:lead ; admin → réglages', () => {
    expect(entityTarget(base, 'setter')).toEqual({ path: '/leads', leadId: 'l1' })
    expect(entityTarget(base, 'commercial')).toEqual({ path: '/client', leadId: 'l1' })
    expect(entityTarget(base, 'delivrabilite')).toEqual({ path: '/client', leadId: 'l1' })
    expect(entityTarget({ entityType: 'rdv', entityId: 'r1', leadId: 'l1' }, 'admin')).toEqual({ path: '/leads', leadId: 'l1' })
    expect(entityTarget({ entityType: 'workflow_substep', entityId: 's1', clientId: 'c1', leadId: 'l1' }, 'back_office')).toEqual({ path: '/suivi/l1', leadId: 'l1' })
    expect(entityTarget({ entityType: 'document', entityId: 'd1', clientId: 'c1', leadId: 'l1' }, 'admin')).toEqual({ path: '/suivi/l1', leadId: 'l1' })
    expect(entityTarget({ entityType: 'user', entityId: 'u1' }, 'admin')).toEqual({ path: '/settings' })
    expect(entityTarget({ entityType: 'acompte', entityId: 'x#1', leadId: 'l1' }, 'finances')).toEqual({ path: '/finances' })
    expect(entityTarget({ entityType: 'referrer', entityId: 'x' }, 'admin')).toBeNull()
    expect(entityPath(base, 'setter')).toBe('/leads')
  })

  it('detailRows : diff avant/après + clés libres, timestamps formatés', () => {
    const rows = detailRows({ before: { status: 'nouveau' }, after: { status: 'a_rappeler' }, nextCallbackAt: Date.UTC(2026, 0, 2, 10, 0), notes: null })
    expect(rows[0]).toEqual({ label: 'Statut', before: 'nouveau', after: 'a_rappeler' })
    expect(rows[1].label).toBe('Rappel')
    expect(rows[1].value).toMatch(/2026/)
    expect(rows.find((r) => r.label === 'Notes')).toBeUndefined() // null ignoré
    expect(detailRows(undefined)).toEqual([])
  })

  it('toCsv : en-tête, BOM, échappement des guillemets et point-virgule', () => {
    const csv = toCsv([{ ...base, summary: 'a dit « oui ; non »' }])
    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('Date;Heure;Acteur')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lines[1]).toContain('"a dit « oui ; non »"')
    expect(lines[1]).toContain('Alice Setter;Setter;Setting;lead.status_changed;Prospect;Sophie Martin')
  })
})
