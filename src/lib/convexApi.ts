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
