// Types alignés sur les réponses du backend NestJS (toLeadResponse, toRdvResponse, toUserResponse).

export type Role =
  | 'admin'
  | 'setter'
  | 'setter_lead'
  | 'commercial'
  | 'commercial_lead'
  | 'delivrabilite'
  | 'responsable_technique'
  | 'back_office'
  | 'technicien'
  | 'finances'
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
  hasDevis?: boolean
  hasDebrief?: boolean
  latestDevisAt?: string | null
  latestDebriefAt?: string | null
  // Statut du dossier délivrabilité (Lot 2). Présent une fois le projet signé
  // transmis à la délivrabilité — remplace alors l'affichage 'signé'.
  delivrabiliteStatus?: ClientStatus | null
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

// ─── Délivrabilité (Lot 2) ────────────────────────────────
export type ClientStatus =
  | 'nouveau'
  | 'vt_a_faire'
  | 'administratif_en_cours'
  | 'installation_planifiee'
  | 'installe_en_attente_mes'
  | 'cloture'
  | 'bloque'
  | 'annule'

export const DELIVRABILITE_STATUS_LABEL: Record<ClientStatus, string> = {
  nouveau: 'Délivrabilité',
  vt_a_faire: 'VT à faire',
  administratif_en_cours: 'Administratif',
  installation_planifiee: 'Installation planifiée',
  installe_en_attente_mes: 'Installé — attente MES',
  cloture: 'Clôturé',
  bloque: 'Bloqué',
  annule: 'Annulé',
}

export const DELIVRABILITE_STATUS_BADGE: Record<ClientStatus, string> = {
  nouveau: 'bg-info-tint text-info',
  vt_a_faire: 'bg-or-tint text-or-dark',
  administratif_en_cours: 'bg-cuivre-tint text-cuivre',
  installation_planifiee: 'bg-cuivre-tint text-cuivre',
  installe_en_attente_mes: 'bg-or-tint text-or-dark',
  cloture: 'bg-success-tint text-success',
  bloque: 'bg-rouille-tint text-rouille',
  annule: 'bg-muted/10 text-muted',
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
  description?: string;
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

export interface DevisVendor {
  name?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
}

export interface DevisCustomer {
  firstName?: string;
  lastName?: string;
  addressLine?: string;
  city?: string;
  postalCode?: string;
  email?: string;
  phone?: string;
}

export interface DevisPrime {
  type?: string;
  montant?: number;
  tarifEuroParKwc?: number;
  zone?: string;
  modaliteVersement?: string;
  remarque?: string;
}

export interface DevisExtraction {
  devisNumber?: string;
  devisDate?: string;
  dateExpiration?: string;
  delaiExecution?: string;
  vendor?: DevisVendor;
  customer?: DevisCustomer;
  puissanceKwc?: number;
  nbPanneaux?: number;
  kits?: string;
  montantHt?: number;
  montantTva?: number;
  montantTtc?: number;
  montantNet?: number;
  lignes?: DevisLigne[];
  prime?: DevisPrime;
  conditionsReglement?: string;
  echeancier?: DevisEcheance[];
  financingType?: string;
  financingDetails?: {
    duree?: number;
    mensualite?: number;
    taux?: number;
    apport?: number;
  };
}

// Payload PATCH /devis/:id — tous les champs optionnels, `null` efface.
// Statut "signe" interdit : passe par /mark-signed.
export interface UpdateDevisPatch {
  status?: 'brouillon' | 'en_attente' | 'signature_en_cours' | 'perdu';
  devisNumber?: string | null;
  devisDate?: string | null;
  dateExpiration?: string | null;
  delaiExecution?: string | null;
  puissanceKwc?: number | null;
  nbPanneaux?: number | null;
  kits?: string | null;
  montantHt?: number | null;
  montantTva?: number | null;
  montantTtc?: number | null;
  montantNet?: number | null;
  financingType?: string | null;
  primeAutoconsommation?: number | null;
  primeTarifKwc?: number | null;
  primeZone?: string | null;
  lignes?: DevisLigne[];
  echeancier?: DevisEcheance[];
  vendor?: Partial<DevisVendor>;
  customer?: Partial<DevisCustomer>;
  prime?: Partial<DevisPrime>;
  conditionsReglement?: string | null;
  financingDetails?: {
    duree?: number | null;
    mensualite?: number | null;
    taux?: number | null;
    apport?: number | null;
  };
}

export interface Devis {
  id: string;
  leadId: string;
  projectId: string | null;
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
  extracted: DevisExtraction | null;
  signedAt: string | null;
  createdAt: string;
}

// ─── Projects ─────────────────────────────────────────────
export type ProjectStatus =
  | 'qualification'
  | 'devis_en_cours'
  | 'signature_en_cours'
  | 'signe'
  | 'perdu'
  | 'abandonne';

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  qualification: 'Qualification',
  devis_en_cours: 'Devis en cours',
  signature_en_cours: 'Signature en cours',
  signe: 'Signé',
  perdu: 'Perdu',
  abandonne: 'Abandonné',
}

