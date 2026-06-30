import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  roleValidator, teamValidator,
  leadStatusValidator, leadSourceValidator, adChannelValidator, stageHistorySourceValidator,
  callResultValidator,
  rdvStatusValidator, rdvLocationValidator, rdvResultValidator, financingTypeValidator,
  projectStatusValidator, debriefOutcomeValidator, debriefNonSaleReasonValidator,
  debriefReflexionReasonValidator, debriefSuiviReasonValidator,
  paymentSubMethodValidator, financingOrgValidator,
  devisStatusValidator, ocrStatusValidator,
} from "./model/enums";

export default defineSchema({
  ...authTables,

  users: defineTable({
    // —— identité (écrite par Convex Auth) ——
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    phone: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    // —— métier ——
    externalId: v.optional(v.string()),
    role: v.optional(roleValidator), // défaut "setter" appliqué via roleOf() — jamais écrit au login
    team: v.optional(teamValidator),
    active: v.optional(v.boolean()),
    ghlUserId: v.optional(v.string()),
    ghlCalendarId: v.optional(v.string()),
    ghlLocationId: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
    lastActionAt: v.optional(v.number()),
    lastActionType: v.optional(v.string()),
    createdById: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_externalId", ["externalId"])
    .index("by_ghlUserId", ["ghlUserId"])
    .index("by_role", ["role"]),

  referrers: defineTable({
    nom: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    externalId: v.optional(v.string()),
  })
    .index("by_externalId", ["externalId"])
    .index("by_active", ["active"]),

  leads: defineTable({
    externalId: v.optional(v.string()),
    source: leadSourceValidator,
    status: leadStatusValidator,
    // identité
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    localisationMap: v.optional(v.string()),
    // qualif solaire
    revenuFiscal: v.optional(v.number()),
    typeLogement: v.optional(v.string()),
    // tracking pub
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
    campaign: v.optional(v.string()),
    adset: v.optional(v.string()),
    ad: v.optional(v.string()),
    canalAcquisition: v.optional(v.string()),
    acquisitionChannel: v.optional(adChannelValidator),
    campaignId: v.optional(v.string()),
    adsetId: v.optional(v.string()),
    adId: v.optional(v.string()),
    attributionMedium: v.optional(v.string()),
    attributionSessionSource: v.optional(v.string()),
    // workflow
    setterId: v.optional(v.id("users")),
    assignedToId: v.optional(v.id("users")),
    referrerId: v.optional(v.id("referrers")),
    lastContactAt: v.optional(v.number()),
    datePassageRelance: v.optional(v.number()),
    // pont GHL (non alimenté cette tranche)
    monetaryValue: v.optional(v.number()),
    ghlStageName: v.optional(v.string()),
    ghlPipelineId: v.optional(v.string()),
    lostReason: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_status_setter", ["status", "setterId"])
    .index("by_setter", ["setterId"])
    .index("by_externalId", ["externalId"])
    .index("by_lastContact", ["lastContactAt"])
    .index("by_city", ["city"])
    .index("by_assignedTo", ["assignedToId"])
    .index("by_acquisitionChannel", ["acquisitionChannel"]),

  leadStageHistory: defineTable({
    leadId: v.id("leads"),
    ghlStageName: v.string(),
    saasStatus: leadStatusValidator,
    assignedToId: v.optional(v.id("users")),
    monetaryValue: v.optional(v.number()),
    changedAt: v.number(),
    source: stageHistorySourceValidator,
    webhookEventId: v.optional(v.string()),
    externalId: v.optional(v.string()),
  })
    .index("by_lead_changedAt", ["leadId", "changedAt"])
    .index("by_changedAt", ["changedAt"])
    .index("by_lead_stage_changedAt", ["leadId", "ghlStageName", "changedAt"]),

  leadCustomFields: defineTable({
    leadId: v.id("leads"),
    fieldKey: v.string(),
    fieldName: v.string(),
    value: v.optional(v.string()),
    externalId: v.optional(v.string()),
  }).index("by_lead_field", ["leadId", "fieldKey"]),

  callLogs: defineTable({
    externalId: v.optional(v.string()),
    leadId: v.id("leads"),
    setterId: v.optional(v.id("users")),
    calledAt: v.number(),
    result: callResultValidator,
    durationSec: v.optional(v.number()),
    ringoverCallId: v.optional(v.string()),
    ringoverChannelId: v.optional(v.string()),
    ringoverStatus: v.optional(v.string()),
    ringoverPayload: v.optional(v.any()),
    nextCallbackAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_lead_calledAt", ["leadId", "calledAt"])
    .index("by_setter_calledAt", ["setterId", "calledAt"])
    .index("by_callback", ["nextCallbackAt"])
    .index("by_calledAt", ["calledAt"])
    .index("by_ringoverCallId", ["ringoverCallId"]),

  rdv: defineTable({
    externalId: v.optional(v.string()),
    leadId: v.id("leads"),
    commercialId: v.optional(v.id("users")),
    scheduledAt: v.optional(v.number()),
    locationType: rdvLocationValidator,
    status: rdvStatusValidator,
    // débrief inline
    result: v.optional(rdvResultValidator),
    signatureAt: v.optional(v.number()),
    montantTotal: v.optional(v.number()),
    financingType: v.optional(financingTypeValidator),
    objections: v.optional(v.string()),
    nonSaleReason: v.optional(v.string()),
    kits: v.optional(v.string()),
    notes: v.optional(v.string()),
    debriefFilledAt: v.optional(v.number()),
    debriefDueAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_commercial_scheduled", ["commercialId", "scheduledAt"])
    .index("by_lead", ["leadId"])
    .index("by_debriefDue", ["debriefDueAt"])
    .index("by_signature", ["signatureAt"])
    .index("by_scheduledAt", ["scheduledAt"])
    .index("by_status", ["status"])
    .index("by_externalId", ["externalId"]),

  projects: defineTable({
    externalId: v.optional(v.string()),
    leadId: v.id("leads"),
    commercialId: v.id("users"),
    name: v.string(),
    addressLine: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
    status: projectStatusValidator,
    notes: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_lead", ["leadId"])
    .index("by_commercial", ["commercialId"])
    .index("by_status", ["status"])
    .index("by_externalId", ["externalId"]),

  debriefs: defineTable({
    externalId: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    leadId: v.optional(v.id("leads")),
    rdvId: v.optional(v.id("rdv")),
    commercialId: v.id("users"),
    outcome: debriefOutcomeValidator,
    nonSaleReason: v.optional(debriefNonSaleReasonValidator),
    reflexionReason: v.optional(debriefReflexionReasonValidator),
    suiviReason: v.optional(debriefSuiviReasonValidator),
    objection: v.optional(v.string()),
    acceptanceFactors: v.array(v.string()),
    notes: v.optional(v.string()),
    montantTotal: v.optional(v.number()),
    financingType: v.optional(financingTypeValidator),
    kits: v.optional(v.string()),
    signedAt: v.optional(v.number()),
    paymentSubMethod: v.optional(paymentSubMethodValidator),
    financingOrg: v.optional(financingOrgValidator),
    acomptePercent: v.optional(v.number()),
    acompteAmount: v.optional(v.number()),
    customEcheancier: v.boolean(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_lead", ["leadId"])
    .index("by_rdv", ["rdvId"])
    .index("by_outcome", ["outcome"])
    .index("by_externalId", ["externalId"]),

  devis: defineTable({
    externalId: v.optional(v.string()),
    leadId: v.id("leads"),
    projectId: v.optional(v.id("projects")),
    rdvId: v.optional(v.id("rdv")),
    commercialId: v.id("users"),
    status: devisStatusValidator,
    storageId: v.optional(v.id("_storage")),
    filename: v.string(),
    sizeBytes: v.number(),
    ocrStatus: ocrStatusValidator,
    ocrError: v.optional(v.string()),
    ocrCompletedAt: v.optional(v.number()),
    devisNumber: v.optional(v.string()),
    devisDate: v.optional(v.string()),
    dateExpiration: v.optional(v.string()),
    delaiExecution: v.optional(v.string()),
    montantHt: v.optional(v.number()),
    montantTva: v.optional(v.number()),
    montantTtc: v.optional(v.number()),
    montantNet: v.optional(v.number()),
    puissanceKwc: v.optional(v.number()),
    nbPanneaux: v.optional(v.number()),
    kits: v.optional(v.string()),
    financingType: v.optional(financingTypeValidator),
    primeAutoconsommation: v.optional(v.number()),
    primeTarifKwc: v.optional(v.number()),
    primeZone: v.optional(v.string()),
    lignes: v.array(v.any()),
    echeancier: v.array(v.any()),
    extracted: v.any(),
    signedAt: v.optional(v.number()),
    markedSignedById: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_lead", ["leadId"])
    .index("by_project", ["projectId"])
    .index("by_rdv", ["rdvId"])
    .index("by_status", ["status"])
    .index("by_commercial", ["commercialId"])
    .index("by_externalId", ["externalId"]),
});
