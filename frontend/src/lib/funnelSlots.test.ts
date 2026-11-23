import { describe, expect, it } from 'vitest'
import { dayPlacesLeft, placesLabel, toAvailability } from './funnelSlots'

describe('places du funnel', () => {
  it('rien à signaler au-dessus de 5 places, puis le même texte que le site', () => {
    expect(placesLabel(undefined)).toBeNull()
    expect(placesLabel(40)).toBeNull()
    expect(placesLabel(6)).toBeNull()
    expect(placesLabel(5)).toBe('Plus que 5 places')
    expect(placesLabel(2)).toBe('Plus que 2 places')
    expect(placesLabel(1)).toBe("Plus qu'une place")
    expect(placesLabel(0)).toBe('Complet')
  })
  it('places restantes sur la journée', () => {
    const a = toAvailability([
      { jour: '2026-11-27', heure: 8, capacite: 40, restantes: 3 },
      { jour: '2026-11-27', heure: 9, capacite: 40, restantes: 0 },
    ])
    expect(dayPlacesLeft(a, '2026-11-27', [8, 9, 10])).toBe(3)
    expect(dayPlacesLeft(a, '2026-11-30', [8])).toBeNull()
    expect(dayPlacesLeft(null, '2026-11-27', [8])).toBeNull()
  })
})
