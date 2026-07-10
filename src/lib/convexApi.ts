import { makeFunctionReference } from 'convex/server'
import type { PaginationResult } from 'convex/server'

// Références typées vers les fonctions ECOI_convex consommées par la tranche 1.
// On ne copie PAS les _generated d'ECOI_convex : leurs .d.ts importent les
// sources serveur (non compilables ici). Source de vérité des shapes :
// ECOI_convex/convex/schema.ts — à tenir synchro à la main tant que la surface
// reste petite (industrialisation prévue en tranche 2).

export type ConvexUserDoc = {
  _id: string
  _creationTime: number
  email?: string
  name?: string
  image?: string
  phone?: string
  role?: string
  team?: string
  active?: boolean
  ghlUserId?: string
  ghlCalendarId?: string
  deletedAt?: number
}

export type ConvexLeadDoc = {
  _id: string
  _creationTime: number
  externalId?: string
  source: string
  status: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  addressLine?: string
  city?: string
  postalCode?: string
  localisationMap?: string
  revenuFiscal?: number
  typeLogement?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  campaign?: string
  adset?: string
  ad?: string
  canalAcquisition?: string
  setterId?: string
  assignedToId?: string
  referrerId?: string
  lastContactAt?: number
  latestCallAt?: number
  firstCallAt?: number
  latestCallComment?: string
  latestCallSetterId?: string
  // Date réelle Render posée par la migration (repli _creationTime si absente).
  createdAt?: number
  [k: string]: unknown
}

export type ConvexRdvDoc = {
  _id: string
  _creationTime: number
  externalId?: string
  leadId: string
  commercialId?: string
  scheduledAt?: number
  locationType: string
  status: string
  result?: string
  signatureAt?: number
  montantTotal?: number
  financingType?: string
  objections?: string
  nonSaleReason?: string
  kits?: string
  notes?: string
  debriefFilledAt?: number
  debriefDueAt?: number
  deletedAt?: number
  // Signalement annulation/report par l'accueil (numéro central).
  cancelReason?: string
  receptionAlertAt?: number
  receptionAlertKind?: 'annule' | 'reporte'
  receptionAlertBy?: string
  // Date de PRISE de RDV (booking) réelle Render posée par la migration ; repli
  // _creationTime pour les RDV live. Sert d'horodatage « première prise de RDV ».
  createdAt?: number
  // Résumé lead embarqué par rdv:list (nom/ville/téléphone/setter) → l'Overview
  // affiche le prospect sans dépendre de la liste /leads bornée à 500.
  lead?: {
    id: string
    firstName?: string | null
    lastName?: string | null
    city?: string | null
    phone?: string | null
    email?: string | null
    setterId?: string | null
  } | null
}

// Décor renvoyé par clients.list/getByProject/getByLead (decorateClient côté
// serveur ajoute techniciens/missingDocs/steps/lead au doc brut).
export type ConvexClientStep = {
  status: string
  datePlanifiee: string | null
  dateRealisee: string | null
  problemReason: string | null
  responsableId: string | null
}
export type ConvexClientDoc = {
  _id: string
  _creationTime: number
  leadId: string
  projectId?: string
  rdvId?: string
  adminReferentId?: string
  poseTeamLeadId?: string
  technicienVtId?: string
  signedAt?: number
  statusGlobal: string
  currentPhase: string
  blocked: boolean
  techniciens: { id: string; name: string }[]
  missingDocs: number
  steps: Record<string, ConvexClientStep>
  lead: { fullName: string | null; city: string | null; phone: string | null }
  [k: string]: unknown
}

export type ConvexProjectDoc = {
  _id: string
  _creationTime: number
  leadId: string
  commercialId: string
  name: string
  addressLine?: string
  postalCode?: string
  city?: string
  status: string
  notes?: string
  [k: string]: unknown
}

