// Normalisation partagée des recherches prospect (liste setter, dialer…).
// Miroir des helpers backend dans convex/leads.ts — garder les deux alignés.

// Casse + accents neutralisés, espaces multiples repliés : « José-Müller » et
// « jose muller » doivent se retrouver.
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Variantes d'un numéro pour la recherche : chiffres seuls (les espaces/points
// ne comptent pas), équivalence +262/+33 ↔ 0…, et suffixes 8/9 chiffres pour
// matcher un numéro saisi partiellement.
export function phoneSearchVariants(value: string): string[] {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return []
  const variants = new Set<string>([digits])
  if (digits.startsWith('262') && digits.length > 3) variants.add(`0${digits.slice(3)}`)
  if (digits.startsWith('33') && digits.length > 2) variants.add(`0${digits.slice(2)}`)
  if (digits.length >= 8) variants.add(digits.slice(-8))
  if (digits.length >= 9) variants.add(digits.slice(-9))
  return Array.from(variants).filter((variant) => variant.length >= 4)
}

// Un numéro de lead correspond-il à la saisie ? Inclusion dans les deux sens
// pour tolérer les saisies partielles comme les numéros stockés sans indicatif.
export function phoneMatches(queryVariants: string[], leadPhone: string | null | undefined): boolean {
  if (queryVariants.length === 0) return false
  const leadVariants = phoneSearchVariants(leadPhone ?? '')
  return queryVariants.some((qp) => leadVariants.some((lp) => lp.includes(qp) || qp.includes(lp)))
}
