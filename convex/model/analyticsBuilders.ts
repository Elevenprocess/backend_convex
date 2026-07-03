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

/**
 * Dates de qualification (setter) tombant dans la plage : première prise de RDV
 * de chaque lead. Avec la map globale (tous temps, imports exclus), une re-prise
 * en plage dont la première prise est antérieure ne compte pas ; un lead absent
 * de la map (import airtable, débrief détaché) ne compte pas. Sans map (vue
 * commerciale), min local sur les lignes passées. Les RDV sans lead comptent 1
 * chacun le jour de leur création.
 */
export function qualificationDates(
  rdvs: RdvRow[],
  range: RangeMs,
  firstRdvByLead?: Map<string, number>,
): number[] {
  const firstByLead = new Map<string, number>();
  for (const row of rdvs) {
    if (!row.leadId) continue;
    if (firstRdvByLead) {
      const known = firstRdvByLead.get(row.leadId);
      if (known !== undefined) firstByLead.set(row.leadId, known);
      continue;
    }
    const current = firstByLead.get(row.leadId);
    if (current === undefined || row.createdAt < current) firstByLead.set(row.leadId, row.createdAt);
  }
  const dates: number[] = [];
  for (const firstAt of firstByLead.values()) if (isInRange(firstAt, range)) dates.push(firstAt);
  for (const row of rdvs) if (!row.leadId && isInRange(row.createdAt, range)) dates.push(row.createdAt);
  return dates;
}