export type ConvexDebriefDoc = {
  _id: string
  _creationTime: number
  projectId?: string
  leadId?: string
  rdvId?: string
  commercialId: string
  outcome: string
  nonSaleReason?: string
  reflexionReason?: string
  suiviReason?: string
  objection?: string
  acceptanceFactors: string[]
  notes?: string
  montantTotal?: number
  financingType?: string
  kits?: string
  signedAt?: number
  paymentSubMethod?: string
  financingOrg?: string
  acomptePercent?: number
  acompteAmount?: number
  [k: string]: unknown
}

// devis : toResponse serveur renvoie le doc quasi brut (montants en number,
// storageId, timestamps ms) → mapConvexDevis convertit vers le type REST Devis.
export type ConvexDevisDoc = {
  _id: string
  _creationTime: number
  leadId: string
  projectId?: string
  rdvId?: string
  commercialId: string
  status: string
  storageId?: string
  filename: string
  sizeBytes: number
  ocrStatus: string
  ocrError?: string
  ocrCompletedAt?: number
  devisNumber?: string
  devisDate?: string
  dateExpiration?: string
  delaiExecution?: string
  montantHt?: number
  montantTva?: number
  montantTtc?: number
  montantNet?: number
  puissanceKwc?: number
  nbPanneaux?: number
  kits?: string
  financingType?: string
  primeAutoconsommation?: number
  primeTarifKwc?: number
  primeZone?: string
  lignes: unknown[]
  echeancier: unknown[]
  extracted?: unknown
  signedAt?: number
  [k: string]: unknown
}

export const devisGenerateUploadUrl = makeFunctionReference<'mutation', Record<string, never>, string>('devis:generateUploadUrl')

export const devisCreate = makeFunctionReference<
  'mutation',
  { leadId: string; storageId: string; filename: string; sizeBytes: number; rdvId?: string; projectId?: string; commercialId?: string },
  string
>('devis:create')

export const devisGetById = makeFunctionReference<'query', { devisId: string }, ConvexDevisDoc | null>('devis:getById')

export const devisListByLead = makeFunctionReference<'query', { leadId: string }, ConvexDevisDoc[]>('devis:listByLead')

export const devisMarkAsSigned = makeFunctionReference<'mutation', { devisId: string }, unknown>('devis:markAsSigned')

export const devisRetryOcr = makeFunctionReference<'mutation', { devisId: string }, unknown>('devis:retryOcr')

export const devisRemove = makeFunctionReference<'mutation', { devisId: string }, unknown>('devis:remove')

export const devisUpdate = makeFunctionReference<
  'mutation',
  { devisId: string } & Record<string, unknown>,
  unknown
>('devis:update')

// projectAttachments : toSummary serveur (uploadedAt en ms ; url = lien storage
// signé embarqué par listByProject/create pour l'affichage <img> direct).
export type ConvexAttachmentSummary = {
  id: string
  projectId: string
  uploadedById?: string
  kind: string
  label?: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedAt: number
  url?: string
}

export const projectAttachmentsGenerateUploadUrl = makeFunctionReference<'mutation', Record<string, never>, string>('projectAttachments:generateUploadUrl')

export const projectAttachmentsCreate = makeFunctionReference<
  'mutation',
  { projectId: string; kind: string; label?: string; filename: string; contentType: string; sizeBytes: number; storageId: string },
  ConvexAttachmentSummary
>('projectAttachments:create')

export const projectAttachmentsListByProject = makeFunctionReference<'query', { projectId: string }, ConvexAttachmentSummary[]>('projectAttachments:listByProject')

export const projectAttachmentsGetUrl = makeFunctionReference<
  'query',
  { attachmentId: string },
  { url: string; filename: string; contentType: string } | null
>('projectAttachments:getUrl')

export const projectAttachmentsRemove = makeFunctionReference<'mutation', { attachmentId: string }, { ok: true }>('projectAttachments:remove')

