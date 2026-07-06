import type {
  ConvexClientDoc,
  ConvexDebriefDoc,
  ConvexLeadDoc,
  ConvexProjectDoc,
  ConvexRdvDoc,
  ConvexUserDoc,
} from './convexApi'
import type {
  ClientPhaseStep,
  ClientResponse,
  DebriefNonSaleReason,
  DebriefOutcome,
  DebriefReflexionReason,
  DebriefResponse,
  DebriefSuiviReason,
  FinancingOrg,
  FinancingType,
  LeadResponse,
  LeadSource,
  LeadStatus,
  PaymentSubMethod,
  ProjectResponse,
  ProjectStatus,
  RdvLocation,
  RdvResponse,
  RdvResult,
  RdvStatus,
  Role,
  Team,
  UserResponse,
  WorkflowPhase,
  WorkflowStatus,
} from './types'

// Convertit les docs Convex vers les types REST existants : les composants
// consomment les mêmes shapes quelle que soit la source. Convention :
// optionnel absent → null (les types REST sont nullable, pas optionnels),
// timestamps numériques Convex → ISO strings.

const iso = (ms: number | undefined): string | null => (ms === undefined ? null : new Date(ms).toISOString())

export function mapConvexUser(doc: ConvexUserDoc): UserResponse {
  return {
    id: doc._id,
    email: doc.email ?? '',
    name: doc.name ?? doc.email ?? '',
    phone: doc.phone ?? null,
    image: doc.image ?? null,
    ghlUserId: doc.ghlUserId ?? null,
    ghlCalendarId: doc.ghlCalendarId ?? null,
    ghlLocationId: null,
    // même défaut que roleOf() côté serveur (model/access.ts)
    role: (doc.role ?? 'setter') as Role,
    team: (doc.team ?? null) as Team,
    active: doc.active ?? true,
    lastSeenAt: null,
    lastLoginAt: null,
    lastActionAt: null,
    lastActionType: null,
    createdAt: new Date(doc._creationTime).toISOString(),
    updatedAt: new Date(doc._creationTime).toISOString(),
  }
}

export function mapConvexLead(doc: ConvexLeadDoc): LeadResponse {
  return {
    id: doc._id,
    externalId: doc.externalId ?? null,
    source: doc.source as LeadSource,
    status: doc.status as LeadStatus,
    firstName: doc.firstName ?? null,
    lastName: doc.lastName ?? null,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    addressLine: doc.addressLine ?? null,
    city: doc.city ?? null,
    postalCode: doc.postalCode ?? null,
    localisationMap: doc.localisationMap ?? null,
    revenuFiscal: doc.revenuFiscal ?? null,
    typeLogement: doc.typeLogement ?? null,
    utmSource: doc.utmSource ?? null,
    utmMedium: doc.utmMedium ?? null,
    utmCampaign: doc.utmCampaign ?? null,
    campaign: doc.campaign ?? null,
    adset: doc.adset ?? null,
    ad: doc.ad ?? null,
    canalAcquisition: doc.canalAcquisition ?? null,
    setterId: doc.setterId ?? null,
    assignedToId: doc.assignedToId ?? null,
    referrerId: doc.referrerId ?? null,
    lastContactAt: iso(doc.lastContactAt),
    latestCallAt: iso(doc.latestCallAt),
    firstCallAt: iso(doc.firstCallAt),
    latestCallComment: doc.latestCallComment ?? null,
    latestCallSetterId: doc.latestCallSetterId ?? null,
    // Champs dérivés côté NestJS (jointures/aggrégats) — pas encore portés
    // sur le read-path Convex : valeurs neutres en tranche 1.
    assignedSetterIds: doc.setterId ? [doc.setterId] : [],
    latestRdvAt: null,
    latestRdvStatus: null,
    latestRdvCommercialId: null,
    jauge11Jours: null,
    datePassageRelance: null,
    createdAt: new Date(doc._creationTime).toISOString(),
    updatedAt: new Date(doc._creationTime).toISOString(),
    joursSansContact: null,
    joursRelance: null,
    callCount: 0,
    callsToday: 0,
    nextCallbackAt: null,
    callbackSetAt: null,
    firstCallUnderFiveMin: null,
    monetaryValue: null,
    ghlStageName: null,
    ghlPipelineId: null,
    lostReason: null,
    lastStageChangeAt: null,
    daysSinceLastStageChange: null,
    arrivalAt: null,
    transferredAt: null,
  }
}

