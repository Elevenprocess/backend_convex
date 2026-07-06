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

type PaginationOptsArg = { numItems: number; cursor: string | null }

export const usersMe = makeFunctionReference<'query', Record<string, never>, ConvexUserDoc | null>('users:me')

export const usersList = makeFunctionReference<
  'query',
  { role?: string; team?: string; active?: boolean },
  ConvexUserDoc[]
>('users:list')

export const leadsList = makeFunctionReference<
  'query',
  { status?: string; setterId?: string; city?: string; paginationOpts: PaginationOptsArg },
  PaginationResult<ConvexLeadDoc>
>('leads:list')

export const rdvList = makeFunctionReference<
  'query',
  { commercialId?: string; status?: string; result?: string; from?: number; to?: number; paginationOpts: PaginationOptsArg },
  PaginationResult<ConvexRdvDoc>
>('rdv:list')

export const clientsList = makeFunctionReference<
  'query',
  { leadId?: string; projectId?: string; phase?: string; statusGlobal?: string; blocked?: boolean; technicienVtId?: string; unassignedVt?: boolean },
  ConvexClientDoc[]
>('clients:list')

export const leadsGet = makeFunctionReference<'query', { leadId: string }, ConvexLeadDoc | null>('leads:get')

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

export const callLogsLogCall = makeFunctionReference<
  'mutation',
  { leadId: string; result: string; durationSec?: number; notes?: string; nextCallbackAt?: number },
  string
>('callLogs:logCall')

export const projectsListByLead = makeFunctionReference<'query', { leadId: string }, ConvexProjectDoc[]>('projects:listByLead')

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
