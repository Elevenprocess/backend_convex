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