// payments/acomptes : le serveur renvoie déjà la forme AcompteResponse mais avec
// montants en number et signedAt en ms → mapConvexAcompte convertit.
export type ConvexEcheanceLine = {
  ordre: number; label: string; jalonKey: string | null; jalonAtteint: boolean
  percent: number | null; montantPrevu: number | null; statut: string
  montantReel: number | null; dateEcheance: string | null; dateEncaissement: string | null
  notes: string | null; recordedById: string | null; updatedAt: string | null
}
export type ConvexAcompteDoc = {
  debriefId: string; leadId: string | null; projectId: string | null
  projectName: string | null; clientName: string | null; commercialName: string | null
  montantTotal: number | null; financingType: string | null; paymentSubMethod: string | null
  financingOrg: string | null; acomptePercent: number | null; acompteAmount: number | null
  customEcheancier: boolean; signedAt: number | null; edfRecepisse: boolean
  echeancierSource: 'custom' | 'devis' | 'standard'; devisNumber: string | null
  echeances: ConvexEcheanceLine[]; totalEncaisse: number | null; resteAPayer: number | null
}

export const paymentsListAcomptes = makeFunctionReference<'query', { today: string }, ConvexAcompteDoc[]>('payments:listAcomptes')

export const paymentsGetAcompte = makeFunctionReference<'query', { debriefId: string; today: string }, ConvexAcompteDoc | null>('payments:getAcompte')

export const paymentsRecordEcheance = makeFunctionReference<
  'mutation',
  { debriefId: string; ordre: number; statut: string; montantReel?: number; dateEncaissement?: string; dateEcheance?: string; notes?: string },
  unknown
>('payments:recordEcheance')

export const paymentsUpdateFinancing = makeFunctionReference<
  'mutation',
  { debriefId: string; montantTotal?: number; financingType?: string; paymentSubMethod?: string; financingOrg?: string; acomptePercent?: number; acompteAmount?: number },
  unknown
>('payments:updateFinancing')

export const paymentsSetEcheancier = makeFunctionReference<
  'mutation',
  { debriefId: string; tranches: Array<Record<string, unknown>> },
  unknown
>('payments:setEcheancier')

export const paymentsResetEcheancier = makeFunctionReference<'mutation', { debriefId: string }, unknown>('payments:resetEcheancier')

// workflowSubsteps : decorate serveur ajoute label/actionLabel/phase/expectedDocs/
// depositOnly/unlocked/documents/missingDocument au doc brut.
export type ConvexSubstepDoc = {
  _id: string
  _creationTime: number
  stepId: string
  clientId: string
  key: string
  position: number
  status: string
  optional: boolean
  dateRealisee?: string
  deadline?: string
  heure?: string
  responsableId?: string
  notes?: string
  problemReason?: string
  problemNotes?: string
  problemResolvedAt?: number
  metadata?: unknown
  label: string
  actionLabel: string
  phase: string
  expectedDocs: string[]
  depositOnly: boolean
  unlocked: boolean
  missingDocument: boolean
  documents: { id: string; type: string; filename: string; mimeType: string; sizeBytes: number; uploadedAt: number; url?: string }[]
  [k: string]: unknown
}

export const substepsList = makeFunctionReference<
  'query',
  { clientId?: string; status?: string; responsableId?: string; phase?: string },
  ConvexSubstepDoc[]
>('workflowSubsteps:list')

export const substepsGet = makeFunctionReference<'query', { substepId: string }, ConvexSubstepDoc | null>('workflowSubsteps:get')

export const substepsUpdate = makeFunctionReference<
  'mutation',
  { substepId: string; status?: string; dateRealisee?: string | null; heure?: string | null; responsableId?: string | null; notes?: string | null; problemReason?: string | null; problemNotes?: string | null; metadata?: unknown },
  unknown
>('workflowSubsteps:update')

export const substepsResolveProblem = makeFunctionReference<'mutation', { substepId: string; status: string }, unknown>('workflowSubsteps:resolveProblem')

