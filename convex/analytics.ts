/**
 * Analytics — query summary (Overview).
 * Portage de AnalyticsService.summary : mêmes KPI, mêmes builders, SANS caches
 * applicatifs (les queries Convex sont nativement cachées + réactives).
 * `now` est fourni par le client (Date.now() interdit en query).
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireRole, roleOf } from "./model/access";
import { buildRange, isInRange, type RangeMs } from "./model/analyticsRange";
import {
  HISTORICAL_LEAD_SOURCES,
  mapDebriefOutcomeToRdvResult,
  buildLatestCallByLead,
  buildQualifierByLead,
  buildAdminStats,
  buildSetterStats,
  buildCommercialStats,
  isNewLeadInRange,
  isClassifiedLead,
  type LeadRow,
  type CallRow,
  type RdvRow,
  type UserRow,
} from "./model/analyticsBuilders";
import {
  matchesSector,
  buildFunnelSetterRows,
  buildFunnelCommercialRows,
  buildFunnelDaily,
} from "./model/funnelBuilders";
import { computeFunnelTotals, pct } from "./model/funnelMath";
import type { Role } from "./model/enums";

const SUMMARY_ROLES: Role[] = ["admin", "setter", "setter_lead", "commercial", "commercial_lead", "finances"];
const SETTER_STATS_ROLES: Role[] = ["admin", "setter", "setter_lead", "commercial", "commercial_lead"];
const COMMERCIAL_STATS_ROLES: Role[] = ["admin", "commercial", "commercial_lead"];

function toLeadRow(l: Doc<"leads">): LeadRow {
  return {
    id: l._id,
    source: l.source,
    status: l.status,
    setterId: l.setterId ?? undefined,
    createdAt: l._creationTime,
    lastContactAt: l.lastContactAt ?? undefined,
    city: l.city ?? undefined,
    canalAcquisition: l.canalAcquisition ?? undefined,
    utmSource: l.utmSource ?? undefined,
    utmCampaign: l.utmCampaign ?? undefined,
    campaign: l.campaign ?? undefined,
  };
}

function toCallRow(c: Doc<"callLogs">): CallRow {
  return {
    leadId: c.leadId,
    setterId: c.setterId ?? undefined,
    calledAt: c.calledAt,
    result: c.result,
    durationSec: c.durationSec ?? undefined,
  };
}

function toRdvRow(r: Doc<"rdv">): RdvRow {
  return {
    leadId: r.leadId,
    commercialId: r.commercialId ?? undefined,
    scheduledAt: r.scheduledAt ?? null,
    status: r.status,
    result: r.result ?? undefined,
    montantTotal: r.montantTotal ?? null,
    financingType: r.financingType ?? undefined,
    createdAt: r._creationTime,
  };
}

/**
 * Débriefs DÉTACHÉS d'un RDV → lignes RDV synthétiques (période + hors imports
 * historiques). Pas de double-comptage : rdvId absent uniquement.
 */
export async function loadDetachedDebriefRdvRows(
  ctx: QueryCtx,
  range: RangeMs,
  commercialId?: Doc<"users">["_id"],
): Promise<RdvRow[]> {
  const rows = (await ctx.db.query("debriefs").collect()).filter(
    (d) =>
      d.deletedAt === undefined &&
      d.rdvId === undefined &&
      isInRange(d._creationTime, range) &&
      (commercialId === undefined || d.commercialId === commercialId),
  );
  const out: RdvRow[] = [];
  for (const d of rows) {
    if (!d.leadId) continue;
    const lead = await ctx.db.get(d.leadId);
    if (HISTORICAL_LEAD_SOURCES.has(lead?.source ?? "")) continue;
    out.push({
      leadId: d.leadId,
      commercialId: d.commercialId,
      scheduledAt: null,
      status: "honore",
      result: mapDebriefOutcomeToRdvResult(d.outcome, d.nonSaleReason ?? null),
      montantTotal: d.montantTotal ?? null,
      financingType: d.financingType ?? undefined,
      createdAt: d._creationTime,
    });
  }
  return out;
}

