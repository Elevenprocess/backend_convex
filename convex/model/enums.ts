import { v, Validator } from "convex/values";

export const ROLES = [
  "admin", "setter", "setter_lead", "commercial", "commercial_lead",
  "delivrabilite", "responsable_technique", "back_office", "technicien", "finances",
] as const;
export type Role = (typeof ROLES)[number];
export const roleValidator = v.union(...ROLES.map((r) => v.literal(r))) as Validator<Role>;

export const TEAMS = ["setting", "closing", "admin", "delivrabilite"] as const;
export type Team = (typeof TEAMS)[number];
export const teamValidator = v.union(...TEAMS.map((t) => v.literal(t))) as Validator<Team>;

export const LEAD_SOURCES = ["ghl", "airtable_migration", "manual", "referrer"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const leadSourceValidator = v.union(...LEAD_SOURCES.map((s) => v.literal(s))) as Validator<LeadSource>;

export const LEAD_STATUSES = [
  "nouveau", "qualifie", "rdv_pris", "rdv_honore", "signature_en_cours",
  "signe", "perdu", "relance", "pas_qualifie", "a_rappeler", "pas_de_reponse",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const leadStatusValidator = v.union(...LEAD_STATUSES.map((s) => v.literal(s))) as Validator<LeadStatus>;

export const CALL_RESULTS = [
  "joint", "non_joint", "rappel_planifie", "rdv_pris", "refus", "injoignable", "messagerie",
] as const;
export type CallResult = (typeof CALL_RESULTS)[number];
export const callResultValidator = v.union(...CALL_RESULTS.map((c) => v.literal(c))) as Validator<CallResult>;

export const AD_CHANNELS = [
  "meta", "google", "tiktok", "linkedin", "microsoft", "organic", "referral", "direct", "other",
] as const;
export type AdChannel = (typeof AD_CHANNELS)[number];
export const adChannelValidator = v.union(...AD_CHANNELS.map((c) => v.literal(c))) as Validator<AdChannel>;

export const STAGE_HISTORY_SOURCES = ["webhook", "manual", "backfill"] as const;
export type StageHistorySource = (typeof STAGE_HISTORY_SOURCES)[number];
export const stageHistorySourceValidator = v.union(
  ...STAGE_HISTORY_SOURCES.map((s) => v.literal(s)),
) as Validator<StageHistorySource>;

export const RDV_STATUSES = ["planifie", "honore", "no_show", "reporte", "annule"] as const;
export type RdvStatus = (typeof RDV_STATUSES)[number];
export const rdvStatusValidator = v.union(...RDV_STATUSES.map((s) => v.literal(s))) as Validator<RdvStatus>;

export const RDV_LOCATIONS = ["domicile", "agence", "visio"] as const;
export type RdvLocation = (typeof RDV_LOCATIONS)[number];
export const rdvLocationValidator = v.union(...RDV_LOCATIONS.map((l) => v.literal(l))) as Validator<RdvLocation>;

export const RDV_RESULTS = ["signe", "reflexion", "perdu", "no_show", "reporte"] as const;
export type RdvResult = (typeof RDV_RESULTS)[number];
export const rdvResultValidator = v.union(...RDV_RESULTS.map((r) => v.literal(r))) as Validator<RdvResult>;

export const FINANCING_TYPES = [
  "comptant", "financement", "financement_sans_apport",
  "apport_financement", "paiement_10x", "paiement_12x",
] as const;
export type FinancingType = (typeof FINANCING_TYPES)[number];
export const financingTypeValidator = v.union(...FINANCING_TYPES.map((f) => v.literal(f))) as Validator<FinancingType>;

// ─── Closing (tranche 3 : projects + debriefs) ──────────────────────────────
export const PROJECT_STATUSES = [
  "qualification", "devis_en_cours", "signature_en_cours",
  "signe", "perdu", "abandonne",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const projectStatusValidator = v.union(...PROJECT_STATUSES.map((s) => v.literal(s))) as Validator<ProjectStatus>;

export const DEBRIEF_OUTCOMES = ["vente", "non_vente", "en_reflexion", "suivi_prevu"] as const;
export type DebriefOutcome = (typeof DEBRIEF_OUTCOMES)[number];
export const debriefOutcomeValidator = v.union(...DEBRIEF_OUTCOMES.map((o) => v.literal(o))) as Validator<DebriefOutcome>;

export const DEBRIEF_NON_SALE_REASONS = [
  "suivi_prevu", "non_qualifie", "no_show",
  "contact_annule", "annulation_administrative", "pas_interesse",
] as const;
export type DebriefNonSaleReason = (typeof DEBRIEF_NON_SALE_REASONS)[number];
export const debriefNonSaleReasonValidator = v.union(...DEBRIEF_NON_SALE_REASONS.map((r) => v.literal(r))) as Validator<DebriefNonSaleReason>;

export const DEBRIEF_REFLEXION_REASONS = [
  "besoin_reflechir", "consulter_partenaire", "comparer_concurrence",
  "budget_a_revoir", "attente_info_technique", "delai_a_confirmer", "autre",
] as const;
export type DebriefReflexionReason = (typeof DEBRIEF_REFLEXION_REASONS)[number];
export const debriefReflexionReasonValidator = v.union(...DEBRIEF_REFLEXION_REASONS.map((r) => v.literal(r))) as Validator<DebriefReflexionReason>;

export const DEBRIEF_SUIVI_REASONS = [
  "rappel_programme", "pas_le_bon_moment",
  "attend_devis_detaille", "besoin_info_technique", "autre",
] as const;
export type DebriefSuiviReason = (typeof DEBRIEF_SUIVI_REASONS)[number];
export const debriefSuiviReasonValidator = v.union(...DEBRIEF_SUIVI_REASONS.map((r) => v.literal(r))) as Validator<DebriefSuiviReason>;

export const PAYMENT_SUB_METHODS = ["cheque", "especes", "virement"] as const;
export type PaymentSubMethod = (typeof PAYMENT_SUB_METHODS)[number];
export const paymentSubMethodValidator = v.union(...PAYMENT_SUB_METHODS.map((p) => v.literal(p))) as Validator<PaymentSubMethod>;

export const FINANCING_ORGS = ["cmoi", "sofider"] as const;
export type FinancingOrg = (typeof FINANCING_ORGS)[number];
export const financingOrgValidator = v.union(...FINANCING_ORGS.map((o) => v.literal(o))) as Validator<FinancingOrg>;

// ─── Devis (tranche 4) ──────────────────────────────────────────────────────
export const DEVIS_STATUSES = [
  "brouillon", "en_attente", "signature_en_cours", "signe", "perdu",
] as const;
export type DevisStatus = (typeof DEVIS_STATUSES)[number];
export const devisStatusValidator = v.union(...DEVIS_STATUSES.map((s) => v.literal(s))) as Validator<DevisStatus>;

export const OCR_STATUSES = ["pending", "processing", "done", "failed"] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];
export const ocrStatusValidator = v.union(...OCR_STATUSES.map((s) => v.literal(s))) as Validator<OcrStatus>;

export const LIGNE_TYPES = [
  "panneau", "onduleur", "batterie", "fixation", "monitoring",
  "protection", "prestation", "consuel", "remise", "autre",
] as const;
export type LigneType = (typeof LIGNE_TYPES)[number];
export const ligneTypeValidator = v.union(...LIGNE_TYPES.map((t) => v.literal(t))) as Validator<LigneType>;

export const PAIEMENT_PHASES = [
  "signature", "vt", "dp", "pose_planif", "pose", "mes", "autre",
] as const;
export type PaiementPhase = (typeof PAIEMENT_PHASES)[number];
export const paiementPhaseValidator = v.union(...PAIEMENT_PHASES.map((p) => v.literal(p))) as Validator<PaiementPhase>;