// documents (pièces de sous-étape) : storage Convex + rattachement substep.
export const documentsGenerateUploadUrl = makeFunctionReference<'mutation', Record<string, never>, string>('documents:generateUploadUrl')

export const documentsAttachToSubstep = makeFunctionReference<
  'mutation',
  { substepId: string; files: Array<{ storageId: string; filename: string; mimeType: string; sizeBytes: number }> },
  unknown
>('documents:attachToSubstep')

export const documentsListBySubstep = makeFunctionReference<
  'query',
  { substepId: string },
  { id: string; type: string; filename: string; mimeType: string; sizeBytes: number; uploadedAt: number }[]
>('documents:listBySubstep')

export const documentsGetUrl = makeFunctionReference<
  'query',
  { documentId: string },
  { url: string; filename: string; mimeType: string } | null
>('documents:getUrl')

export const documentsRemove = makeFunctionReference<'mutation', { documentId: string }, { ok: true }>('documents:remove')

export type ConvexCallLogDoc = {
  _id: string; _creationTime: number; leadId: string; setterId: string
  calledAt: number; result: string; durationSec?: number; notes?: string; nextCallbackAt?: number
}
export const callLogsListBySetter = makeFunctionReference<'query', { setterId: string; limit?: number }, ConvexCallLogDoc[]>('callLogs:listBySetter')

export type ConvexCommercialObjectiveDoc = {
  _id: string; _creationTime: number; commercialId: string; period: string
  caTarget?: number; ventesTarget?: number; rdvTarget?: number; closingTarget?: number
}
export const commercialObjectivesListByPeriod = makeFunctionReference<'query', { period: string }, ConvexCommercialObjectiveDoc[]>('commercialObjectives:listByPeriod')

type PaginationOptsArg = { numItems: number; cursor: string | null }

export const usersMe = makeFunctionReference<'query', Record<string, never>, ConvexUserDoc | null>('users:me')

export const usersList = makeFunctionReference<
  'query',
  { role?: string; team?: string; active?: boolean },
  ConvexUserDoc[]
>('users:list')

export const leadsList = makeFunctionReference<
  'query',
  { status?: string; setterId?: string; assignedToId?: string; city?: string; search?: string; paginationOpts: PaginationOptsArg },
  PaginationResult<ConvexLeadDoc>
>('leads:list')

export const rdvList = makeFunctionReference<
  'query',
  { commercialId?: string; status?: string; result?: string; from?: number; to?: number; paginationOpts: PaginationOptsArg },
  PaginationResult<ConvexRdvDoc>
>('rdv:list')

// RDV d'un lead via l'index by_lead — évite de paginer toute la table quand on
// n'affiche que la fiche d'un client.
export const rdvListByLead = makeFunctionReference<'query', { leadId: string }, ConvexRdvDoc[]>('rdv:listByLead')

export const clientsList = makeFunctionReference<
  'query',
  { leadId?: string; projectId?: string; phase?: string; statusGlobal?: string; blocked?: boolean; technicienVtId?: string; unassignedVt?: boolean },
  ConvexClientDoc[]
>('clients:list')

export const leadsGet = makeFunctionReference<'query', { leadId: string }, ConvexLeadDoc | null>('leads:get')

export const leadsStats = makeFunctionReference<
  'query',
  Record<string, never>,
  { total: number; byStatus: Record<string, number>; bySource: Record<string, number>; imported: number; directGhl: number }
>('leads:stats')

export const clientsAssignTechniciens = makeFunctionReference<
  'mutation',
  { clientId: string; technicienVtIds?: string[]; technicienVtId?: string | null },
  unknown
>('clients:assignTechniciens')

export const clientsBootstrap = makeFunctionReference<'mutation', { leadId?: string; projectId?: string }, string>('clients:bootstrap')

export const clientsCreateManualDossier = makeFunctionReference<
  'mutation',
  { firstName: string; lastName: string; phone?: string; email?: string; addressLine?: string; city?: string; postalCode?: string; montantTotal?: number; typeFinancement?: string; signedAt?: number },
  string