export function mapConvexRdv(doc: ConvexRdvDoc): RdvResponse {
  return {
    id: doc._id,
    externalId: doc.externalId ?? null,
    leadId: doc.leadId,
    commercialId: doc.commercialId ?? null,
    scheduledAt: iso(doc.scheduledAt) ?? new Date(doc._creationTime).toISOString(),
    locationType: doc.locationType as RdvLocation,
    status: doc.status as RdvStatus,
    result: (doc.result ?? null) as RdvResult | null,
    signatureAt: iso(doc.signatureAt),
    // numeric Postgres sérialisé en string côté REST — on garde la convention
    montantTotal: doc.montantTotal === undefined ? null : String(doc.montantTotal),
    financingType: (doc.financingType ?? null) as FinancingType | null,
    objections: doc.objections ?? null,
    nonSaleReason: doc.nonSaleReason ?? null,
    kits: doc.kits ?? null,
    notes: doc.notes ?? null,
    debriefFilledAt: iso(doc.debriefFilledAt),
    debriefDueAt: iso(doc.debriefDueAt),
    hasDevisEnAttente: false,
    createdAt: new Date(doc._creationTime).toISOString(),
    updatedAt: new Date(doc._creationTime).toISOString(),
    lead: null,
  }
}

export function mapConvexProject(doc: ConvexProjectDoc): ProjectResponse {
  return {
    id: doc._id,
    leadId: doc.leadId,
    commercialId: doc.commercialId,
    name: doc.name,
    addressLine: doc.addressLine ?? null,
    postalCode: doc.postalCode ?? null,
    city: doc.city ?? null,
    status: doc.status as ProjectStatus,
    notes: doc.notes ?? null,
    createdAt: new Date(doc._creationTime).toISOString(),
    updatedAt: new Date(doc._creationTime).toISOString(),
  }
}

export function mapConvexDebrief(doc: ConvexDebriefDoc): DebriefResponse {
  return {
    id: doc._id,
    projectId: doc.projectId ?? null,
    leadId: doc.leadId ?? null,
    rdvId: doc.rdvId ?? null,
    commercialId: doc.commercialId,
    outcome: doc.outcome as DebriefOutcome,
    nonSaleReason: (doc.nonSaleReason ?? null) as DebriefNonSaleReason | null,
    reflexionReason: (doc.reflexionReason ?? null) as DebriefReflexionReason | null,
    suiviReason: (doc.suiviReason ?? null) as DebriefSuiviReason | null,
    objection: doc.objection ?? null,
    acceptanceFactors: doc.acceptanceFactors ?? [],
    notes: doc.notes ?? null,
    montantTotal: doc.montantTotal === undefined ? null : String(doc.montantTotal),
    financingType: (doc.financingType ?? null) as FinancingType | null,
    kits: doc.kits ?? null,
    paymentSubMethod: (doc.paymentSubMethod ?? null) as PaymentSubMethod | null,
    financingOrg: (doc.financingOrg ?? null) as FinancingOrg | null,
    acomptePercent: doc.acomptePercent ?? null,
    acompteAmount: doc.acompteAmount === undefined ? null : String(doc.acompteAmount),
    signedAt: iso(doc.signedAt),
    createdAt: new Date(doc._creationTime).toISOString(),
    updatedAt: new Date(doc._creationTime).toISOString(),
  }
}

export function mapConvexClient(doc: ConvexClientDoc): ClientResponse {
  const steps: Partial<Record<WorkflowPhase, ClientPhaseStep>> = {}
  for (const [phase, s] of Object.entries(doc.steps ?? {})) {
    steps[phase as WorkflowPhase] = {
      status: s.status as WorkflowStatus,
      datePlanifiee: s.datePlanifiee,
      dateRealisee: s.dateRealisee,
      problemReason: s.problemReason,
      responsableId: s.responsableId,
    }
  }
  return {
    id: doc._id,
    leadId: doc.leadId,
    projectId: doc.projectId ?? null,
    rdvId: doc.rdvId ?? null,
    lead: doc.lead ?? { fullName: null, city: null, phone: null },
    technicienVtId: doc.technicienVtId ?? null,
    techniciens: doc.techniciens ?? [],
    poseTeamLeadId: doc.poseTeamLeadId ?? null,
    adminReferentId: doc.adminReferentId ?? null,
    statusGlobal: doc.statusGlobal,
    currentPhase: doc.currentPhase as WorkflowPhase,
    blocked: doc.blocked,
    missingDocsCount: doc.missingDocs ?? 0,
    signedAt: iso(doc.signedAt),
    steps,
  }
}
