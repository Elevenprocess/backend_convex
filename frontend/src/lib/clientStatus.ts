// Terminologie "client" côté commercial — partagée entre la liste clients
// (ClientsList) et la fiche client (LeadDetail).
//
// Côté commercial on ne montre JAMAIS les statuts setter bruts (« Sans réponse »,
// « Nouveau », « À rappeler »…) NI l'avancement délivrabilité (VT à faire,
// Installation planifiée…). Décision user 2026-07-22 : exactement 3 statuts —
//   RDV à faire  : le RDV n'a pas encore été honoré (avant ou en attente de RDV)
//   Qualifié     : RDV honoré et chemin positif (inclut signature en cours et signé)
//   Non qualifié : perdu / pas qualifié, y compris non-vente « suivi prévu / en
//                  réflexion » (statut interne a_rappeler + débrief existant) —
//                  le statut interne reste intact pour la file de relance setter.
import { type LeadResponse } from './types'

export type ClientBucket = 'rdv_a_faire' | 'qualifie' | 'non_qualifie'

export const CLIENT_BUCKET_LABEL: Record<ClientBucket, string> = {
  rdv_a_faire: 'RDV à faire',
  qualifie: 'Qualifié',
  non_qualifie: 'Non qualifié',
}

export const CLIENT_BUCKET_BADGE: Record<ClientBucket, string> = {
  rdv_a_faire: 'bg-cuivre-tint text-cuivre',
  qualifie: 'bg-success-tint text-success',
  non_qualifie: 'bg-rouille-tint text-rouille',
}

type BucketInput = Pick<LeadResponse, 'status'> & { hasDebrief?: boolean }

export function clientBucketForLead(lead: BucketInput): ClientBucket {
  if (lead.status === 'signe' || lead.status === 'signature_en_cours' || lead.status === 'rdv_honore') return 'qualifie'
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'non_qualifie'
  // a_rappeler APRÈS un débrief = non-vente « suivi prévu / en réflexion » ;
  // a_rappeler sans débrief = flux setter avant RDV → RDV à faire.
  if (lead.status === 'a_rappeler' && lead.hasDebrief === true) return 'non_qualifie'
  return 'rdv_a_faire'
}

// Badge affiché côté commercial : toujours l'un des 3 statuts commerciaux.
// On n'affiche jamais le statut délivrabilité ni un statut setter brut.
export function clientStatusBadge(
  lead: BucketInput,
): { label: string; className: string } {
  const bucket = clientBucketForLead(lead)
  return { label: CLIENT_BUCKET_LABEL[bucket], className: CLIENT_BUCKET_BADGE[bucket] }
}