>('clients:createManualDossier')

export const leadsCreate = makeFunctionReference<
  'mutation',
  {
    firstName?: string; lastName?: string; email?: string; phone?: string
    addressLine?: string; city?: string; postalCode?: string
    revenuFiscal?: number; typeLogement?: string; referrerId?: string
    status?: string; assignedToId?: string; canalAcquisition?: string; acquisitionChannel?: string
  },
  string
>('leads:create')

export const leadsUpdate = makeFunctionReference<
  'mutation',
  {
    leadId: string; status?: string; firstName?: string; lastName?: string; email?: string
    phone?: string; addressLine?: string; city?: string; postalCode?: string
    localisationMap?: string; revenuFiscal?: number; typeLogement?: string
    datePassageRelance?: number; assignedToId?: string
  },
  ConvexLeadDoc | null
>('leads:update')

export const leadsSoftDelete = makeFunctionReference<
  'mutation',
  { leadId: string },
  null
>('leads:softDelete')

export const rdvCreate = makeFunctionReference<
  'mutation',
  { leadId: string; commercialId?: string; scheduledAt?: number; locationType?: string; externalId?: string; notes?: string },
  string
>('rdv:create')

export const rdvGet = makeFunctionReference<'query', { rdvId: string }, ConvexRdvDoc | null>('rdv:get')

export const rdvUpdate = makeFunctionReference<
  'mutation',
  {
    rdvId: string; status?: string; result?: string | null; scheduledAt?: number
    montantTotal?: number; financingType?: string; objections?: string; nonSaleReason?: string
    kits?: string; notes?: string; debriefFilledAt?: number; signatureAt?: number
  },
  unknown
>('rdv:update')

// Accueil : signale une annulation/report reçue sur le numéro central et alerte
// le commercial concerné.
export const rdvFlagByReception = makeFunctionReference<
  'mutation',
  { rdvId: string; kind: 'annule' | 'reporte'; reason?: string; newScheduledAt?: number },
  unknown
>('rdv:flagByReception')

export const callLogsLogCall = makeFunctionReference<
  'mutation',
  { leadId: string; result: string; durationSec?: number; notes?: string; nextCallbackAt?: number },
  string
>('callLogs:logCall')

export const projectsListByLead = makeFunctionReference<'query', { leadId: string }, ConvexProjectDoc[]>('projects:listByLead')

// Fiche client : projets + débriefs + devis + pièces du lead en UN aller-retour
// (remplace la cascade listByLead → get/debriefs → devis/attachments par projet).
export const projectsFicheByLead = makeFunctionReference<
  'query',
  { leadId: string },
  { project: ConvexProjectDoc; debriefs: ConvexDebriefDoc[]; devis: ConvexDevisDoc[]; attachments: ConvexAttachmentSummary[] }[]
>('projects:ficheByLead')

export const projectsGet = makeFunctionReference<'query', { projectId: string }, ConvexProjectDoc | null>('projects:get')

export const projectsCreate = makeFunctionReference<
  'mutation',
  { leadId: string; name?: string; commercialId?: string; addressLine?: string; postalCode?: string; city?: string; notes?: string },
  string
>('projects:create')

type DebriefMutationFields = {
  outcome: string
  rdvId?: string; nonSaleReason?: string; reflexionReason?: string; suiviReason?: string
  objection?: string; acceptanceFactors?: string[]; notes?: string
  montantTotal?: number; financingType?: string; kits?: string; signedAt?: number
  paymentSubMethod?: string; financingOrg?: string; acomptePercent?: number
  acompteAmount?: number; customEcheancier?: boolean
}

export const debriefsCreateForLead = makeFunctionReference<
  'mutation',
  DebriefMutationFields & { leadId: string; commercialId?: string; projectId?: string },
  string
>('debriefs:createForLead')

