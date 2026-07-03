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
  type LeadRow,
  type CallRow,
  type RdvRow,
  type UserRow,
} from "./model/analyticsBuilders";
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
    const [leadRows, rdvDocs, userDocs, detached] = await Promise.all([
      loadActiveLeads(ctx, range, calledLeadIds),
      ctx.db.query("rdv").collect(),
      ctx.db.query("users").collect(),
      loadDetachedDebriefRdvRows(ctx, range),
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
        ? buildAdminStats(leadRows, calls, rdvAll, userRows, range, latestCallByLead)
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
    const [leadRows, rdvDocs, detached] = await Promise.all([
      loadActiveLeads(ctx, range, calledLeadIds),
      ctx.db.query("rdv").collect(),
      loadDetachedDebriefRdvRows(ctx, range),
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
