// Types alignés sur les réponses du backend NestJS (toLeadResponse, toRdvResponse, toUserResponse).

export type Role = 'admin' | 'setter' | 'commercial' | 'delivrabilite'
export type Team = 'setting' | 'closing' | 'admin' | 'delivrabilite' | null

export type UserResponse = {
  id: string
  email: string
  name: string
  phone: string | null
  image: string | null
  ghlUserId: string | null
  ghlCalendarId: string | null
  ghlLocationId: string | null
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
  targetUserId: string | null
  inviteUrl?: string
  emailSent?: boolean
}

export type LeadStatus =
  | 'nouveau'
  | 'qualifie'
  | 'rdv_pris'
  | 'rdv_honore'
  | 'signature_en_cours'
  | 'signe'
  | 'perdu'
  | 'relance'
  | 'pas_qualifie'
  | 'a_rappeler'
  | 'pas_de_reponse'

export type LeadSource = 'ghl' | 'airtable_migration' | 'manual' | 'referrer'

export type LeadStatsResponse = {
  total: number
  byStatus: Partial<Record<LeadStatus, number>>
  bySource: Partial<Record<LeadSource, number>>
  imported: number
  directGhl: number
}

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
  // Phase 1-6 — pont GHL
  monetaryValue: string | null // numeric Postgres → string en JSON
  ghlStageName: string | null
  ghlPipelineId: string | null
  lostReason: string | null
  lastStageChangeAt: string | null
  daysSinceLastStageChange: number | null
  arrivalAt: string | null
  transferredAt: string | null
  customFields?: { fieldKey: string; fieldName: string; value: string | null; updatedAt: string }[]
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
  rdv_pris: 'Qualifié',
  refus: 'Refus',
  injoignable: 'Injoignable',
  messagerie: 'Messagerie',
}

export type AnalyticsSegment = { label: string; value: number; color: string }

export type AnalyticsRange = {
  from: string
  to: string
  days: number
}

export type AnalyticsDailyPoint = {
  date: string
  label: string
  calls: number
  rdv: number
  signed: number
  ca: number
}

export type AnalyticsHourlyCallPoint = {
  date: string
  hour: number
  label: string
  calls: number
}

export type AnalyticsSetterSummary = {
  newLeads: number
  calls: number
  loggedCalls: number
  syntheticCalls: number
  callsPerDay: number
  classified: number
  unclassified: number
  answered: number
  connected: number
  relance: number
  notQualified: number
  qualified: number
  rdvPris: number
  responseRate: number
  rdvAfterAnswerRate: number
  globalRdvRate: number
  connectionRate: number
  qualificationRate: number
  rdvRate: number
  resultSegments: AnalyticsSegment[]
  dailyCalls: number[]
  hourlyCalls?: AnalyticsHourlyCallPoint[]
  dailyEvolution: AnalyticsDailyPoint[]
}

export type AnalyticsCommercialSummary = {
  total: number
  honored: number
  signed: number
  ca: number
  panier: number
  closing: number
  resultSegments: AnalyticsSegment[]
  financingSegments: AnalyticsSegment[]
  dailyEvolution: AnalyticsDailyPoint[]
}

export type AnalyticsSetterPerf = {
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

export type AnalyticsCommercialPerf = {
  id: string
  name: string
  initials: string
  total?: number
  planned?: number
  honored: number
  noShow?: number
  cancelled?: number
  postponed?: number
  signed: number
  closing: number
  panier: number
  ca: number
}

export type AnalyticsAdminSummary = {
  calls: number
  loggedCalls: number
  classified: number
  qualified: number
  unclassified: number
  syntheticCalls: number
  scheduledRdv: number
  rdvPris: number
  rdvRate: number
  qualificationRate: number
  ca: number
  signed: number
  resultSegments: AnalyticsSegment[]
  hourlyCalls?: AnalyticsHourlyCallPoint[]
  dailyEvolution: AnalyticsDailyPoint[]
  setters: AnalyticsSetterPerf[]
  commercials: AnalyticsCommercialPerf[]
}



export type AnalyticsFunnelStage = {
  id: string
  label: string
  value: number
  percent: number
  detail: string
}

export type AnalyticsFunnelComparison = {
  id: string
  name: string
  role: 'setter' | 'commercial'
  calls: number
  answered: number
  qualified: number
  rdv: number
  conversionRate: number
}

export type AnalyticsFunnelDailyPoint = {
  date: string
  label: string
  newLeads: number
  calls: number
  answered: number
  qualified: number
  rdv: number
}

export type AnalyticsFunnelResponse = {
  generatedAt: string
  engine: 'backend-funnel'
  range: AnalyticsRange
  filters: { setterId: string | null; sector: string | null }
  totals: {
    newLeads: number
    calls: number
    answered: number
    responseRate: number
    qualified: number
    qualificationRate: number
    notQualified: number
    notQualifiedRate: number
    noAnswer: number
    relances: number
    rdv: number
    globalConversionRate: number
    lossesBeforeCall: number
    lossesAfterNoAnswer: number
    lossesAfterNotQualified: number
  }
  stages: AnalyticsFunnelStage[]
  setterComparison: AnalyticsFunnelComparison[]
  commercialComparison: AnalyticsFunnelComparison[]
  daily: AnalyticsFunnelDailyPoint[]
  sectors: string[]
}

export type AnalyticsSummaryResponse = {
  generatedAt: string
  engine: 'backend-olap-etl' | 'backend-olap-etl-fast'
  role: Role
  days: number | null
  range: AnalyticsRange
  admin: AnalyticsAdminSummary | null
  setter: AnalyticsSetterSummary | null
  commercial: AnalyticsCommercialSummary | null
}

export type RdvStatus = 'planifie' | 'honore' | 'no_show' | 'reporte' | 'annule'
export type RdvResult = 'signe' | 'reflexion' | 'perdu' | 'no_show' | 'reporte'
export type RdvLocation = 'domicile' | 'agence' | 'visio'
export type FinancingType =
  | 'comptant'
  | 'financement'
  | 'financement_sans_apport'
  | 'apport_financement'
  | 'paiement_10x'

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
  kits: string | null
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
  rdv_pris: 'Qualifié',
  rdv_honore: 'RDV honoré',
  signature_en_cours: 'Signature en cours',
  signe: 'Signé',
  perdu: 'Non qualifié',
  relance: 'Relance',
  pas_qualifie: 'Non qualifié',
  a_rappeler: 'À rappeler',
  pas_de_reponse: 'Sans réponse',
}