/**
 * Date de PREMIÈRE prise de RDV par lead (min rdv._creationTime, tous temps).
 * C'est l'événement daté qui matérialise « lead qualifié par un setter » : les
 * re-prises (reports, 2e visite) sont l'agenda des commerciaux, pas une nouvelle
 * qualification. Les leads airtable_migration sont exclus — leurs RDV importés
 * portent une date de création = jour d'import.
 */
async function loadFirstRdvByLead(ctx: QueryCtx): Promise<Map<string, number>> {
  const rows = await ctx.db.query("rdv").collect();
  const map = new Map<string, number>();
  const sourceByLead = new Map<string, string>();
  for (const r of rows) {
    if (r.deletedAt !== undefined || !r.leadId) continue;
    let source = sourceByLead.get(r.leadId);
    if (source === undefined) {
      const lead = await ctx.db.get(r.leadId);
      source = lead?.source ?? "";
      sourceByLead.set(r.leadId, source);
    }
    if (source === "airtable_migration") continue;
    const current = map.get(r.leadId);
    if (current === undefined || r._creationTime < current) map.set(r.leadId, r._creationTime);
  }
  return map;
}

/**
 * Leads « actifs dans la période » (transposition de leadsActiveInRangeWhere) :
 * créés dans la période OU lastContactAt dans la période OU appelés dans la
 * période. Les imports historiques restent exclus des KPI en aval.
 */
async function loadActiveLeads(
  ctx: QueryCtx,
  range: RangeMs,
  calledLeadIds: Set<string>,
): Promise<LeadRow[]> {
  const rows = await ctx.db.query("leads").collect();
  return rows
    .filter((l) => l.deletedAt === undefined)
    .filter(
      (l) =>
        isInRange(l._creationTime, range) ||
        isInRange(l.lastContactAt ?? null, range) ||
        calledLeadIds.has(l._id),
    )
    .map(toLeadRow);
}

