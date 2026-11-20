// Parcours de qualification d'un lead : RDV à domicile (habituel) ou RDV au
// bureau (uniquement quand une promo avec calendrier bureau est en cours).
export type RdvMode = 'domicile' | 'bureau'

export function nextStepAfterQualification(mode: RdvMode): 'secteur' | 'rdv' {
  return mode === 'bureau' ? 'rdv' : 'secteur'
}

export function previousStepFromRdv(mode: RdvMode): 'secteur' | 'qualification' {
  return mode === 'bureau' ? 'qualification' : 'secteur'
}

export function bureauSlotHint(slotsCount: number, hasDate: boolean): string | null {
  if (!hasDate || slotsCount > 0) return null
  return 'Aucun créneau au bureau ce jour-là : choisis un vendredi ou un samedi. Si rien n’apparaît, le calendrier bureau est peut-être désactivé dans GHL (prévenir l’admin).'
}
