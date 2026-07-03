/**
 * Builders analytics PURS — portage verbatim des fonctions locales de
 * AnalyticsService (NestJS) + mapDebriefOutcomeToRdvResult (debrief-effects.ts).
 * Adaptation unique : les Date deviennent des timestamps ms, les montants sont
 * déjà numériques (money = ?? 0).
 */

import {
  ANSWERED_RESULTS,
  CALLBACK_RESULTS,
  CALLBACK_STATUSES,
  CLASSIFIED_STATUSES,
  NO_ANSWER_STATUSES,
  NOT_QUALIFIED_STATUSES,
  QUALIFIED_STATUSES,
  RDV_REACHED_STATUSES,
  RELANCE_RESULTS,
  RELANCE_STATUSES,
  pct,
} from "./funnelMath";
import {
  type RangeMs,
  isInRange,
  filterRange,
  reunionDayKey,
  reunionHour,
  dayKeys,
  formatDayLabel,
} from "./analyticsRange";

// ─── Types de lignes (dates en ms) ───────────────────────────────────────────

export type LeadRow = {
  id: string;
  source: string;
  status: string;
  setterId?: string;
  createdAt: number;
  lastContactAt?: number;
  city?: string;
  canalAcquisition?: string;
  utmSource?: string;
  utmCampaign?: string;
  campaign?: string;
};

export type CallResult =
  | "joint" | "non_joint" | "rappel_planifie" | "rdv_pris" | "refus" | "injoignable" | "messagerie";

export type CallRow = {
  leadId?: string | null;
  setterId?: string | null;
  calledAt: number;
  result: CallResult;
  durationSec?: number;
};

export type RdvRow = {
  leadId?: string | null;
  commercialId?: string | null;
  scheduledAt?: number | null;
  status: string;
  result?: string | null;
  montantTotal?: number | null;
  financingType?: string | null;
  createdAt: number;
};

export type UserRow = { id: string; name: string; role: string };

// ─── Constantes ──────────────────────────────────────────────────────────────

export const HISTORICAL_LEAD_SOURCES = new Set<string>(["airtable_migration"]);

export const COLORS = ["#D4AF37", "#B87333", "#3DA86A", "#6B7C8C", "#B7410E", "#2F4858"];

export const CALL_RESULT_LABEL: Record<CallResult, string> = {
  joint: "Joint",
  non_joint: "Non joint",
  rappel_planifie: "Rappel planifié",
  rdv_pris: "RDV pris",
  refus: "Refus",
  injoignable: "Injoignable",
  messagerie: "Messagerie",
};

export type AnalyticsSegment = { label: string; value: number; color: string };

// ─── Mapping débrief → résultat RDV (debrief-effects.ts) ─────────────────────

export function mapDebriefOutcomeToRdvResult(
  outcome: string,
  nonSaleReason: string | null,
): "signe" | "reflexion" | "perdu" | "no_show" {
  if (outcome === "vente") return "signe";
  if (outcome === "en_reflexion" || outcome === "suivi_prevu") return "reflexion";
  // non_vente
  if (nonSaleReason === "no_show") return "no_show";
  if (nonSaleReason === "suivi_prevu") return "reflexion";
  return "perdu";
}

// ─── Helpers cœur ────────────────────────────────────────────────────────────

export function buildLatestCallByLead(calls: CallRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const call of calls) {
    if (!call.leadId) continue;
    const current = map.get(call.leadId);
    if (current === undefined || call.calledAt > current) map.set(call.leadId, call.calledAt);
  }
  return map;
}

// Le setter « créditeur » d'un jalon (qualification, RDV) = celui qui a réellement
// fait basculer le lead, c.-à-d. le setter de son DERNIER appel loggé. Sans ça,
// deux setters ayant appelé le même lead se voyaient TOUS DEUX créditer la
// qualification posée par un seul. À défaut d'appel loggé, on retombe sur le
// setter propriétaire du lead. IMPORTANT : à alimenter avec l'ensemble COMPLET
// des appels (tous setters).
export function buildQualifierByLead(calls: CallRow[]): Map<string, string> {
  const latest = new Map<string, { at: number; setterId: string }>();
  for (const call of calls) {
    if (!call.leadId || !call.setterId) continue;
    const current = latest.get(call.leadId);
    if (!current || call.calledAt > current.at) {
      latest.set(call.leadId, { at: call.calledAt, setterId: call.setterId });
    }
  }
  const map = new Map<string, string>();
  for (const [leadId, { setterId }] of latest) map.set(leadId, setterId);
  return map;
}

