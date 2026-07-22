import { describe, it, expect } from 'vitest'
import { prospectDebriefBadges } from './Overview'

const NOW = Date.UTC(2026, 6, 22, 12, 0)
const MIN = 60_000

function prospect(overrides: Record<string, unknown>) {
  return {
    id: 'r1', name: 'Test', phone: null, city: null, status: 'En attente',
    scheduledAt: null, ...overrides,
  } as Parameters<typeof prospectDebriefBadges>[0]
}

describe('prospectDebriefBadges — états temporels', () => {
  it('RDV futur → « RDV à venir »', () => {
    const b = prospectDebriefBadges(prospect({ scheduledAt: new Date(NOW + 60 * MIN).toISOString() }), NOW)
    expect(b[0].label).toBe('RDV à venir')
  })

  it('RDV commencé il y a moins d’1h30 → « RDV en cours », pas une alerte', () => {
    const b = prospectDebriefBadges(prospect({ scheduledAt: new Date(NOW - 60 * MIN).toISOString() }), NOW)
    expect(b[0]).toEqual({ label: 'RDV en cours', tone: 'muted' })
  })

  it('RDV fini depuis moins de 45 min → « Envoi du débrief en cours »', () => {
    const b = prospectDebriefBadges(prospect({ scheduledAt: new Date(NOW - 110 * MIN).toISOString() }), NOW)
    expect(b[0]).toEqual({ label: 'Envoi du débrief en cours', tone: 'muted' })
  })

  it('RDV fini depuis plus de 45 min sans envoi → « Débrief non envoyé » (alerte)', () => {
    const b = prospectDebriefBadges(prospect({ scheduledAt: new Date(NOW - 140 * MIN).toISOString() }), NOW)
    expect(b[0]).toEqual({ label: 'Débrief non envoyé', tone: 'warn' })
  })

  it('débrief envoyé/rempli : inchangé quel que soit l’horaire', () => {
    const sent = prospectDebriefBadges(prospect({ scheduledAt: new Date(NOW - 60 * MIN).toISOString(), debriefNotifiedAt: new Date(NOW).toISOString() }), NOW)
    expect(sent.map((x) => x.label)).toEqual(['Débrief envoyé', 'Non ouvert'])
    const filled = prospectDebriefBadges(prospect({ debriefFilledAt: new Date(NOW).toISOString() }), NOW)
    expect(filled[0].label).toBe('Débrief rempli')
  })
})
