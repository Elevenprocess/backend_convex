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

// ─── Séries temporelles ──────────────────────────────────────────────────────

export function buildDailyEvolution(
  leadsRows: LeadRow[],
  calls: CallRow[],
  rdvs: RdvRow[],
  range: RangeMs,
  latestCallByLead = buildLatestCallByLead(calls),
) {
  const points = new Map(
    dayKeys(range).map((day) => [
      day,
      { date: day, label: formatDayLabel(day), calls: 0, rdv: 0, signed: 0, ca: 0, classified: 0, qualified: 0, newLeads: 0 },
    ]),
  );

  // Nouveaux leads par jour = vrais leads entrants (hors imports historiques)
  // créés ce jour-là. Les imports Airtable restent dans classified/active, pas ici.
  for (const lead of leadsRows) {
    if (!isNewLeadInRange(lead, range)) continue;
    const point = points.get(reunionDayKey(lead.createdAt));
    if (point) point.newLeads += 1;
  }

  // Jours (TZ Réunion) où chaque lead a au moins un appel loggé dans la période.
  // Un lead retravaillé sur plusieurs jours compte sur CHAQUE jour d'appel : le
  // hover d'une date en mode plage doit afficher le même chiffre que cette date
  // en mode journée.
  const callDaysByLead = new Map<string, Set<string>>();
  for (const call of calls) {
    if (!call.leadId || !isInRange(call.calledAt, range)) continue;
    const set = callDaysByLead.get(call.leadId) ?? new Set<string>();
    set.add(reunionDayKey(call.calledAt));
    callDaysByLead.set(call.leadId, set);
  }

  for (const lead of leadsRows) {
    if (!isClassifiedLead(lead)) continue;
    const callDays = callDaysByLead.get(lead.id);
    // Leads sans appel loggé (lastContactAt / import) → un seul jour de traitement.
    let days: Iterable<string>;
    if (callDays && callDays.size) {
      days = callDays;
    } else {
      const treatedAt = leadTreatmentDate(lead, latestCallByLead);
      if (treatedAt == null) continue; // pas de traitement réel → absent du graphe
      days = [reunionDayKey(treatedAt)];
    }
    for (const day of days) {
      const point = points.get(day);
      if (point) point.classified += 1;
    }
  }

  // « RDV planifiés » par jour = leads distincts dont un RDV a été CRÉÉ ce jour-là
  // (événement daté, immuable). Surtout PAS le statut ACTUEL du lead reporté sur
  // ses jours d'appel : un lead qualifié après coup regonflait les journées passées.
  const qualifiedByDay = new Map<string, { leadIds: Set<string>; orphans: number }>();
  for (const row of rdvs) {
    if (!isInRange(row.createdAt, range)) continue;
    const day = reunionDayKey(row.createdAt);
    if (!points.has(day)) continue;
    const bucket = qualifiedByDay.get(day) ?? { leadIds: new Set<string>(), orphans: 0 };
    if (row.leadId) bucket.leadIds.add(row.leadId);
    else bucket.orphans += 1;
    qualifiedByDay.set(day, bucket);
  }
  for (const [day, bucket] of qualifiedByDay) {
    const point = points.get(day);
    if (point) point.qualified = bucket.leadIds.size + bucket.orphans;
  }

  for (const call of calls) {
    if (!isInRange(call.calledAt, range)) continue;
    const point = points.get(reunionDayKey(call.calledAt));
    if (point) point.calls += 1;
  }

  for (const row of rdvs) {
    const date = row.scheduledAt ?? row.createdAt;
    if (!date || !isInRange(date, range)) continue;
    const point = points.get(reunionDayKey(date));
    if (!point) continue;
    point.rdv += 1;
    if (row.result === "signe") {
      point.signed += 1;
      point.ca += money(row.montantTotal);
    }
  }

  // rdv reste « RDV se déroulant ce jour » (scheduledAt) — pas de clamp sur
  // qualified : les deux séries mesurent des événements différents.
  return Array.from(points.values()).map(({ classified, ...point }) => ({
    ...point,
    classified,
    calls: Math.max(point.calls, classified),
  }));
}

export function dailyLogicalCalls(
  calls: CallRow[],
  classified: LeadRow[],
  range: RangeMs,
  latestCallByLead = buildLatestCallByLead(calls),
): number[] {
  const loggedByDay = new Map<string, number>();
  const classifiedByDay = new Map<string, number>();

  for (const call of calls) {
    const day = reunionDayKey(call.calledAt);
    loggedByDay.set(day, (loggedByDay.get(day) ?? 0) + 1);
  }
  for (const lead of classified) {
    const treatedAt = leadTreatmentDate(lead, latestCallByLead);
    if (treatedAt == null) continue;
    const day = reunionDayKey(treatedAt);
    classifiedByDay.set(day, (classifiedByDay.get(day) ?? 0) + 1);
  }

  return dayKeys(range).map((day) => Math.max(loggedByDay.get(day) ?? 0, classifiedByDay.get(day) ?? 0));
}

export function buildHourlyCalls(calls: CallRow[], range: RangeMs) {
  const hours = Array.from({ length: 14 }, (_, index) => index + 8);
  const points = new Map<string, { date: string; hour: number; label: string; calls: number }>();

  for (const day of dayKeys(range)) {
    const dayLabel = formatDayLabel(day);
    for (const hour of hours) {
      points.set(`${day}-${hour}`, { date: day, hour, label: `${dayLabel} ${hour}h`, calls: 0 });
    }
  }

  for (const call of calls) {
    if (!isInRange(call.calledAt, range)) continue;
    const hour = reunionHour(call.calledAt);
    if (hour < 8 || hour > 21) continue;
    const key = `${reunionDayKey(call.calledAt)}-${hour}`;
    const point = points.get(key);
    if (point) point.calls += 1;
  }

  return Array.from(points.values());
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