export const summary = query({
  args: {
    now: v.number(),
    days: v.optional(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, SUMMARY_ROLES);
    const role = roleOf(user);
    // Défauts NestJS : commercial 30 j, setter 1 j, autres 365 j (Overview « cette année »).
    const range = buildRange(
      args.from,
      args.to,
      args.days ?? (role === "commercial" ? 30 : role === "setter" ? 1 : 365),
      args.now,
    );
    const base = {
      generatedAt: new Date(args.now).toISOString(),
      engine: "convex-reactive" as const,
      role,
      days: range.days,
      range: {
        from: new Date(range.fromMs).toISOString(),
        to: new Date(range.toMs).toISOString(),
        days: range.days,
      },
      admin: null as unknown,
      setter: null as unknown,
      commercial: null as unknown,
    };

    // Fast-path commercial : uniquement SES rdv + débriefs détachés (parité NestJS).
    if (role === "commercial") {
      const own = await ctx.db
        .query("rdv")
        .withIndex("by_commercial_scheduled", (q) => q.eq("commercialId", user._id))
        .collect();
      const detached = await loadDetachedDebriefRdvRows(ctx, range, user._id);
      return {
        ...base,
        commercial: buildCommercialStats(
          [...own.filter((r) => r.deletedAt === undefined).map(toRdvRow), ...detached],
          range,
        ),
      };
    }

    const callDocs = await ctx.db
      .query("callLogs")
      .withIndex("by_calledAt", (q) => q.gte("calledAt", range.fromMs).lte("calledAt", range.toMs))
      .collect();
    const calls = callDocs.map(toCallRow);
    const calledLeadIds = new Set<string>(calls.map((c) => c.leadId as string).filter(Boolean));
    const [leadRows, rdvDocs, userDocs, detached, firstRdvByLead] = await Promise.all([
      loadActiveLeads(ctx, range, calledLeadIds),
      ctx.db.query("rdv").collect(),
      ctx.db.query("users").collect(),
      loadDetachedDebriefRdvRows(ctx, range),
      loadFirstRdvByLead(ctx),
    ]);
    const rdvRows = rdvDocs
      .filter((r) => r.deletedAt === undefined)
      .filter((r) => isInRange(r.scheduledAt ?? null, range) || isInRange(r._creationTime, range))
      .map(toRdvRow);
    const rdvAll = [...rdvRows, ...detached];
    const userRows: UserRow[] = userDocs
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u._id, name: u.name ?? "", role: roleOf(u) }));

    const latestCallByLead = buildLatestCallByLead(calls);
    const qualifierByLead = buildQualifierByLead(calls);

    if (role === "setter") {
      const setterLeadIds = new Set(
        calls.filter((c) => c.setterId === user._id && c.leadId).map((c) => c.leadId as string),
      );
      const ownLeads = leadRows.filter((l) => l.setterId === user._id || setterLeadIds.has(l.id));
      const ownIds = new Set(ownLeads.map((l) => l.id));
      return {
        ...base,
        setter: buildSetterStats(
          ownLeads,
          calls.filter((c) => c.setterId === user._id),
          rdvAll.filter((r) => r.leadId && ownIds.has(r.leadId as string)),
          user._id,
          range,
          latestCallByLead,
          qualifierByLead,
          firstRdvByLead,
        ),
      };
    }

    // Parité NestJS stricte (isAdminView) : la vue agrégée est réservée à
    // admin/commercial_lead ; setter_lead et finances passent la garde mais
    // reçoivent les trois vues null (comportement NestJS reproduit tel quel).
    const isAdminView = role === "admin" || role === "commercial_lead";
    return {
      ...base,
      admin: isAdminView
        ? buildAdminStats(leadRows, calls, rdvAll, userRows, range, latestCallByLead, firstRdvByLead)
        : null,
    };
  },
});

// ─── Profils équipe (7b) ─────────────────────────────────────────────────────

/**
 * Stats d'un setter arbitraire (profil /team/setters/:id) — équivalent setter
 * de commercialStats. Reprend la logique du branch setter de summary, scopée
 * sur un setterId paramètre. Un setter « simple » est forcé sur SES stats.
 */
export const setterStats = query({
  args: {
    setterId: v.id("users"),
    now: v.number(),
    days: v.optional(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, SETTER_STATS_ROLES);
    // Un setter « simple » ne voit que ses propres stats.
    const setterId = roleOf(user) === "setter" ? user._id : args.setterId;
    const range = buildRange(args.from, args.to, args.days ?? 30, args.now);

    const callDocs = await ctx.db
      .query("callLogs")
      .withIndex("by_calledAt", (q) => q.gte("calledAt", range.fromMs).lte("calledAt", range.toMs))
      .collect();
    const calls = callDocs.map(toCallRow);
    const calledLeadIds = new Set<string>(calls.map((c) => c.leadId as string).filter(Boolean));
    const [leadRows, rdvDocs, detached, firstRdvByLead] = await Promise.all([
      loadActiveLeads(ctx, range, calledLeadIds),
      ctx.db.query("rdv").collect(),
      loadDetachedDebriefRdvRows(ctx, range),
      loadFirstRdvByLead(ctx),
    ]);
    const rdvAll = [
      ...rdvDocs
        .filter((r) => r.deletedAt === undefined)
        .filter((r) => isInRange(r.scheduledAt ?? null, range) || isInRange(r._creationTime, range))
        .map(toRdvRow),
      ...detached,
    ];
    const latestCallByLead = buildLatestCallByLead(calls);
    const qualifierByLead = buildQualifierByLead(calls);
    const setterLeadIds = new Set(
      calls.filter((c) => c.setterId === setterId && c.leadId).map((c) => c.leadId as string),
    );
    const ownLeads = leadRows.filter((l) => l.setterId === setterId || setterLeadIds.has(l.id));
    const ownIds = new Set(ownLeads.map((l) => l.id));

    return buildSetterStats(
      ownLeads,
      calls.filter((c) => c.setterId === setterId),
      rdvAll.filter((r) => r.leadId && ownIds.has(r.leadId as string)),
      setterId,
      range,
      latestCallByLead,
      qualifierByLead,
      firstRdvByLead,
    );
  },
});