export const STATUS_BADGE: Record<LeadStatus, string> = {
  nouveau: 'bg-info-tint text-info',
  qualifie: 'bg-success-tint text-success',
  rdv_pris: 'bg-success-tint text-success',
  rdv_honore: 'bg-or-tint text-or-dark',
  signature_en_cours: 'bg-cuivre-tint text-cuivre',
  signe: 'bg-success-tint text-success',
  perdu: 'bg-rouille-tint text-rouille',
  relance: 'bg-cuivre-tint text-cuivre',
  pas_qualifie: 'bg-rouille-tint text-rouille',
  a_rappeler: 'bg-cuivre-tint text-cuivre',
  pas_de_reponse: 'bg-muted/10 text-muted',
}

export function fullName(l: { firstName: string | null; lastName: string | null }): string {
  return [cleanField(l.firstName), cleanField(l.lastName)].filter(Boolean).join(' ') || '—'
}

export function initials(l: { firstName: string | null; lastName: string | null }): string {
  const f = cleanField(l.firstName)?.[0] ?? ''
  const ln = cleanField(l.lastName)?.[0] ?? ''
  return (f + ln).toUpperCase() || '··'
}

/**
 * DATA-1 défensif : certains imports legacy (Airtable) ont stocké les littéraux
 * "undefined" / "null" en BDD au lieu de NULL. Ce helper les normalise côté
 * affichage. Toujours afficher le lead, mais les champs vides → null (rendu '—').
 */
export function cleanField<T extends string | null | undefined>(v: T): string | null {
  if (v == null) return null
  if (typeof v !== 'string') return v as unknown as string
  const s = v.trim()
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower === 'undefined' || lower === 'null') return null
  return s
}

/** Pratique pour `value` props : retourne le tiret EM si vide. */
export function fieldOrDash(v: string | null | undefined): string {
  return cleanField(v) ?? '—'
}

// ─── Devis ────────────────────────────────────────────────
export type DevisStatus =
  | 'brouillon'
  | 'en_attente'
  | 'signature_en_cours'
  | 'signe'
  | 'perdu';

export type OcrStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface DevisLigne {
  designation: string;
  qty: number;
  prixUnitaireHt: number;
  totalHt: number;
  tva: number;
  totalTtc: number;
  type?: string;
}

export interface DevisEcheance {
  label: string;
  phase?: string;
  montant: number;
}

export interface Devis {
  id: string;
  leadId: string;
  rdvId: string | null;
  commercialId: string;
  status: DevisStatus;
  filename: string;
  storageKey: string;
  ocrStatus: OcrStatus;
  ocrError: string | null;
  devisNumber: string | null;
  devisDate: string | null;
  dateExpiration: string | null;
  delaiExecution: string | null;
  montantHt: string | null;
  montantTva: string | null;
  montantTtc: string | null;
  montantNet: string | null;
  puissanceKwc: string | null;
  nbPanneaux: number | null;
  kits: string | null;
  financingType: string | null;
  primeAutoconsommation: string | null;
  primeTarifKwc: string | null;
  primeZone: string | null;
  lignes: DevisLigne[];
  echeancier: DevisEcheance[];
  signedAt: string | null;
  createdAt: string;
}
