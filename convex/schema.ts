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
  acompteStatutValidator, legacyAcompteStatutValidator, echeanceJalonValidator,
  // Délivrabilité (Tranche 6a)
  clientStatusValidator, workflowPhaseValidator, workflowStatusValidator,
  workflowSubstepKeyValidator, problemReasonValidator, productTypeValidator,
  documentTypeValidator,
  // Webhooks entrants (Tranche 8a)
  webhookProviderValidator, webhookEventStatusValidator,
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
    // Convex Auth exige un index littéralement nommé "email" (rattachement par
    // email vérifié au login OAuth Google → pas de doublon de compte).
    .index("email", ["email"])
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
    // Id du contact GHL. Distinct d'externalId qui, pour les lignes issues de
    // Render, porte l'uuid Postgres (les leads créés par les webhooks Convex
    // ont externalId = id GHL). Requis pour résoudre les webhooks GHL
    // (contact_id) et pousser le champ lien_debrief — backfillé depuis
    // leads.external_id PG, alimenté au fil de l'eau par la sync catchup.
    ghlContactId: v.optional(v.string()),
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
    // Posé uniquement par le backfill/migration (lignes historiques) ; les
    // webhooks live laissent _creationTime faire foi. Lu en priorité par les
    // KPI datés une fois la migration branchée (cf. risque _creationTime).
    createdAt: v.optional(v.number()),
    // Champ de recherche dénormalisé legacy (import GHL/migration) : plus alimenté
    // ni lu par le code, conservé optionnel pour tolérer les documents existants.
    searchText: v.optional(v.string()),
  })
    .index("by_status_setter", ["status", "setterId"])
    .index("by_setter", ["setterId"])
    .index("by_externalId", ["externalId"])
    .index("by_lastContact", ["lastContactAt"])
    .index("by_city", ["city"])
    .index("by_assignedTo", ["assignedToId"])
    .index("by_acquisitionChannel", ["acquisitionChannel"])
    .index("by_ghlContactId", ["ghlContactId"]),

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

  // Audit trail des webhooks entrants (parité webhook_events NestJS) : le raw
  // payload survit à l'échec du traitement → replay/debug possibles.
  webhookEvents: defineTable({
    provider: webhookProviderValidator,
    eventType: v.string(),
    payload: v.string(), // JSON.stringify du body brut
    status: webhookEventStatusValidator,
    error: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    processedAt: v.optional(v.number()),
  }).index("by_status", ["status"]),

  // Fallback de classification du canal d'acquisition : rawSource (normalisé
  // lowercase/trim, unique par convention d'écriture) → canal.
  acquisitionSourceMap: defineTable({
    rawSource: v.string(),
    channel: adChannelValidator,
    label: v.string(),
    updatedAt: v.optional(v.number()),
  }).index("by_rawSource", ["rawSource"]),

  // Invitations d'onboarding (ajout/réactivation de commerciaux & équipiers).
  // Portage de userInvitations (NestJS) adapté à Convex Auth : l'invité s'inscrit
  // via le flux auth, puis `accept` applique rôle/équipe/activation. Token stocké
  // en clair (écart assumé vs hash NestJS — outil interne, table role-gated).
  userInvitations: defineTable({
    email: v.string(),
    name: v.string(),
    role: roleValidator,
    team: v.optional(teamValidator),
    phone: v.optional(v.string()),
    token: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    invitedById: v.optional(v.id("users")),
    expiresAt: v.number(),
    acceptedUserId: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    targetUserId: v.optional(v.id("users")), // réactivation (renew)
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  // Objectifs commerciaux par mois (une ligne par commercial × période YYYY-MM).
  // Portage de commercialObjectives (NestJS) — pilotage des business managers.
  commercialObjectives: defineTable({
    commercialId: v.id("users"),
    period: v.string(), // "YYYY-MM"
    caTarget: v.optional(v.number()),
    ventesTarget: v.optional(v.number()),
    rdvTarget: v.optional(v.number()),
    closingTarget: v.optional(v.number()),
    createdById: v.optional(v.id("users")),
    updatedById: v.optional(v.id("users")),
  })
    .index("by_period", ["period"])
    .index("by_commercial_period", ["commercialId", "period"]),

  // Cache des lectures calendrier GHL (TTL 60 s) — remplace la Map mémoire
  // NestJS qui ne survit pas aux isolates Convex. Évite de marteler GHL
  // quand plusieurs agendas sont ouverts.
  ghlEventsCache: defineTable({
    key: v.string(),
    payload: v.string(), // JSON.stringify(GhlCalendarEvent[])
    expiresAt: v.number(),
  }).index("by_key", ["key"]),

  leadCustomFields: defineTable({
    leadId: v.id("leads"),
    fieldKey: v.string(),
    fieldName: v.string(),
    value: v.optional(v.string()),
    externalId: v.optional(v.string()),
  }).index("by_lead_field", ["leadId", "fieldKey"]),

  callLogs: defineTable({
    externalId: v.optional(v.string()),
    // Optionnel : les appels Ringover non rattachés à un lead (migration NestJS)
    // n'ont pas de leadId. logCall exige toujours un lead.
    leadId: v.optional(v.id("leads")),
    setterId: v.optional(v.id("users")),
    calledAt: v.number(),
    result: callResultValidator,
    durationSec: v.optional(v.number()),
    ringoverCallId: v.optional(v.string()),
    ringoverChannelId: v.optional(v.string()),
    ringoverStatus: v.optional(v.string()),
    // Pas de ringoverPayload ici : le payload webhook complet reste dans
    // Postgres (jamais lu par l'app, et les queries lisent les docs EN ENTIER —
    // l'embarquer gonflerait chaque lecture analytics). Exclu aussi des synchros.
    nextCallbackAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_lead_calledAt", ["leadId", "calledAt"])
    .index("by_setter_calledAt", ["setterId", "calledAt"])
    .index("by_callback", ["nextCallbackAt"])
    .index("by_calledAt", ["calledAt"])
    .index("by_ringoverCallId", ["ringoverCallId"])
    .index("by_externalId", ["externalId"]),

  rdv: defineTable({
    externalId: v.optional(v.string()),
    // Id du rendez-vous GHL (calendar event). Distinct d'externalId qui, pour
    // les lignes issues de Render, porte l'uuid Postgres. Requis pour résoudre
    // les webhooks GHL (appointment_id) — backfillé depuis rdv.external_id PG,
    // alimenté au fil de l'eau par la sync catchup.
    ghlEventId: v.optional(v.string()),
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
    // Signalement d'annulation/report par l'accueil (responsable_technique /
    // back_office) reçu par appel ou WhatsApp sur le numéro central. Alimente
    // l'alerte immédiate au commercial concerné (carte Rappels + push).
    cancelReason: v.optional(v.string()),
    receptionAlertAt: v.optional(v.number()),
    receptionAlertKind: v.optional(v.union(v.literal("annule"), v.literal("reporte"))),
    receptionAlertBy: v.optional(v.id("users")),
    // Timestamp de migration legacy (non alimenté/lu par le code), toléré optionnel.
    createdAt: v.optional(v.number()),
  })
    .index("by_commercial_scheduled", ["commercialId", "scheduledAt"])
    .index("by_lead", ["leadId"])
    .index("by_debriefDue", ["debriefDueAt"])
    .index("by_signature", ["signatureAt"])
    .index("by_scheduledAt", ["scheduledAt"])
    .index("by_status", ["status"])
    .index("by_externalId", ["externalId"])
    .index("by_ghlEventId", ["ghlEventId"]),

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
    // Vraie date de création Render (debriefs.created_at). Posé par la migration ;
    // les débriefs live laissent _creationTime faire foi. Lu en priorité par les
    // KPI datés (mêmes raisons que leads.createdAt : _creationTime non antidatable).
    createdAt: v.optional(v.number()),
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

  // ─── Finances : tranche 5 ────────────────────────────────────────────────

  /** Échéancier multi-tranches déclenché par jalons suivi (paiements modernes). */
  acompteEcheances: defineTable({
    debriefId: v.id("debriefs"),
    leadId: v.optional(v.id("leads")),
    ordre: v.number(),
    label: v.optional(v.string()),
    percent: v.optional(v.number()),
    montantPrevu: v.optional(v.number()),
    jalonKey: v.optional(echeanceJalonValidator),
    statut: acompteStatutValidator,
    montantReel: v.optional(v.number()),
    dateEcheance: v.optional(v.string()),   // YYYY-MM-DD
    dateEncaissement: v.optional(v.string()), // YYYY-MM-DD
    notes: v.optional(v.string()),
    recordedById: v.optional(v.id("users")),
  })
    .index("by_debrief_ordre", ["debriefId", "ordre"])
    .index("by_lead", ["leadId"])
    .index("by_statut", ["statut"]),

  /** Legacy : encaissements simples (1 ligne par debrief, modèle OCR historique). */
  acompteEncaissements: defineTable({
    debriefId: v.id("debriefs"),
    leadId: v.optional(v.id("leads")),
    statut: legacyAcompteStatutValidator,
    montantReel: v.optional(v.number()),
    dateEncaissement: v.optional(v.string()), // YYYY-MM-DD
    notes: v.optional(v.string()),
    recordedById: v.optional(v.id("users")),
  })
    .index("by_debrief", ["debriefId"])
    .index("by_lead", ["leadId"])
    .index("by_statut", ["statut"]),

  /**
   * Legacy OCR : paiements importés depuis Airtable / clients NestJS.
   * TODO(délivrabilité): clientId passera en Id<"clients"> quand la table clients sera portée.
   */
  payments: defineTable({
    clientId: v.string(), // PLACEHOLDER — sera Id<"clients"> après portage délivrabilité
    type: v.string(),
    montantTheorique: v.number(),
    montantReel: v.optional(v.number()),
    statut: v.optional(legacyAcompteStatutValidator),
    dateEncaissement: v.optional(v.string()), // YYYY-MM-DD
  })
    .index("by_client_type", ["clientId", "type"])
    .index("by_statut", ["statut"]),

  // ─── Délivrabilité : tranche 6a ────────────────────────────────────────────

  /**
   * Dossier délivrabilité créé à la signature d'une vente.
   * statusGlobal / currentPhase / blocked sont des DÉRIVÉS STOCKÉS (écrits
   * uniquement par recomputeStatus, jamais directement).
   */
  clients: defineTable({
    externalId: v.optional(v.string()),
    leadId: v.id("leads"),
    projectId: v.optional(v.id("projects")),
    rdvId: v.optional(v.id("rdv")),
    // Refs utilisateurs
    adminReferentId: v.optional(v.id("users")),
    poseTeamLeadId: v.optional(v.id("users")),
    technicienVtId: v.optional(v.id("users")),
    // Équipement
    panneauProductId: v.optional(v.id("products")),
    panneauQty: v.optional(v.number()),
    onduleurProductId: v.optional(v.id("products")),
    onduleurQty: v.optional(v.number()),
    batterieProductId: v.optional(v.id("products")),
    batterieQty: v.optional(v.number()),
    // Vente
    montantTotal: v.optional(v.number()),
    typeFinancement: v.optional(financingTypeValidator),
    kits: v.optional(v.string()),
    signedAt: v.optional(v.number()), // ms
    // Dérivés STOCKÉS (recomputeStatus uniquement)
    statusGlobal: clientStatusValidator,
    currentPhase: workflowPhaseValidator,
    blocked: v.boolean(),
    // Divers
    solteoProjectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_lead", ["leadId"])
    .index("by_project", ["projectId"])
    .index("by_status", ["statusGlobal"])
    .index("by_phase", ["currentPhase"])
    .index("by_blocked", ["blocked"])
    .index("by_adminReferent", ["adminReferentId"])
    .index("by_externalId", ["externalId"]),

  /**
   * Une étape de workflow par phase (vt / dp / racco / installation / consuel / mes)
   * pour chaque dossier client.
   */
  workflowSteps: defineTable({
    externalId: v.optional(v.string()),
    clientId: v.id("clients"),
    phase: workflowPhaseValidator,
    status: workflowStatusValidator,
    datePlanifiee: v.optional(v.string()),   // YYYY-MM-DD
    dateRealisee: v.optional(v.string()),    // YYYY-MM-DD
    deadline: v.optional(v.string()),        // YYYY-MM-DD
    responsableId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    problemReason: v.optional(problemReasonValidator),
    problemNotes: v.optional(v.string()),
    problemResolvedAt: v.optional(v.number()), // ms
    metadata: v.optional(v.any()),
    lastSlaNotifiedAt: v.optional(v.number()), // ms
  })
    .index("by_client", ["clientId"])
    .index("by_client_phase", ["clientId", "phase"])
    .index("by_status", ["status"])
    .index("by_deadline", ["deadline"])
    .index("by_responsable", ["responsableId"]),

  /**
   * Sous-étapes atomiques d'une phase de workflow.
   * by_client_key est requis par le seam isJalonReached (tâche 9).
   */
  workflowSubsteps: defineTable({
    externalId: v.optional(v.string()),
    stepId: v.id("workflowSteps"),
    clientId: v.id("clients"),
    key: workflowSubstepKeyValidator,
    position: v.number(),
    status: workflowStatusValidator,
    optional: v.boolean(),
    dateRealisee: v.optional(v.string()),    // YYYY-MM-DD
    deadline: v.optional(v.string()),        // YYYY-MM-DD
    heure: v.optional(v.string()),           // HH:MM (VT — renseigné en 6c)
    responsableId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    problemReason: v.optional(problemReasonValidator),
    problemNotes: v.optional(v.string()),
    problemResolvedAt: v.optional(v.number()), // ms
    lastSlaNotifiedAt: v.optional(v.number()), // ms
    metadata: v.optional(v.any()),
  })
    .index("by_client", ["clientId"])
    .index("by_step", ["stepId"])
    .index("by_client_key", ["clientId", "key"])
    .index("by_step_key", ["stepId", "key"])
    .index("by_status", ["status"])
    .index("by_deadline", ["deadline"])
    .index("by_responsable", ["responsableId"]),

  /**
   * Pièces (documents) des sous-étapes workflow. Les bytea document_files
   * NestJS deviennent le storage Convex. uploadedAt = _creationTime.
   * L'anti-doublon (client, substep, type, filename) NestJS n'a pas
   * d'équivalent natif : sans matérialisation d'imports (différée), l'upload
   * utilisateur ne déduplique pas (parité NestJS).
   */
  documents: defineTable({
    externalId: v.optional(v.string()),
    clientId: v.id("clients"),
    workflowStepId: v.optional(v.id("workflowSteps")),
    workflowSubstepId: v.optional(v.id("workflowSubsteps")),
    type: documentTypeValidator,
    // Optionnel : pièces migrées de NestJS dont le blob disque/R2 a été perdu
    // avant la bascule bytea (métadonnées conservées, contenu absent).
    storageId: v.optional(v.id("_storage")),
    filename: v.string(),
    sizeBytes: v.number(),
    mimeType: v.string(),
    uploadedById: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()), // ms
  })
    .index("by_client", ["clientId"])
    .index("by_substep", ["workflowSubstepId"]),

  /**
   * Jonction multi-techniciens VT.
   * Unicité (clientId, userId) garantie par la mutation assignTechniciens
   * (remplacement complet du set — seule écriture de cette table).
   */
  vtTechniciens: defineTable({
    clientId: v.id("clients"),
    userId: v.id("users"),
  })
    .index("by_client", ["clientId"])
    .index("by_user", ["userId"]),

  /**
   * Notifications cloche (l'emit socket NestJS est remplacé par la réactivité
   * Convex : la cloche s'abonne à notifications.listMine).
   */
  notifications: defineTable({
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    payload: v.optional(v.any()),
    readAt: v.optional(v.number()), // ms
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "readAt"]),

  /**
   * Audit des changements de statut workflow.
   * Écart NestJS : pas d'ip/userAgent (pas de contexte requête en Convex).
   */
  auditLog: defineTable({
    userId: v.id("users"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    // Renseignés uniquement sur les lignes migrées de NestJS (pas de contexte
    // requête en Convex pour les nouvelles écritures).
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_user", ["userId"]),

  /**
   * Catalogue de produits (panneaux, onduleurs, batteries).
   * CRUD / gestion du stock hors-scope 6a.
   */
  products: defineTable({
    externalId: v.optional(v.string()),
    nom: v.string(),
    marque: v.optional(v.string()),
    type: productTypeValidator,
    stockActuel: v.number(),
    seuilAlerte: v.number(),
    metadata: v.optional(v.any()),
  })
    .index("by_type", ["type"])
    .index("by_externalId", ["externalId"]),

  /**
   * Pièces jointes projet (photos/documents commercial) migrées de NestJS
   * (project_attachments + attachment_files bytea → storage Convex).
   * La matérialisation croisée vers `documents` (read-path NestJS) sera
   * recâblée plus tard ; ici on conserve la source telle quelle.
   */
  projectAttachments: defineTable({
    externalId: v.optional(v.string()),
    projectId: v.id("projects"),
    uploadedById: v.optional(v.id("users")),
    kind: v.string(), // photo | document (enum PG attachment_kind)
    label: v.optional(v.string()),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    // Absent si le blob disque/R2 a été perdu avant la bascule bytea NestJS.
    storageId: v.optional(v.id("_storage")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_externalId", ["externalId"]),

  /**
   * Archive fidèle des tables NestJS sans équivalent fonctionnel Convex
   * (webhook_events, airtable_raw_records/import_errors, assistant_*,
   * user_invitations, sessions better-auth…). `data` = row_to_json intégral.
   */
  legacyArchive: defineTable({
    table: v.string(),
    externalId: v.optional(v.string()),
    data: v.any(),
  }).index("by_table", ["table"]),
});