/**
 * Stats d'un commercial arbitraire (profil équipe). Parité NestJS stricte :
 * UNIQUEMENT les lignes rdv — pas de débriefs détachés, contrairement au
 * fast-path commercial de summary. Un commercial est forcé sur SES stats.
 */
export const commercialStats = query({
  args: {
    commercialId: v.id("users"),
    now: v.number(),
    days: v.optional(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, COMMERCIAL_STATS_ROLES);
    // Un commercial ne voit que ses propres stats.
    const commercialId = roleOf(user) === "commercial" ? user._id : args.commercialId;
    const range = buildRange(args.from, args.to, args.days ?? 30, args.now);
    const rows = await ctx.db
      .query("rdv")
      .withIndex("by_commercial_scheduled", (q) => q.eq("commercialId", commercialId))
      .collect();
    return buildCommercialStats(
      rows.filter((r) => r.deletedAt === undefined).map(toRdvRow),
      range,
    );
  },
});

// ─── Funnel (7c) ─────────────────────────────────────────────────────────────

const BUSINESS_MANAGER_ROLES: Role[] = ["admin", "commercial_lead"];

/**
 * Funnel commercial filtrable (setter / secteur). Portage de
 * AnalyticsService.funnel : lead.status = source de vérité, funnel monotone
 * par construction (computeFunnelTotals). Sans cache (réactivité Convex).
 */
export const funnel = query({
  args: {
    now: v.number(),
    days: v.optional(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    setterId: v.optional(v.id("users")),
    sector: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, BUSINESS_MANAGER_ROLES);
    const range = buildRange(args.from, args.to, args.days ?? 30, args.now);

    const callDocs = await ctx.db
      .query("callLogs")
      .withIndex("by_calledAt", (q) => q.gte("calledAt", range.fromMs).lte("calledAt", range.toMs))
      .collect();
    const calls = callDocs.map(toCallRow);
    const [allLeads, rdvDocs, userDocs, detached] = await Promise.all([
      ctx.db.query("leads").collect(),
      ctx.db.query("rdv").collect(),
      ctx.db.query("users").collect(),
      loadDetachedDebriefRdvRows(ctx, range),
    ]);
    const activeLeads = allLeads.filter((l) => l.deletedAt === undefined);
    const leadRows = activeLeads
      .filter((l) => isInRange(l._creationTime, range))
      .map(toLeadRow);
    const rdvRows = rdvDocs
      .filter((r) => r.deletedAt === undefined && isInRange(r._creationTime, range))
      .map(toRdvRow);
    const userRows: UserRow[] = userDocs
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u._id, name: u.name ?? "", role: roleOf(u) }));
    // Liste globale des secteurs (toutes périodes) pour le dropdown.
    const sectorList = [
      ...new Set(
        activeLeads
          .map((l) => l.city || l.canalAcquisition || l.utmSource || l.source || "")
          .filter(Boolean),
      ),
    ].sort();

    const scopedLeads = leadRows.filter((lead) => {
      if (!isNewLeadInRange(lead, range)) return false;
      if (args.setterId && lead.setterId !== args.setterId) return false;
      if (args.sector && !matchesSector(lead, args.sector)) return false;
      return true;
    });
    const scopedLeadIds = new Set(scopedLeads.map((l) => l.id));
    const scopedCalls = calls.filter(
      (call) =>
        call.leadId &&
        scopedLeadIds.has(call.leadId) &&
        isInRange(call.calledAt, range) &&
        (!args.setterId || call.setterId === args.setterId),
    );
    const rdvRowsAll = [...rdvRows, ...detached];
    const scopedRdvs = rdvRowsAll.filter(
      (row) => row.leadId && scopedLeadIds.has(row.leadId as string) && isInRange(row.createdAt, range),
    );
    const classifiedLeads = scopedLeads.filter(isClassifiedLead);
    const rdvLeadIds = scopedRdvs.map((row) => row.leadId).filter((id): id is string => Boolean(id));
    const totals = computeFunnelTotals({ scopedLeads, classifiedLeads, scopedCalls, rdvLeadIds });

    return {
      generatedAt: new Date(args.now).toISOString(),
      engine: "convex-funnel" as const,
      range: {
        from: new Date(range.fromMs).toISOString(),
        to: new Date(range.toMs).toISOString(),
        days: range.days,
      },
      filters: { setterId: args.setterId ?? null, sector: args.sector ?? null },
      totals,
      stages: [
        { id: "new", label: "Nouveaux leads", value: totals.newLeads, percent: 100, detail: "Leads reçus dans le CRM" },
        { id: "calls", label: "Appels setters", value: totals.calls, percent: pct(totals.calls, totals.newLeads), detail: "Leads appelés ou travaillés" },
        { id: "answered", label: "A répondu", value: totals.answered, percent: totals.responseRate, detail: "Réponses / leads contactés" },
        { id: "qualified", label: "Qualifiés", value: totals.qualified, percent: totals.qualificationRate, detail: "Qualifiés / réponses" },
        { id: "rdv", label: "RDV pris", value: totals.rdv, percent: totals.globalConversionRate, detail: "Conversion globale nouveaux leads → RDV" },
      ],
      setterComparison: buildFunnelSetterRows(scopedLeads, scopedCalls, scopedRdvs, userRows),
      commercialComparison: buildFunnelCommercialRows(scopedRdvs, userRows),
      daily: buildFunnelDaily(scopedLeads, scopedCalls, scopedRdvs, range),
      sectors: sectorList,
    };
  },
});

