/**
 * Dépôts de solde publicitaire. L'API Meta n'expose pas l'historique de
 * facturation du compte (endpoint transactions inexistant, compte postpayé
 * carte) : l'admin saisit donc chaque dépôt à la main. Le DERNIER dépôt sert
 * de point de départ aux KPI principaux de la page Ads (query budget) :
 * dépense consommée, prospects générés, impressions et clics depuis ce dépôt.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import { adChannelValidator } from "./model/enums";

// Mêmes rôles de lecture que le rapport ads (convex/ads.ts).
const ADS_ROLES = ["admin", "commercial_lead"] as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function bizCreatedAt(doc: { createdAt?: number; _creationTime: number }): number {
  return doc.createdAt ?? doc._creationTime;
}

/** Début du jour Réunion (UTC+4) d'une clé YYYY-MM-DD, en ms epoch. */
function reunionDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00+04:00`);
}

/** Historique des dépôts du canal, du plus récent au plus ancien. */
export const list = query({
  args: { channel: adChannelValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...ADS_ROLES]);
    const docs = await ctx.db
      .query("adDeposits")
      .withIndex("by_channel_date", (q) => q.eq("channel", args.channel))
      .collect();
    docs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._creationTime - a._creationTime));
    return docs.map((d) => ({
      id: d._id,
      date: d.date,
      amount: d.amount,
      note: d.note ?? null,
    }));
  },
});

/** Enregistre un dépôt (admin). */
export const add = mutation({
  args: {
    date: v.string(), // YYYY-MM-DD
    amount: v.number(),
    channel: adChannelValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    if (!DAY_RE.test(args.date)) throw new Error(`Date invalide : ${args.date} (attendu YYYY-MM-DD)`);
    if (!(args.amount > 0)) throw new Error("Le montant du dépôt doit être positif.");
    const note = args.note?.trim();
    return await ctx.db.insert("adDeposits", {
      date: args.date,
      amount: args.amount,
      channel: args.channel,
      ...(note ? { note } : {}),
      createdBy: user._id,
      updatedAt: Date.now(),
    });
  },
});

/** Supprime un dépôt saisi par erreur (admin). */
export const remove = mutation({
  args: { id: v.id("adDeposits") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc) return null;
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * KPI « budget en cours » : depuis le dernier dépôt (date incluse) —
 * dépense consommée, prospects arrivés sur le canal, impressions et clics.
 * deposit=null tant qu'aucun dépôt n'est saisi (la section reste masquée).
 */
export const budget = query({
  args: { channel: adChannelValidator },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...ADS_ROLES]);

    const latest = (
      await ctx.db
        .query("adDeposits")
        .withIndex("by_channel_date", (q) => q.eq("channel", args.channel))
        .collect()
    ).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._creationTime - a._creationTime))[0];
    if (!latest) return { deposit: null, spend: 0, leads: 0, impressions: 0, clicks: 0, cpl: 0, remaining: 0 };

    // Dépense/impressions/clics : lignes quotidiennes depuis le jour du dépôt.
    const spendDocs = await ctx.db
      .query("adSpendDaily")
      .withIndex("by_channel_date", (q) => q.eq("channel", args.channel).gte("date", latest.date))
      .collect();
    let spend = 0, impressions = 0, clicks = 0;
    for (const d of spendDocs) {
      spend += d.spend;
      impressions += d.impressions;
      clicks += d.clicks;
    }

    // Prospects du canal arrivés depuis le début (Réunion) du jour du dépôt.
    const fromMs = reunionDayStartMs(latest.date);
    const leads = (
      await ctx.db
        .query("leads")
        .withIndex("by_acquisitionChannel", (q) => q.eq("acquisitionChannel", args.channel))
        .collect()
    ).filter((l) => l.deletedAt === undefined && bizCreatedAt(l) >= fromMs).length;

    return {
      deposit: { id: latest._id, date: latest.date, amount: latest.amount, note: latest.note ?? null },
      spend,
      leads,
      impressions,
      clicks,
      cpl: leads > 0 ? spend / leads : 0,
      remaining: latest.amount - spend,
    };
  },
});
