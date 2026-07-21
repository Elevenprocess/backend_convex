/**
 * Reporting automatisé — agent Hermes (Composio) — LECTURE SEULE.
 *
 * Les queries applicatives passent par requireUser() (session utilisateur
 * Convex Auth), qu'une deploy key ne peut pas fournir. Ce module expose une
 * surface de reporting dédiée, gardée par une clé de service HERMES_API_KEY
 * (env Convex), fail-closed comme checkWebhookSecret : clé serveur absente →
 * refus. Aucune mutation ici, et aucune ne doit y être ajoutée.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { rdvStatusValidator } from "./model/enums";
import { buildRange } from "./model/analyticsRange";
import { buildAdminStats } from "./model/analyticsBuilders";
import { loadSummaryData } from "./analytics";
import { requireHermesKey } from "./model/hermesAuth";

/**
 * KPI agrégés — même vue que analytics.summary côté admin (mêmes builders,
 * mêmes règles métier), sans dépendre d'un utilisateur connecté.
 * `now` fourni par l'appelant (Date.now() interdit en query). Défaut : 365 j.
 */
export const kpis = query({
  args: {
    apiKey: v.string(),
    now: v.number(),
    days: v.optional(v.number()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireHermesKey(args.apiKey);
    const range = buildRange(args.from, args.to, args.days ?? 365, args.now);
    const { calls, leadRows, rdvAll, userRows, latestCallByLead, firstRdvByLead } =
      await loadSummaryData(ctx, range);
    return {
      generatedAt: new Date(args.now).toISOString(),
      engine: "hermes-service" as const,
      range: {
        from: new Date(range.fromMs).toISOString(),
        to: new Date(range.toMs).toISOString(),
        days: range.days,
      },
      admin: buildAdminStats(leadRows, calls, rdvAll, userRows, range, latestCallByLead, firstRdvByLead),
    };
  },
});

/**
 * Liste de RDV lecture seule (équivalent service de rdv.list, sans pagination
 * réactive : borné par `limit`, plafonné à 500). Résumé lead embarqué pour que
 * l'agent n'ait pas à re-requêter la table leads.
 */
export const rdvList = query({
  args: {
    apiKey: v.string(),
    status: v.optional(rdvStatusValidator),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireHermesKey(args.apiKey);
    const max = Math.min(Math.max(args.limit ?? 100, 1), 500);
    let q = ctx.db
      .query("rdv")
      .withIndex("by_scheduledAt")
      .order("desc")
      .filter((f) => f.eq(f.field("deletedAt"), undefined));
    if (args.status !== undefined) q = q.filter((f) => f.eq(f.field("status"), args.status!));
    if (args.from !== undefined) q = q.filter((f) => f.gte(f.field("scheduledAt"), args.from!));
    if (args.to !== undefined) q = q.filter((f) => f.lte(f.field("scheduledAt"), args.to!));
    const rows = await q.take(max);
    return await Promise.all(
      rows.map(async (r) => {
        const lead = await ctx.db.get(r.leadId);
        return {
          id: r._id,
          scheduledAt: r.scheduledAt ?? null,
          status: r.status,
          result: r.result ?? null,
          montantTotal: r.montantTotal ?? null,
          financingType: r.financingType ?? null,
          commercialId: r.commercialId ?? null,
          signatureAt: r.signatureAt ?? null,
          lead: lead
            ? {
                id: lead._id,
                firstName: lead.firstName ?? null,
                lastName: lead.lastName ?? null,
                city: lead.city ?? null,
                status: lead.status,
              }
            : null,
        };
      }),
    );
  },
});