export function buildDailyEvolution(
  leadsRows: LeadRow[],
  calls: CallRow[],
  rdvs: RdvRow[],
  range: RangeMs,
  latestCallByLead = buildLatestCallByLead(calls),
  firstRdvByLead?: Map<string, number>,
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

  // Leads qualifiés par jour = leads dont la PREMIÈRE prise de RDV tombe ce
  // jour-là (événement daté, immuable). Surtout PAS le statut ACTUEL du lead :
  // un lead qualifié après coup regonflait les journées passées.
  for (const date of qualificationDates(rdvs, range, firstRdvByLead)) {
    const point = points.get(reunionDayKey(date));
    if (point) point.qualified += 1;
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

// ─── Builders de stats (portage verbatim analytics.service.ts:729-992) ────────

export function buildSetterStats(
  leadsRows: LeadRow[],
  calls: CallRow[],
  rdvs: RdvRow[],
  setterId: string | undefined,
  range: RangeMs,
  latestCallByLead = buildLatestCallByLead(calls),
  qualifierByLead = buildQualifierByLead(calls),
  firstRdvByLead?: Map<string, number>,
) {
  const ownLeads = leadsRows.filter((l) => belongsToSetter(l, setterId, calls));
  const leadsById = new Map(leadsRows.map((l) => [l.id, l]));
  const scopedCalls = filterRange(calls, range, (c) => c.calledAt);
  const scopedLeads = ownLeads.filter((l) => isLeadActiveInRange(l, range, latestCallByLead));
  const newLeadRows = ownLeads.filter((l) => isNewLeadInRange(l, range));
  const classifiedLeads = scopedLeads.filter(isClassifiedLead);
  const scopedCallLeadIds = new Set(scopedCalls.map((c) => c.leadId).filter(Boolean));
  const classifiedWithoutLoggedCall = classifiedLeads.filter((l) => !scopedCallLeadIds.has(l.id));
  const syntheticCalls = classifiedWithoutLoggedCall.length;
  const resultCounts = countResults(scopedCalls);
  addSyntheticResults(resultCounts, classifiedWithoutLoggedCall, syntheticCalls);
  const callsTotal = scopedCalls.length + syntheticCalls;

  const answeredIds = new Set<string>();
  const relanceIds = new Set<string>();
  const notQualifiedIds = new Set<string>();
  const qualifiedIds = new Set<string>();
  const rdvIds = new Set<string>();

  for (const call of scopedCalls) {
    if (!call.leadId) continue;
    if (ANSWERED_RESULTS.has(call.result)) answeredIds.add(call.leadId);
    if (CALLBACK_RESULTS.has(call.result)) answeredIds.add(call.leadId);
    if (RELANCE_RESULTS.has(call.result)) relanceIds.add(call.leadId);
    if (call.result === "refus") notQualifiedIds.add(call.leadId);
    // NB : le résultat d'appel 'rdv_pris' est étiqueté « Qualifié » dans l'UI et
    // mappe le lead vers 'qualifie' (pas un vrai RDV) → PAS compté en RDV pris.
  }

  for (const lead of classifiedLeads) {
    if (CALLBACK_STATUSES.has(lead.status)) answeredIds.add(lead.id);
    if (RELANCE_STATUSES.has(lead.status)) relanceIds.add(lead.id);
    if (NOT_QUALIFIED_STATUSES.has(lead.status)) {
      notQualifiedIds.add(lead.id);
      answeredIds.add(lead.id);
    }
    if (QUALIFIED_STATUSES.has(lead.status)) {
      answeredIds.add(lead.id);
      // Crédité uniquement si CE setter a réellement qualifié (dernier appelant).
      if (qualifierMatches(lead, setterId, qualifierByLead)) qualifiedIds.add(lead.id);
    }
    // RDV crédité au seul setter qui a fait basculer le lead, comme qualified.
    if (RDV_REACHED_STATUSES.has(lead.status) && qualifierMatches(lead, setterId, qualifierByLead)) {
      rdvIds.add(lead.id);
    }
  }

  for (const r of rdvs.filter((row) => isInRange(row.createdAt, range))) {
    if (!r.leadId) continue;
    answeredIds.add(r.leadId);
    const lead = leadsById.get(r.leadId);
    if (!lead || qualifierMatches(lead, setterId, qualifierByLead)) {
      rdvIds.add(r.leadId);
      qualifiedIds.add(r.leadId);
    }
  }

  const answered = answeredIds.size;
  const rdvPris = rdvIds.size;
  return {
    newLeads: newLeadRows.length,
    calls: callsTotal,
    loggedCalls: scopedCalls.length,
    syntheticCalls,
    callsPerDay: Math.round(callsTotal / range.days),
    classified: classifiedLeads.length,
    unclassified: scopedLeads.length - classifiedLeads.length,
    answered,
    connected: answered,
    relance: relanceIds.size,
    notQualified: notQualifiedIds.size,
    qualified: qualifiedIds.size,
    rdvPris,
    responseRate: pct(answered, newLeadRows.length),
    rdvAfterAnswerRate: pct(rdvPris, answered),
    globalRdvRate: pct(rdvPris, newLeadRows.length),
    connectionRate: pct(answered, callsTotal),
    qualificationRate: pct(qualifiedIds.size, answered),
    rdvRate: pct(rdvPris, callsTotal),
    resultSegments: resultSegments(resultCounts),
    dailyCalls: dailyLogicalCalls(scopedCalls, classifiedLeads, range, latestCallByLead),
    hourlyCalls: buildHourlyCalls(scopedCalls, range),
    dailyEvolution: buildDailyEvolution(ownLeads, calls, rdvs, range, latestCallByLead, firstRdvByLead),
  };
}

export function buildCommercialStats(rdvs: RdvRow[], range: RangeMs) {
  const scoped = filterRange(rdvs, range, (r) => r.scheduledAt ?? r.createdAt);
  const honored = scoped.filter((r) => r.status === "honore");
  // L'historique GHL/importé porte souvent l'issue dans result alors que status
  // reste planifie → ventes/CA récupérés depuis result sur TOUS les RDV scopés.
  const signed = scoped.filter((r) => r.result === "signe");
  const reflexion = scoped.filter((r) => r.result === "reflexion");
  const lost = scoped.filter((r) => r.result === "perdu");
  const outcomeBase = Math.max(honored.length, signed.length + reflexion.length + lost.length);
  const ca = signed.reduce((sum, r) => sum + money(r.montantTotal), 0);
  return {
    total: scoped.length,
    honored: honored.length,
    signed: signed.length,
    ca,
    panier: signed.length ? ca / signed.length : 0,
    closing: pct(signed.length, outcomeBase),
    resultSegments: pieFromCounts([
      ["Signé", signed.length],
      ["Réflexion", reflexion.length],
      ["Perdu", lost.length],
      ["No-show", scoped.filter((r) => r.status === "no_show").length],
      ["Reporté", scoped.filter((r) => r.status === "reporte").length],
    ]),
    financingSegments: pieFromCounts([
      ["Comptant", signed.filter((r) => r.financingType === "comptant").length],
      ["Financement", signed.filter((r) => r.financingType === "financement").length],
      ["À définir", signed.filter((r) => !r.financingType).length],
    ]),
    dailyEvolution: buildDailyEvolution([], [], rdvs, range),
  };
}

export function buildAdminStats(
  leadsRows: LeadRow[],
  calls: CallRow[],
  rdvs: RdvRow[],
  userRows: UserRow[],
  range: RangeMs,
  latestCallByLead = buildLatestCallByLead(calls),
  firstRdvByLead?: Map<string, number>,
) {
  const scopedCalls = filterRange(calls, range, (c) => c.calledAt);
  const scopedLeads = leadsRows.filter((l) => isLeadActiveInRange(l, range, latestCallByLead));
  const scopedRdvs = filterRange(rdvs, range, (r) => r.scheduledAt ?? r.createdAt);
  const classifiedLeads = scopedLeads.filter(isClassifiedLead);
  const syntheticCalls = Math.max(0, classifiedLeads.length - scopedCalls.length);
  const resultCounts = countResults(scopedCalls);
  addSyntheticResults(resultCounts, classifiedLeads, syntheticCalls);
  const callsTotal = scopedCalls.length + syntheticCalls;
  // Qualifiés = leads dont la PREMIÈRE prise de RDV tombe dans la plage (travail
  // setter, événement daté). Plus jamais le statut ACTUEL des leads : il incluait
  // rdv_pris/rdv_honore/signe (le pipeline des commerciaux) et regonflait les
  // périodes passées à chaque qualification tardive.
  const qualified = qualificationDates(rdvs, range, firstRdvByLead).length;
  // RDV pris = leads ayant atteint le stage RDV. Plus de clamp ≤ qualified : les
  // deux KPI mesurent des choses différentes (qualifications de la période vs
  // RDV commerciaux actifs).
  const rdvReachedIds = new Set(
    classifiedLeads.filter((l) => RDV_REACHED_STATUSES.has(l.status)).map((l) => l.id),
  );
  for (const r of scopedRdvs) if (r.leadId) rdvReachedIds.add(r.leadId);
  const rdvPris = rdvReachedIds.size;
  const honored = scopedRdvs.filter((r) => r.status === "honore");
  void honored;
  // Même règle GHL/import que le profil commercial : l'issue vit dans result.
  const signed = scopedRdvs.filter((r) => r.result === "signe");
  const ca = signed.reduce((sum, r) => sum + money(r.montantTotal), 0);
  const newLeads = leadsRows.filter((l) => isNewLeadInRange(l, range)).length;
  return {
    calls: callsTotal,
    loggedCalls: scopedCalls.length,
    newLeads,
    classified: classifiedLeads.length,
    qualified,
    unclassified: scopedLeads.length - classifiedLeads.length,
    syntheticCalls,
    scheduledRdv: scopedRdvs.length,
    rdvPris,
    rdvRate: pct(rdvPris, callsTotal),
    qualificationRate: pct(qualified, callsTotal),
    ca,
    signed: signed.length,
    resultSegments: resultSegments(resultCounts),
    hourlyCalls: buildHourlyCalls(scopedCalls, range),
    dailyEvolution: buildDailyEvolution(leadsRows, calls, rdvs, range, latestCallByLead, firstRdvByLead),
    setters: buildSetterRows(scopedLeads, scopedCalls, userRows),
    commercials: buildCommercialRows(scopedRdvs, userRows),
  };
}

function buildSetterRows(leadsRows: LeadRow[], calls: CallRow[], userRows: UserRow[]) {
  const callsBySetter = groupCallsBySetter(calls);
  const leadIdsBySetter = groupLeadIdsBySetter(leadsRows, calls);
  const leadsById = new Map(leadsRows.map((l) => [l.id, l]));
  const qualifierByLead = buildQualifierByLead(calls);

  const rows = userRows
    .filter((u) => u.role === "setter")
    .map((u) => {
      const ownLeadIds = leadIdsBySetter.get(u.id) ?? new Set<string>();
      const ownLeads = Array.from(ownLeadIds)
        .map((id) => leadsById.get(id))
        .filter((l): l is LeadRow => Boolean(l));
      const classified = ownLeads.filter(isClassifiedLead);
      const ownCalls = callsBySetter.get(u.id) ?? [];
      const synthetic = Math.max(0, classified.length - ownCalls.length);
      const counts = countResults(ownCalls);
      addSyntheticResults(counts, classified, synthetic);
      const callsTotal = ownCalls.length + synthetic;
      const noAnswer = (counts.non_joint ?? 0) + (counts.injoignable ?? 0) + (counts.messagerie ?? 0);
      const connected = Math.max(0, callsTotal - noAnswer);
      // Seul le setter qui a réellement qualifié (dernier appelant) est crédité.
      const qualified = classified.filter(
        (l) => isQualifiedLead(l) && qualifierMatches(l, u.id, qualifierByLead),
      ).length;
      const rdvPris = Math.min(
        qualified,
        classified.filter(
          (l) => RDV_REACHED_STATUSES.has(l.status) && qualifierMatches(l, u.id, qualifierByLead),
        ).length,
      );
      return {
        id: u.id,
        name: u.name,
        initials: initialsFromName(u.name),
        calls: callsTotal,
        connected,
        classified: classified.length,
        qualified,
        rdvPris,
        efficiency: 0,
      };
    });

  const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0);
  for (const r of rows) r.efficiency = pct(r.calls, totalCalls);

  return rows.sort((a, b) => b.calls - a.calls);
}

export function groupCallsBySetter(calls: CallRow[]): Map<string, CallRow[]> {
  const map = new Map<string, CallRow[]>();
  for (const call of calls) {
    if (!call.setterId) continue;
    const rows = map.get(call.setterId) ?? [];
    rows.push(call);
    map.set(call.setterId, rows);
  }
  return map;
}

export function groupLeadIdsBySetter(leadsRows: LeadRow[], calls: CallRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (setterId: string | null | undefined, leadId: string | null | undefined) => {
    if (!setterId || !leadId) return;
    const ids = map.get(setterId) ?? new Set<string>();
    ids.add(leadId);
    map.set(setterId, ids);
  };
  for (const lead of leadsRows) add(lead.setterId, lead.id);
  for (const call of calls) add(call.setterId, call.leadId);
  return map;
}

// Le commercial_lead (responsable commercial) ferme aussi des dossiers : il doit
// apparaître dans le classement et compter dans les KPI équipe au même titre
// qu'un commercial.
export function isClosingRole(role: string): boolean {
  return role === "commercial" || role === "commercial_lead";
}

function buildCommercialRows(rdvs: RdvRow[], userRows: UserRow[]) {
  return userRows
    .filter((u) => isClosingRole(u.role))
    .map((u) => {
      const ownRdvs = rdvs.filter((r) => r.commercialId === u.id);
      const planned = ownRdvs.filter((r) => r.status === "planifie");
      const honored = ownRdvs.filter((r) => r.status === "honore");
      const noShow = ownRdvs.filter((r) => r.status === "no_show");
      const cancelled = ownRdvs.filter((r) => r.status === "annule");
      const postponed = ownRdvs.filter((r) => r.status === "reporte");
      // L'historique GHL/importé porte l'issue dans result même si status = planifie.
      const signed = ownRdvs.filter((r) => r.result === "signe");
      const ca = signed.reduce((sum, r) => sum + money(r.montantTotal), 0);
      return {
        id: u.id,
        name: u.name,
        initials: initialsFromName(u.name),
        total: ownRdvs.length,
        planned: planned.length,
        honored: honored.length,
        noShow: noShow.length,
        cancelled: cancelled.length,
        postponed: postponed.length,
        signed: signed.length,
        closing: pct(
          signed.length,
          Math.max(honored.length, signed.length + ownRdvs.filter((r) => r.result === "perdu").length),
        ),
        panier: signed.length ? ca / signed.length : 0,
        ca,
      };
    })
    .filter((p) => p.total > 0 || p.honored > 0 || p.signed > 0)
    .sort((a, b) => b.ca - a.ca || b.total - a.total);
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