export const debriefsCreate = makeFunctionReference<
  'mutation',
  DebriefMutationFields & { projectId: string; commercialId?: string },
  string
>('debriefs:create')

export const debriefsGet = makeFunctionReference<'query', { debriefId: string }, ConvexDebriefDoc | null>('debriefs:get')

export const debriefsListByLead = makeFunctionReference<'query', { leadId: string }, ConvexDebriefDoc[]>('debriefs:listByLead')

export const debriefsListByProject = makeFunctionReference<'query', { projectId: string }, ConvexDebriefDoc[]>('debriefs:listByProject')

// Analytics. Les fonctions Convex renvoient volontairement les mêmes shapes que
// les réponses REST (parité), au champ `engine` près (`convex-*` vs `backend-*`).
// On type les retours en `unknown` et on caste dans les hooks (convexHooks.ts).
export const analyticsSummary = makeFunctionReference<
  'query',
  { now: number; days?: number; from?: string; to?: string },
  unknown
>('analytics:summary')

export const analyticsFunnel = makeFunctionReference<
  'query',
  { now: number; days?: number; from?: string; to?: string; setterId?: string; sector?: string },
  unknown
>('analytics:funnel')

export const analyticsDebriefStats = makeFunctionReference<
  'query',
  { from?: string; to?: string; commercialId?: string },
  unknown
>('analytics:debriefStats')

export const analyticsSetterStats = makeFunctionReference<
  'query',
  { setterId: string; now: number; days?: number; from?: string; to?: string },
  unknown
>('analytics:setterStats')

export const analyticsCommercialStats = makeFunctionReference<
  'query',
  { commercialId: string; now: number; days?: number; from?: string; to?: string },
  unknown
>('analytics:commercialStats')

// ─── GHL calendrier & prise de RDV (actions Convex — remplace le REST NestJS) ──
export const ghlCalendarGetConfig = makeFunctionReference<'action', Record<string, never>, { configured: boolean; locationIdPresent: boolean; sectorCalendarCount: number; sectors: unknown[] }>('ghlCalendar:getConfig')
export const ghlCalendarListUsers = makeFunctionReference<'action', Record<string, never>, unknown[]>('ghlCalendar:listUsers')
export const ghlCalendarMySector = makeFunctionReference<'action', { userId?: string }, unknown>('ghlCalendar:mySector')
export const ghlCalendarFreeSlots = makeFunctionReference<'action', { from: number; to: number; sector?: string; calendarId?: string; timezone?: string }, { configured: boolean; slots: unknown[] }>('ghlCalendar:freeSlots')
export const ghlCalendarEventsAction = makeFunctionReference<'action', { from: number; to: number; sector?: string; calendarId?: string }, { configured: boolean; events: unknown[] }>('ghlCalendar:events')
export const ghlCalendarSyncEvents = makeFunctionReference<'action', { from: number; to: number; sector?: string; calendarId?: string }, unknown>('ghlCalendar:syncEvents')
export const ghlCalendarSyncLeadEvents = makeFunctionReference<'action', { leadId: string }, unknown>('ghlCalendar:syncLeadEvents')
export const ghlAppointmentsCreate = makeFunctionReference<
  'action',
  {
    leadId: string; sector: string; calendarId?: string; scheduledAt: number; locationType?: string
    notes?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null
    phone?: string | null; addressLine?: string | null; city?: string | null; postalCode?: string | null
    typeLogement?: string | null; revenuFiscal?: number | null
  },
  { rdvId: string; contactId: string; appointmentId: string | null; movedToRdvPlanifie: boolean }
>('ghlAppointments:createAppointment')
export const ghlAppointmentsUpdate = makeFunctionReference<
  'action',
  {
    rdvId: string; scheduledAt?: number; notes?: string | null
    firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null
    addressLine?: string | null; city?: string | null; postalCode?: string | null
    typeLogement?: string | null; revenuFiscal?: number | null
  },
  { ok: boolean }
>('ghlAppointments:updateAppointment')
