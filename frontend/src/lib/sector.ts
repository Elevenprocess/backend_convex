// Secteurs géographiques de La Réunion (24 communes) → Nord / Sud / Est / Ouest.
// Source unique partagée entre le calendrier RDV et la qualification setter, pour que
// la dérivation ville → secteur soit identique partout (plus d'erreur de saisie manuelle).

export type Sector = 'Nord' | 'Sud' | 'Est' | 'Ouest' | 'Autre'
export const SECTORS: Sector[] = ['Nord', 'Sud', 'Est', 'Ouest', 'Autre']

// Communes de La Réunion → secteur. On matche par PRÉFIXE (key.startsWith) pour absorber
// les variantes d'écriture ("Saint-André", "Saint-Andre", "St-André", "Saint-André 97440").
// On inclut donc les formes avec article ("la-plaine-des-palmistes", "letang-sale") car la
// normalisation retire les apostrophes mais garde le "l"/"la"/"le" collé devant.
export const CITY_SECTOR_PREFIXES: Array<[string, Sector]> = [
  // NORD
  ['saint-denis', 'Nord'], ['sainte-marie', 'Nord'], ['sainte-suzanne', 'Nord'],
  // EST
  ['saint-andre', 'Est'], ['saint-benoit', 'Est'], ['bras-panon', 'Est'],
  ['plaine-des-palmistes', 'Est'], ['la-plaine-des-palmistes', 'Est'],
  ['salazie', 'Est'], ['sainte-rose', 'Est'],
  // OUEST
  ['saint-paul', 'Ouest'], ['le-port', 'Ouest'], ['la-possession', 'Ouest'], ['possession', 'Ouest'],
  ['saint-leu', 'Ouest'], ['trois-bassins', 'Ouest'], ['les-avirons', 'Ouest'],
  ['etang-sale', 'Ouest'], ['letang-sale', 'Ouest'],
  // SUD
  ['saint-pierre', 'Sud'], ['saint-philippe', 'Sud'], ['saint-joseph', 'Sud'], ['saint-louis', 'Sud'],
  ['le-tampon', 'Sud'], ['tampon', 'Sud'], ['cilaos', 'Sud'],
  ['petite-ile', 'Sud'], ['petit-ile', 'Sud'], ['entre-deux', 'Sud'],
]

export function normalizeCityKey(city: string | null | undefined): string {
  if (!city) return ''
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^st-/, 'saint-')
    .replace(/^ste-/, 'sainte-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export function sectorFromCity(city: string | null | undefined): Sector {
  const key = normalizeCityKey(city)
  if (!key) return 'Autre'
  for (const [prefix, sector] of CITY_SECTOR_PREFIXES) if (key.startsWith(prefix)) return sector
  return 'Autre'
}
