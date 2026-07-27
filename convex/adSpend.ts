/**
 * Sync de la dépense publicitaire Meta via Windsor.ai (portage du module
 * ad-spend NestJS). Windsor sert d'intermédiaire d'accès au compte Meta :
 * la clé WINDSOR_API_KEY (env deployment) suffit, pas de token Graph API.
 * Sans clé, la sync sort proprement en skipped (l'app reste intacte).
 */

import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import { reunionDayKey } from "./model/analyticsRange";

interface MetaInsightRow {
  date: string; // YYYY-MM-DD
  campaign?: string;
  campaignId?: string;
  adset?: string;
  adsetId?: string;
  ad?: string;
  adId?: string;
  spend: number;
  impressions: number;
  clicks: number;
}

const WINDSOR_FIELDS = [
  "date", "campaign", "campaign_id", "adset_name", "adset_id",
  "ad_name", "ad_id", "spend", "impressions", "clicks",
].join(",");

function windsorApiKey(): string | undefined {
  return process.env.WINDSOR_API_KEY || undefined;
}

async function fetchMetaInsights(range: { from: string; to: string }): Promise<MetaInsightRow[]> {
  const base = process.env.WINDSOR_API_BASE_URL ?? "https://connectors.windsor.ai/all";
  const url =
    `${base}?api_key=${windsorApiKey()}` +
    `&date_preset=&date_from=${range.from}&date_to=${range.to}` +
    `&fields=${WINDSOR_FIELDS}&_source=facebook`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Windsor API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const str = (x: unknown) => (x != null && String(x).trim() !== "" ? String(x) : undefined);
  return (json.data ?? []).map((r) => ({
    date: String(r.date),
    ...(str(r.campaign) !== undefined ? { campaign: str(r.campaign)! } : {}),
    ...(str(r.campaign_id) !== undefined ? { campaignId: str(r.campaign_id)! } : {}),
    ...(str(r.adset_name) !== undefined ? { adset: str(r.adset_name)! } : {}),
    ...(str(r.adset_id) !== undefined ? { adsetId: str(r.adset_id)! } : {}),
    ...(str(r.ad_name) !== undefined ? { ad: str(r.ad_name)! } : {}),
    ...(str(r.ad_id) !== undefined ? { adId: str(r.ad_id)! } : {}),
    spend: Number(r.spend ?? 0) || 0,
    impressions: Number(r.impressions ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
  }));
}

export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return null;
  },
});

const upsertRowValidator = v.object({
  date: v.string(),
  campaign: v.optional(v.string()),
  campaignId: v.optional(v.string()),
  adset: v.optional(v.string()),
  adsetId: v.optional(v.string()),
  ad: v.optional(v.string()),
  adId: v.optional(v.string()),
  spend: v.number(),
  impressions: v.number(),
  clicks: v.number(),
});

// Upsert idempotent : match par (date, channel, campaign, adset, ad) — parité
// avec l'index unique COALESCE Postgres. Les ids Meta sont rafraîchis au passage.
export const upsertRows = internalMutation({
  args: { rows: v.array(upsertRowValidator), now: v.number() },
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("adSpendDaily")
        .withIndex("by_upsert_key", (q) =>
          q.eq("date", row.date).eq("channel", "meta")
            .eq("campaign", row.campaign).eq("adset", row.adset).eq("ad", row.ad),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          campaignId: row.campaignId,
          adsetId: row.adsetId,
          adId: row.adId,
          updatedAt: args.now,
        });
      } else {
        await ctx.db.insert("adSpendDaily", { ...row, channel: "meta", updatedAt: args.now });
      }
    }
    return null;
  },
});

async function runSync(
  ctx: ActionCtx,
  range: { from: string; to: string },
): Promise<{ synced: number; totalSpend: string; skipped: boolean }> {
  if (!windsorApiKey()) {
    console.warn("WINDSOR_API_KEY absente — sync Meta sautée");
    return { synced: 0, totalSpend: "0", skipped: true };
  }
  const rows = await fetchMetaInsights(range);
  const total = rows.reduce((s, r) => s + r.spend, 0);
  // Batches : borne la taille des mutations (une journée Meta = qq dizaines de lignes).
  for (let i = 0; i < rows.length; i += 100) {
    await ctx.runMutation(internal.adSpend.upsertRows, {
      rows: rows.slice(i, i + 100),
      now: Date.now(),
    });
  }
  return { synced: rows.length, totalSpend: total.toFixed(2), skipped: false };
}

/** Jour Réunion YYYY-MM-DD depuis une borne ISO du DateRangePicker. */
function dayOf(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Date invalide : ${iso}`);
  return reunionDayKey(ms);
}

/** Resync / backfill manuel (bouton admin de la page Ads). */
export const sync = action({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.adSpend.assertAdmin, {});
    return await runSync(ctx, { from: dayOf(args.from), to: dayOf(args.to) });
  },
});

/** Cron quotidien : fenêtre glissante 7 jours (parité NestJS 3h du matin). */
export const syncScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const to = Date.now();
    const from = to - 7 * 86_400_000;
    const r = await runSync(ctx, { from: reunionDayKey(from), to: reunionDayKey(to) });
    console.log(`Sync Meta : ${r.synced} lignes, dépense ${r.totalSpend}€ (skipped=${r.skipped})`);
    return null;
  },
});
