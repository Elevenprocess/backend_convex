import { describe, expect, it } from 'vitest'
import { mapConvexLead, mapConvexRdv, mapConvexUser } from './convexMappers'
import type { ConvexLeadDoc, ConvexRdvDoc, ConvexUserDoc } from './convexApi'

const T0 = 1783181401517 // _creationTime de référence (ms)

describe('mapConvexUser', () => {
  it('applique le défaut setter/active=true comme roleOf() serveur', () => {
    const doc: ConvexUserDoc = { _id: 'u1', _creationTime: T0, email: 'a@b.c', name: 'Alice' }
    const u = mapConvexUser(doc)
    expect(u.id).toBe('u1')
    expect(u.role).toBe('setter')
    expect(u.active).toBe(true)
    expect(u.createdAt).toBe(new Date(T0).toISOString())
  })

  it('conserve rôle/team/active explicites', () => {
    const doc: ConvexUserDoc = {
      _id: 'u2', _creationTime: T0, email: 'x@y.z', name: 'Bob',
      role: 'admin', team: 'closing', active: false,
    }
    const u = mapConvexUser(doc)
    expect(u.role).toBe('admin')
    expect(u.team).toBe('closing')
    expect(u.active).toBe(false)
  })

  it('retombe sur l’email quand le nom manque (compte signUp)', () => {
    const u = mapConvexUser({ _id: 'u3', _creationTime: T0, email: 'seul@velora.fr' })
    expect(u.name).toBe('seul@velora.fr')
  })
})

describe('mapConvexLead', () => {
  it('nullifie les optionnels absents et convertit les timestamps en ISO', () => {
    const doc: ConvexLeadDoc = {
      _id: 'l1', _creationTime: T0, source: 'manual', status: 'rdv_pris',
      firstName: 'Jean', latestCallAt: T0 + 1000, setterId: 'u1',
    }
    const l = mapConvexLead(doc)
    expect(l.id).toBe('l1')
    expect(l.lastName).toBeNull()
    expect(l.city).toBeNull()
    expect(l.latestCallAt).toBe(new Date(T0 + 1000).toISOString())
    expect(l.assignedSetterIds).toEqual(['u1'])
    expect(l.callCount).toBe(0)
  })
})

describe('mapConvexRdv', () => {
  it('sérialise montantTotal en string (convention REST) et scheduledAt en ISO', () => {
    const doc: ConvexRdvDoc = {
      _id: 'r1', _creationTime: T0, leadId: 'l1',
      locationType: 'visio', status: 'planifie', scheduledAt: T0 + 5000, montantTotal: 12500,
    }
    const r = mapConvexRdv(doc)
    expect(r.montantTotal).toBe('12500')
    expect(r.scheduledAt).toBe(new Date(T0 + 5000).toISOString())
    expect(r.lead).toBeNull()
  })

  it('scheduledAt absent → retombe sur _creationTime (le type REST est non-null)', () => {
    const r = mapConvexRdv({ _id: 'r2', _creationTime: T0, leadId: 'l1', locationType: 'visio', status: 'planifie' })
    expect(r.scheduledAt).toBe(new Date(T0).toISOString())
  })
})
