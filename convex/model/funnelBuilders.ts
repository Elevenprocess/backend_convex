/**
 * Builders purs du funnel (portage verbatim de buildFunnelSetterRows /
 * buildFunnelCommercialRows / buildFunnelDaily / matchesSector,
 * analytics.service.ts NestJS ; Date→ms).
 */

import {
  type LeadRow,
  type CallRow,
  type RdvRow,
  type UserRow,
  buildQualifierByLead,
  qualifierMatches,
  isClassifiedLead,
  isClosingRole,
  groupCallsBySetter,
  groupLeadIdsBySetter,
} from "./analyticsBuilders";
import {
  ANSWERED_RESULTS,
  CALLBACK_RESULTS,
  CALLBACK_STATUSES,
  NOT_QUALIFIED_STATUSES,
  QUALIFIED_STATUSES,
  RDV_REACHED_STATUSES,
  pct,
} from "./funnelMath";
import { type RangeMs, reunionDayKey, dayKeys, formatDayLabel } from "./analyticsRange";

export function matchesSector(lead: LeadRow, sector: string): boolean {
  const needle = sector.trim().toLowerCase();
  return [lead.city, lead.canalAcquisition, lead.utmSource, lead.utmCampaign, lead.campaign, lead.source].some(
    (value) => (value ?? "").toLowerCase() === needle,
  );
}

export function buildFunnelSetterRows(
  leadsRows: LeadRow[],
  calls: CallRow[],
  rdvs: RdvRow[],
  userRows: UserRow[],
) {
  const callsBySetter = groupCallsBySetter(calls);
  const leadIdsBySetter = groupLeadIdsBySetter(leadsRows, calls);
  const leadsById = new Map(leadsRows.map((l) => [l.id, l]));
  const qualifierByLead = buildQualifierByLead(calls);
  const rdvLeadIds = new Set(rdvs.map((r) => r.leadId).filter((id): id is string => Boolean(id)));

  return userRows
    .filter((u) => u.role === "setter")
    .map((u) => {
      const ownLeadIds = leadIdsBySetter.get(u.id) ?? new Set<string>();
      const ownLeads = Array.from(ownLeadIds)
        .map((id) => leadsById.get(id))
        .filter((l): l is LeadRow => Boolean(l));
      const ownCalls = callsBySetter.get(u.id) ?? [];
      const answered = new Set<string>();
      const qualified = new Set<string>();
      const rdvIds = new Set<string>();
      let classifiedCount = 0;

      for (const call of ownCalls) {
        if (!call.leadId || !ownLeadIds.has(call.leadId)) continue;
        if (ANSWERED_RESULTS.has(call.result)) answered.add(call.leadId);
        // 'rdv_pris' (result d'appel) = « Qualifié » dans l'UI, pas un vrai RDV.
      }
      for (const lead of ownLeads) {
        if (!isClassifiedLead(lead)) continue;
        classifiedCount += 1;
        // Le lead « répond » à tout setter qui l'a travaillé, mais la qualification/
        // RDV n'est créditée qu'au setter qui l'a réellement fait basculer.
        const credited = qualifierMatches(lead, u.id, qualifierByLead);
        if (QUALIFIED_STATUSES.has(lead.status)) {
          answered.add(lead.id);
          if (credited) qualified.add(lead.id);
        }
        if (credited && RDV_REACHED_STATUSES.has(lead.status)) rdvIds.add(lead.id);
        if (credited && rdvLeadIds.has(lead.id)) rdvIds.add(lead.id);
      }
      const callsTotal = Math.max(ownCalls.length, classifiedCount);
      return {
        id: u.id,
        name: u.name,
        role: "setter" as const,
        calls: callsTotal,
        answered: answered.size,
        qualified: qualified.size,
        rdv: rdvIds.size,
        conversionRate: pct(rdvIds.size, ownLeads.length),
      };
    })
    .filter((row) => row.calls > 0 || row.rdv > 0)
    .sort((a, b) => b.conversionRate - a.conversionRate || b.calls - a.calls);
}

export function buildFunnelCommercialRows(rdvs: RdvRow[], userRows: UserRow[]) {
  const rdvsByCommercial = new Map<string, { rdv: number; signed: number }>();
  for (const row of rdvs) {
    if (!row.commercialId) continue;
    const current = rdvsByCommercial.get(row.commercialId) ?? { rdv: 0, signed: 0 };
    current.rdv += 1;
    if (row.result === "signe") current.signed += 1;
    rdvsByCommercial.set(row.commercialId, current);
  }
  return userRows
    .filter((u) => isClosingRole(u.role))
    .map((u) => {
      const own = rdvsByCommercial.get(u.id) ?? { rdv: 0, signed: 0 };
      return {
        id: u.id,
        name: u.name,
        role: "commercial" as const,
        calls: 0,
        answered: 0,
        qualified: 0,
        rdv: own.rdv,
        conversionRate: pct(own.signed, own.rdv),
      };
    })
    .filter((row) => row.rdv > 0)
    .sort((a, b) => b.rdv - a.rdv);
}

/** Cohortes par jour de CRÉATION du lead : appels/réponses/RDV comptés le jour du lead. */
export function buildFunnelDaily(leadsRows: LeadRow[], calls: CallRow[], rdvs: RdvRow[], range: RangeMs) {
  const points = new Map(
    dayKeys(range).map((day) => [
      day,
      {
        date: day,
        label: formatDayLabel(day),
        newLeads: 0,
        calls: 0,
        answeredIds: new Set<string>(),
        qualified: 0,
        rdv: 0,
        classified: 0,
        leadIds: new Set<string>(),
      },
    ]),
  );

  for (const lead of leadsRows) {
    const day = reunionDayKey(lead.createdAt);
    const point = points.get(day);
    if (!point) continue;
    point.newLeads += 1;
    point.leadIds.add(lead.id);
    if (isClassifiedLead(lead)) point.classified += 1;
    if (QUALIFIED_STATUSES.has(lead.status)) point.qualified += 1;
    if (
      QUALIFIED_STATUSES.has(lead.status) ||
      NOT_QUALIFIED_STATUSES.has(lead.status) ||
      CALLBACK_STATUSES.has(lead.status)
    ) {
      point.answeredIds.add(lead.id);
    }
  }

  const leadDayById = new Map<string, string>();
  for (const [day, point] of points) {
    for (const id of point.leadIds) leadDayById.set(id, day);
  }

  for (const call of calls) {
    if (!call.leadId) continue;
    const day = leadDayById.get(call.leadId);
    if (!day || reunionDayKey(call.calledAt) !== day) continue;
    const point = points.get(day);
    if (!point) continue;
    point.calls += 1;
    if (ANSWERED_RESULTS.has(call.result)) point.answeredIds.add(call.leadId);
    if (CALLBACK_RESULTS.has(call.result)) point.answeredIds.add(call.leadId);
  }

  for (const row of rdvs) {
    if (!row.leadId) continue;
    const day = leadDayById.get(row.leadId);
    if (!day || reunionDayKey(row.createdAt) !== day) continue;
    const point = points.get(day);
    if (point) point.rdv += 1;
  }

  return Array.from(points.values()).map(({ answeredIds, classified, leadIds, ...point }) => ({
    ...point,
    calls: Math.max(point.calls, classified),
    answered: answeredIds.size,
  }));
}