// Date de « traitement » d'un lead = quand un setter l'a réellement travaillé.
// Priorité : dernier appel loggé > lastContactAt (posé uniquement par un vrai appel).
// On NE retombe JAMAIS sur updatedAt ni sur createdAt : un import ou webhook ne
// vaut pas un traitement métier.
export function leadTreatmentDate(lead: LeadRow, latestCallByLead: Map<string, number>): number | null {
  const call = latestCallByLead.get(lead.id);
  if (call !== undefined) return call;
  if (lead.lastContactAt) return lead.lastContactAt;
  return null;
}

// « Lead traité dans la période » = sa date de traitement réelle tombe dans la
// période. Un lead simplement créé/importé sans appel ne compte pas.
export function isLeadActiveInRange(lead: LeadRow, range: RangeMs, latestCallByLead: Map<string, number>): boolean {
  const treatedAt = leadTreatmentDate(lead, latestCallByLead);
  return treatedAt != null && isInRange(treatedAt, range);
}

export function isNewLeadInRange(lead: LeadRow, range: RangeMs): boolean {
  return !HISTORICAL_LEAD_SOURCES.has(String(lead.source)) && isInRange(lead.createdAt, range);
}

export function isClassifiedLead(lead: LeadRow): boolean {
  return CLASSIFIED_STATUSES.has(lead.status);
}

export function isQualifiedLead(lead: LeadRow): boolean {
  return QUALIFIED_STATUSES.has(lead.status);
}

export function qualifierMatches(
  lead: LeadRow,
  setterId: string | undefined,
  qualifierByLead: Map<string, string>,
): boolean {
  if (!setterId) return false;
  return (qualifierByLead.get(lead.id) ?? lead.setterId ?? null) === setterId;
}

export function belongsToSetter(lead: LeadRow, setterId: string | undefined, calls: CallRow[]): boolean {
  if (!setterId) return true;
  return lead.setterId === setterId || calls.some((c) => c.leadId === lead.id && c.setterId === setterId);
}

export function countResults(calls: CallRow[]): Record<CallResult, number> {
  const counts: Record<CallResult, number> = {
    joint: 0, non_joint: 0, rappel_planifie: 0, rdv_pris: 0, refus: 0, injoignable: 0, messagerie: 0,
  };
  for (const call of calls) counts[call.result] += 1;
  return counts;
}

export function addSyntheticResults(
  counts: Record<CallResult, number>,
  leadsRows: LeadRow[],
  maxToAdd: number,
): void {
  if (maxToAdd <= 0) return;
  for (const lead of leadsRows.slice(0, maxToAdd)) counts[statusToResult(lead.status)] += 1;
}

export function statusToResult(status: string): CallResult {
  if (status === "rdv_pris" || status === "rdv_honore" || status === "signe") return "rdv_pris";
  if (status === "qualifie") return "joint";
  if (status === "a_rappeler" || status === "relance") return "rappel_planifie";
  if (status === "pas_de_reponse") return "non_joint";
  if (status === "pas_qualifie" || status === "perdu") return "refus";
  return "non_joint";
}

export function resultSegments(counts: Record<CallResult, number>): AnalyticsSegment[] {
  return pieFromCounts(
    (Object.keys(counts) as CallResult[]).map((key) => [CALL_RESULT_LABEL[key], counts[key]]),
  );
}

export function pieFromCounts(rows: [string, number][]): AnalyticsSegment[] {
  return rows
    .filter(([, value]) => value > 0)
    .map(([label, value], i) => ({ label, value, color: COLORS[i % COLORS.length] }));
}

export function money(value?: number | null): number {
  return value ?? 0;
}

export function initialsFromName(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "??";
}

// Réexports pratiques pour les builders (Tasks suivantes) et la query.
export {
  pct,
  isInRange,
  filterRange,
  reunionDayKey,
  reunionHour,
  dayKeys,
  formatDayLabel,
  ANSWERED_RESULTS,
  CALLBACK_RESULTS,
  CALLBACK_STATUSES,
  NO_ANSWER_STATUSES,
  NOT_QUALIFIED_STATUSES,
  QUALIFIED_STATUSES,
  RDV_REACHED_STATUSES,
  RELANCE_RESULTS,
  RELANCE_STATUSES,
};
export type { RangeMs };