// ─── Pipeline analytics (7c) ─────────────────────────────────────────────────
// Alimentés par le pont GHL (leads.ghlStageName + leadStageHistory). Sans cache :
// vues de monitoring quasi-temps réel, la réactivité Convex fait le travail.

/**
 * Distribution des leads actifs par stage GHL (libellé exact) : rendu kanban
 * admin avec totaux + valeurs.
 */
export const pipelineDistribution = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, BUSINESS_MANAGER_ROLES);
    const rows = (await ctx.db.query("leads").collect()).filter((l) => l.deletedAt === undefined);

    const groups = new Map<string | null, { count: number; totalValue: number; saasStatus: string | null }>();
    for (const l of rows) {
      const key = l.ghlStageName ?? null;
      const g = groups.get(key) ?? { count: 0, totalValue: 0, saasStatus: null };
      g.count += 1;
      g.totalValue += l.monetaryValue ?? 0;
      // MIN(status) lexical, parité SQL NestJS.
      if (g.saasStatus === null || l.status < g.saasStatus) g.saasStatus = l.status;
      groups.set(key, g);
    }

    let totalCount = 0;
    let totalValue = 0;
    for (const g of groups.values()) {
      totalCount += g.count;
      totalValue += g.totalValue;
    }
    return {
      generatedAt: new Date(args.now).toISOString(),
      totalOpenLeads: totalCount,
      totalOpenValue: totalValue,
      stages: [...groups.entries()]
        .map(([ghlStageName, g]) => ({
          ghlStageName,
          saasStatus: g.saasStatus,
          count: g.count,
          totalValue: g.totalValue,
        }))
        .sort((a, b) => (a.ghlStageName ?? "~").localeCompare(b.ghlStageName ?? "~")),
    };
  },
});

/**
 * KPIs par commercial sur les leads ouverts. Inclut tous les commerciaux actifs,
 * même à 0 dossier (pour repérer les sous-chargés).
 */
