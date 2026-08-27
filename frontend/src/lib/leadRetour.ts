import type { LeadResponse } from './types'

// Lead renvoyé aux setters par les commerciaux (étape GHL « (BIS) Retour aux
// Setters ») : souvent un RDV planifié resté sans suite. Le webhook le classe
// en relance court terme (statut pas_de_reponse) avec un marqueur
// `retourSetters` ; ce marqueur reste « actif » tant que le lead n'a pas été
// repris (qualifié / RDV / signature) — sur ces statuts on ne l'affiche plus.
export function isRetourSettersActive(lead: LeadResponse): boolean {
  if (!lead.retourSetters) return false
  switch (lead.status) {
    case 'qualifie': case 'rdv_pris': case 'rdv_honore': case 'signature_en_cours': case 'signe':
      return false
    default:
      return true
  }
}
