import type { UpdateLeadInput } from './hooks'
import type { LeadResponse } from './types'

/**
 * Formulaire d'édition des informations complètes d'un client (lead), partagé
 * entre la colonne delivery (DossierSidebar) et la page Fiche complète
 * (FicheClientPanel). Le back-office / responsable technique peut ainsi
 * corriger n'importe quelle coordonnée et la propager à GHL (via updateLead).
 */
export type ClientEditForm = {
  firstName: string
  lastName: string
  phone: string
  email: string
  addressLine: string
  postalCode: string
  city: string
  localisationMap: string
  typeLogement: string
  revenuFiscal: string
}

export function leadToClientForm(lead: LeadResponse): ClientEditForm {
  return {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    addressLine: lead.addressLine ?? '',
    postalCode: lead.postalCode ?? '',
    city: lead.city ?? '',
    localisationMap: lead.localisationMap ?? '',
    typeLogement: lead.typeLogement ?? '',
    revenuFiscal: lead.revenuFiscal != null ? String(lead.revenuFiscal) : '',
  }
}

/**
 * Patch par diff : ne renvoie QUE les champs réellement modifiés, et envoie
 * `null` quand un champ a été vidé — le back-office peut donc aussi EFFACER une
 * donnée erronée (email/téléphone/adresse), pas seulement la remplacer.
 */
export function clientFormToPatch(lead: LeadResponse, f: ClientEditForm): UpdateLeadInput {
  const patch: UpdateLeadInput = {}
  const initial = leadToClientForm(lead)
  const textFields = ['firstName', 'lastName', 'phone', 'email', 'addressLine', 'postalCode', 'city', 'localisationMap', 'typeLogement'] as const
  for (const key of textFields) {
    const next = f[key].trim()
    if (next === initial[key].trim()) continue
    patch[key] = next === '' ? null : next
  }
  const rev = f.revenuFiscal.trim()
  if (rev !== initial.revenuFiscal.trim()) {
    if (rev === '') patch.revenuFiscal = null
    else {
      const n = Number(rev)
      if (!Number.isNaN(n)) patch.revenuFiscal = n
    }
  }
  return patch
}
