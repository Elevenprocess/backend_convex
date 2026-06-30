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
