// Terminologie "client" côté commercial — partagée entre la liste clients
// (ClientsList) et la fiche client (LeadDetail).
//
// Côté commercial on ne montre JAMAIS les statuts setter bruts (« Sans réponse »,
// « Nouveau », « À rappeler »…) NI l'avancement délivrabilité (VT à faire,
// Installation planifiée…). On affiche toujours l'un des 4 buckets commerciaux :
// En attente / En cours de signature / Signé / Devis perdu.
import { type LeadResponse } from './types'

export type ClientBucket = 'en_attente' | 'signature_en_cours' | 'signe' | 'perdu'

export const CLIENT_BUCKET_LABEL: Record<ClientBucket, string> = {
  en_attente: 'En attente',
  signature_en_cours: 'En cours de signature',
  signe: 'Signé',
  perdu: 'Devis perdu',
}

export const CLIENT_BUCKET_BADGE: Record<ClientBucket, string> = {
  en_attente: 'bg-cuivre-tint text-cuivre',
  signature_en_cours: 'bg-cuivre-tint text-cuivre',
  signe: 'bg-success-tint text-success',
  perdu: 'bg-rouille-tint text-rouille',
}

export function clientBucketForLead(lead: Pick<LeadResponse, 'status'>): ClientBucket {
  if (lead.status === 'signe') return 'signe'
  if (lead.status === 'signature_en_cours') return 'signature_en_cours'
  if (lead.status === 'perdu' || lead.status === 'pas_qualifie') return 'perdu'
  return 'en_attente'
}

// Badge affiché côté commercial : toujours l'un des 4 buckets commerciaux.
// On n'affiche jamais le statut délivrabilité ni un statut setter brut.
export function clientStatusBadge(
  lead: Pick<LeadResponse, 'status'>,
): { label: string; className: string } {
  const bucket = clientBucketForLead(lead)
  return { label: CLIENT_BUCKET_LABEL[bucket], className: CLIENT_BUCKET_BADGE[bucket] }
}
