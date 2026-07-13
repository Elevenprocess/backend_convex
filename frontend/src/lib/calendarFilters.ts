export type CalendarFilterState = { sectors: Set<string>; commercials: Set<string> }

/** Prédicat de visibilité d'un item d'agenda selon les filtres secteur + commercial.
 *  - sectors/commercials vides = pas de filtre sur cette dimension (tout passe).
 *  - Un item sans commercial (VT, GHL non assigné → commercialId null) reste toujours visible. */
export function matchesCalendarFilters(sector: string, commercialId: string | null, filter: CalendarFilterState): boolean {
  const sectorOk = filter.sectors.size === 0 || filter.sectors.has(sector)
  const commercialOk = filter.commercials.size === 0 || commercialId === null || filter.commercials.has(commercialId)
  return sectorOk && commercialOk
}
