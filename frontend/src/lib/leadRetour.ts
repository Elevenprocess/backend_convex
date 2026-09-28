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

// Lead qui a déjà rencontré un commercial : dernier RDV honoré, non honoré,
// reporté, ou planifié mais déjà passé. Un RDV annulé ne compte pas (aucune
// rencontre), un RDV planifié à venir non plus (le lead est encore chez les
// commerciaux).
export function hasHadRdv(lead: LeadResponse, now: number = Date.now()): boolean {
  switch (lead.latestRdvStatus) {
    case 'honore': case 'no_show': case 'reporte':
      return true
    case 'planifie':
      return !!lead.latestRdvAt && Date.parse(lead.latestRdvAt) < now
    default:
      return false
  }
}

// « Relance court terme » : lead déjà vu par l'équipe commerciale à rappeler en
// priorité — renvoyé via l'étape GHL « Retour aux Setters », OU passé « sans
// réponse » après un RDV (typiquement débrief « suivi prévu » puis appel non
// joint : les commerciaux ne le déplacent presque jamais dans GHL).
export function isRelanceCourtTerme(lead: LeadResponse, now: number = Date.now()): boolean {
  if (isRetourSettersActive(lead)) return lead.status !== 'perdu' && lead.status !== 'pas_qualifie'
  return lead.status === 'pas_de_reponse' && hasHadRdv(lead, now)
}