export const pipelineByCommercial = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, BUSINESS_MANAGER_ROLES);
    const [userDocs, leadDocs] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("leads").collect(),
    ]);
    const commercials = userDocs.filter(
      (u) => u.deletedAt === undefined && roleOf(u) === "commercial" && u.active !== false,
    );

    type Agg = { openLeads: number; rdvPlanned: number; devisEnAttente: number; signed: number; lost: number; ca: number };
    const stats = new Map<string, Agg>();
    for (const l of leadDocs) {
      if (l.deletedAt !== undefined || !l.assignedToId) continue;
      const s = stats.get(l.assignedToId) ?? { openLeads: 0, rdvPlanned: 0, devisEnAttente: 0, signed: 0, lost: 0, ca: 0 };
      s.openLeads += 1;
      if (l.status === "rdv_pris") s.rdvPlanned += 1;
      if (l.status === "rdv_honore") s.devisEnAttente += 1;
      if (l.status === "signe") {
        s.signed += 1;
        s.ca += l.monetaryValue ?? 0;
      }
      if (l.status === "perdu") s.lost += 1;
      stats.set(l.assignedToId, s);
    }

    const result = commercials.map((c) => {
      const s = stats.get(c._id) ?? { openLeads: 0, rdvPlanned: 0, devisEnAttente: 0, signed: 0, lost: 0, ca: 0 };
      const denom = s.signed + s.lost;
      return {
        userId: c._id,
        name: c.name ?? "",
        ghlUserId: c.ghlUserId ?? null,
        openLeads: s.openLeads,
        rdvPlanned: s.rdvPlanned,
        devisEnAttente: s.devisEnAttente,
        signed: s.signed,
        ca: s.ca,
        closingRate: denom > 0 ? s.signed / denom : 0,
      };
    });
    result.sort((a, b) => b.openLeads - a.openLeads);
    return { generatedAt: new Date(args.now).toISOString(), commercials: result };
  },
});

/**
 * Leads ouverts sans changement de stage GHL depuis `days` jours
 * (max leadStageHistory.changedAt ; sans history, repli _creationTime —
 * écart : leads.updatedAt n'existe pas en Convex).
 */
export const pipelineStuck = query({
  args: { days: v.number(), now: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, BUSINESS_MANAGER_ROLES);
    const threshold = args.now - args.days * 24 * 60 * 60 * 1000;

    const [leadDocs, historyDocs] = await Promise.all([
      ctx.db.query("leads").collect(),
      ctx.db.query("leadStageHistory").collect(),
    ]);
    const lastChangeByLead = new Map<string, number>();
    for (const h of historyDocs) {
      const current = lastChangeByLead.get(h.leadId);
      if (current === undefined || h.changedAt > current) lastChangeByLead.set(h.leadId, h.changedAt);
    }

    const stuck = [];
    for (const l of leadDocs) {
      if (l.deletedAt !== undefined) continue;
      // Pas de stuck pour les états « finis ».
      if (l.status === "signe" || l.status === "perdu") continue;
      const effective = lastChangeByLead.get(l._id) ?? l._creationTime;
      if (effective > threshold) continue;
      const assignedTo = l.assignedToId ? await ctx.db.get(l.assignedToId) : null;
      stuck.push({
        leadId: l._id,
        firstName: l.firstName ?? null,
        lastName: l.lastName ?? null,
        email: l.email ?? null,
        ghlStageName: l.ghlStageName ?? null,
        saasStatus: l.status,
        assignedToId: l.assignedToId ?? null,
        assignedToName: assignedTo?.name ?? null,
        monetaryValue: l.monetaryValue ?? null,
        lastStageChangeAt: new Date(effective).toISOString(),
        stuckDays: Math.floor((args.now - effective) / 86_400_000),
      });
    }
    stuck.sort((a, b) => b.stuckDays - a.stuckDays);
    return { generatedAt: new Date(args.now).toISOString(), thresholdDays: args.days, leads: stuck };
  },
});