export interface ProjectResponse {
  id: string;
  leadId: string;
  commercialId: string;
  name: string;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  status: ProjectStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Debriefs ─────────────────────────────────────────────
export type DebriefOutcome = 'vente' | 'non_vente' | 'en_reflexion' | 'suivi_prevu';

export const DEBRIEF_OUTCOME_LABEL: Record<DebriefOutcome, string> = {
  vente: 'Vente',
  non_vente: 'Non-vente',
  en_reflexion: 'En réflexion',
  suivi_prevu: 'Suivi prévu',
}

export type DebriefNonSaleReason =
  | 'suivi_prevu'
  | 'non_qualifie'
  | 'no_show'
  | 'contact_annule'
  | 'annulation_administrative'
  | 'pas_interesse';

export const DEBRIEF_NON_SALE_REASON_LABEL: Record<DebriefNonSaleReason, string> = {
  suivi_prevu: 'Suivi prévu',
  non_qualifie: 'Non qualifié',
  no_show: 'No-show',
  contact_annule: 'Contact annulé',
  annulation_administrative: 'Annulation administrative',
  pas_interesse: 'Pas intéressé',
}

export type DebriefReflexionReason =
  | 'besoin_reflechir'
  | 'consulter_partenaire'
  | 'comparer_concurrence'
  | 'budget_a_revoir'
  | 'attente_info_technique'
  | 'delai_a_confirmer'
  | 'autre';

export const DEBRIEF_REFLEXION_REASON_LABEL: Record<DebriefReflexionReason, string> = {
  besoin_reflechir: 'Besoin de réfléchir',
  consulter_partenaire: 'Consulter conjoint·e / famille',
  comparer_concurrence: 'Comparer avec la concurrence',
  budget_a_revoir: 'Budget à revoir',
  attente_info_technique: 'Attente info technique',
  delai_a_confirmer: 'Délai à confirmer',
  autre: 'Autre',
}

export type DebriefSuiviReason =
  | 'rappel_programme'
  | 'pas_le_bon_moment'
  | 'attend_devis_detaille'
  | 'besoin_info_technique'
  | 'autre';

export const DEBRIEF_SUIVI_REASON_LABEL: Record<DebriefSuiviReason, string> = {
  rappel_programme: 'Rappel programmé',
  pas_le_bon_moment: 'Pas le bon moment',
  attend_devis_detaille: 'Attend devis détaillé',
  besoin_info_technique: 'Besoin info technique',
  autre: 'Autre',
}

// Motifs "vente" — réutilise les acceptanceFactors (multi-select)
export type DebriefAcceptanceFactor =
  | 'prix_convenable'
  | 'confiance_commercial'
  | 'roi_rapide'
  | 'garanties'
  | 'recommandation'
  | 'batterie_autonomie'
  | 'financement_attractif'
  | 'aides_etat'
  | 'engagement_ecolo'
  | 'autre';

export const DEBRIEF_ACCEPTANCE_FACTOR_LABEL: Record<DebriefAcceptanceFactor, string> = {
  prix_convenable: 'Prix convenable',
  confiance_commercial: 'Confiance commerciale',
  roi_rapide: 'ROI rapide',
  garanties: 'Garanties rassurantes',
  recommandation: 'Recommandation',
  batterie_autonomie: 'Batterie / autonomie',
  financement_attractif: 'Financement attractif',
  aides_etat: 'Aides d\'État',
  engagement_ecolo: 'Engagement écologique',
  autre: 'Autre',
}

export interface DebriefResponse {
  id: string;
  projectId: string | null;
  leadId: string | null;
  rdvId: string | null;
  commercialId: string;
  outcome: DebriefOutcome;
  nonSaleReason: DebriefNonSaleReason | null;
  reflexionReason: DebriefReflexionReason | null;
  suiviReason: DebriefSuiviReason | null;
  objection: string | null;
  acceptanceFactors: string[];
  notes: string | null;
  montantTotal: string | null;
  financingType: FinancingType | null;
  kits: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Project attachments ──────────────────────────────────
export type ProjectAttachmentKind = 'photo' | 'document' | 'autre';

export interface ProjectAttachmentResponse {
  id: string;
  projectId: string;
  uploadedById: string;
  kind: ProjectAttachmentKind;
  label: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

// Détail complet renvoyé par GET /projects/:id (le projet + ses sous-ressources)
export interface ProjectDetailResponse extends ProjectResponse {
  devis: Devis[];
  debriefs: DebriefResponse[];
  attachments: ProjectAttachmentResponse[];
}
