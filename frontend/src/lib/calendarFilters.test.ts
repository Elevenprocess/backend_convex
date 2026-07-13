import { describe, expect, it } from 'vitest'
import { matchesCalendarFilters, type CalendarFilterState } from './calendarFilters'

const NONE: CalendarFilterState = { sectors: new Set(), commercials: new Set() }

describe('matchesCalendarFilters', () => {
  it('laisse tout passer quand aucun filtre actif', () => {
    expect(matchesCalendarFilters('Nord', 'c1', NONE)).toBe(true)
    expect(matchesCalendarFilters('Autre', null, NONE)).toBe(true)
  })

  it('filtre par secteur (multi)', () => {
    const state: CalendarFilterState = { sectors: new Set(['Nord', 'Sud']), commercials: new Set() }
    expect(matchesCalendarFilters('Nord', 'c1', state)).toBe(true)
    expect(matchesCalendarFilters('Sud', 'c1', state)).toBe(true)
    expect(matchesCalendarFilters('Est', 'c1', state)).toBe(false)
  })

  it('filtre par commercial (multi)', () => {
    const state: CalendarFilterState = { sectors: new Set(), commercials: new Set(['c1', 'c2']) }
    expect(matchesCalendarFilters('Nord', 'c1', state)).toBe(true)
    expect(matchesCalendarFilters('Nord', 'c3', state)).toBe(false)
  })

  it('garde toujours visibles les items sans commercial (VT / GHL non assigné)', () => {
    const state: CalendarFilterState = { sectors: new Set(), commercials: new Set(['c1']) }
    expect(matchesCalendarFilters('Nord', null, state)).toBe(true)
  })

  it('combine secteur ET commercial (les deux doivent passer)', () => {
    const state: CalendarFilterState = { sectors: new Set(['Nord']), commercials: new Set(['c1']) }
    expect(matchesCalendarFilters('Nord', 'c1', state)).toBe(true)
    expect(matchesCalendarFilters('Sud', 'c1', state)).toBe(false) // mauvais secteur
    expect(matchesCalendarFilters('Nord', 'c2', state)).toBe(false) // mauvais commercial
    expect(matchesCalendarFilters('Sud', null, state)).toBe(false) // commercial null OK mais secteur KO
  })
})
