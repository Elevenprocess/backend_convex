// Types alignés sur les réponses du backend NestJS (toLeadResponse, toRdvResponse, toUserResponse).

export type Role = 'admin' | 'setter' | 'commercial' | 'delivrabilite'
export type Team = 'setting' | 'closing' | 'admin' | 'delivrabilite' | null

export type UserResponse = {
  id: string
  email: string
  name: string
  phone: string | null
  role: Role
  team: Team
  active: boolean
  lastSeenAt: string | null
  lastLoginAt: string | null
  lastActionAt: string | null
  lastActionType: string | null
  createdAt: string
  updatedAt: string
}

export type InvitationResponse = {
  id: string
  email: string
  name: string
  phone: string | null
  role: Role
  team: Team
  status: string
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  inviteUrl?: string
  emailSent?: boolean
}

export type LeadStatus =
  | 'nouveau'
  | 'qualifie'
  | 'rdv_pris'
  | 'rdv_honore'
  | 'signe'
  | 'perdu'
  | 'relance'
  | 'pas_qualifie'
  | 'a_rappeler'
  | 'pas_de_reponse'

export type LeadSource = 'ghl' | 'airtable_migration' | 'manual' | 'referrer'

export type LeadResponse = {
  id: string
  externalId: string | null
  source: LeadSource
  status: LeadStatus
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  addressLine: string | null
  city: string | null
  postalCode: string | null
  localisationMap: string | null
  revenuFiscal: number | null
  typeLogement: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  campaign: string | null
  adset: string | null
  ad: string | null
  canalAcquisition: string | null
  setterId: string | null
  assignedToId: string | null
  referrerId: string | null
  lastContactAt: string | null
  latestCallAt: string | null
  firstCallAt: string | null
  latestCallComment: string | null
  assignedSetterIds: string[]
  latestRdvAt: string | null
  latestRdvStatus: RdvStatus | null
  latestRdvCommercialId: string | null
  jauge11Jours: string | null
  datePassageRelance: string | null
  createdAt: string
  updatedAt: string
  joursSansContact: number | null
  joursRelance: number | null
  callCount: number
  callsToday: number
  nextCallbackAt: string | null
  firstCallUnderFiveMin: boolean | null
}

export type CallResult =
  | 'joint'
  | 'non_joint'
  | 'rappel_planifie'
  | 'rdv_pris'
  | 'refus'
  | 'injoignable'
  | 'messagerie'

export type CallLogResponse = {
  id: string
  leadId: string
  setterId: string
  calledAt: string
  result: CallResult
  nextCallbackAt: string | null
  notes: string | null
  createdAt: string
}

export const CALL_RESULT_LABEL: Record<CallResult, string> = {
  joint: 'Joint',
  non_joint: 'Non joint',
  rappel_planifie: 'Rappel planifié',
  rdv_pris: 'RDV pris',
  refus: 'Refus',
  injoignable: 'Injoignable',
  messagerie: 'Messagerie',
}

export type AnalyticsSegment = { label: string; value: number; color: string }

export type SetterPerformance = {
  id: string
  name: string
  initials: string
  calls: number
  connected: number
  classified: number
  qualified: number
  rdvPris: number
  efficiency: number
}

export type CommercialPerformance = {
  id: string
  name: string
  initials: string
  honored: number
  signed: number
  closing: number
  panier: number
  ca: number
}

export type AnalyticsResponse = {
  calls: number
  loggedCalls: number
  syntheticCalls: number
  callsPerDay: number
  classified: number
  unclassified: number
  connected: number
  qualified: number
  rdvPris: number
  rdvRate: number
  connectionRate: number
  qualificationRate: number
  ca: number
  signed: number
  total: number
  honored: number
  closing: number
  panier: number
  resultSegments: AnalyticsSegment[]
  financingSegments: AnalyticsSegment[]
  dailyCalls: number[]
  setters: SetterPerformance[]
  commercials: CommercialPerformance[]
}

export type RdvStatus = 'planifie' | 'honore' | 'no_show' | 'reporte' | 'annule'
export type RdvResult = 'signe' | 'reflexion' | 'perdu' | 'no_show' | 'reporte'
export type RdvLocation = 'domicile' | 'agence' | 'visio'
export type FinancingType = 'comptant' | 'financement'

export type RdvResponse = {
  id: string
  externalId: string | null
  leadId: string
  commercialId: string | null
  scheduledAt: string
  locationType: RdvLocation
  status: RdvStatus
  result: RdvResult | null
  signatureAt: string | null
  montantTotal: string | null
  financingType: FinancingType | null
  objections: string | null
  nonSaleReason: string | null
  notes: string | null
  debriefFilledAt: string | null
  debriefDueAt: string | null
  createdAt: string
  updatedAt: string
}

// Helpers d'affichage utilisés un peu partout dans l'UI.
export const STATUS_LABEL: Record<LeadStatus, string> = {
  nouveau: 'Nouveau',
  qualifie: 'Qualifié',
  rdv_pris: 'RDV pris',
  rdv_honore: 'RDV honoré',
  signe: 'Signé',
  perdu: 'Perdu',
  relance: 'Relance',
  pas_qualifie: 'Pas qualifié',
  a_rappeler: 'À rappeler',
  pas_de_reponse: 'Pas de réponse',
}

export const STATUS_BADGE: Record<LeadStatus, string> = {
  nouveau: 'bg-info-tint text-info',
  qualifie: 'bg-success-tint text-success',
  rdv_pris: 'bg-or-tint text-or-dark',
  rdv_honore: 'bg-or-tint text-or-dark',
  signe: 'bg-success-tint text-success',
  perdu: 'bg-rouille-tint text-rouille',
  relance: 'bg-cuivre-tint text-cuivre',
  pas_qualifie: 'bg-rouille-tint text-rouille',
  a_rappeler: 'bg-cuivre-tint text-cuivre',
  pas_de_reponse: 'bg-muted/10 text-muted',
}

export function fullName(l: { firstName: string | null; lastName: string | null }): string {
  return [l.firstName, l.lastName].filter(Boolean).join(' ') || '—'
}

export function initials(l: { firstName: string | null; lastName: string | null }): string {
  const f = l.firstName?.[0] ?? ''
  const ln = l.lastName?.[0] ?? ''
  return (f + ln).toUpperCase() || '··'
}
