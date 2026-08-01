/**
 * Sync de la dépense publicitaire Meta. Trois sources possibles, par ordre
 * de préférence :
 *  1. API Graph directe (META_ACCESS_TOKEN + META_AD_ACCOUNT_ID) — token
 *     utilisateur longue durée (~60 j, à renouveler) ; un seul appel avec
 *     time_increment=1 pour des lignes quotidiennes au niveau ad.
 *  2. Composio (COMPOSIO_API_KEY + META_AD_ACCOUNT_ID) — exécute le tool
 *     METAADS_GET_INSIGHTS sur le compte Meta connecté dans Composio, qui
 *     gère le refresh du token OAuth. Le tool n'expose pas time_increment,
 *     donc un appel par jour (time_range since=until) pour des lignes
 *     quotidiennes au niveau ad.
 *  3. Windsor.ai (WINDSOR_API_KEY) — chemin historique du module NestJS.
 * Sans aucune clé, la sync sort proprement en skipped (l'app reste intacte).
 */

import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import { requireHermesKey } from "./model/hermesAuth";
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

function composioApiKey(): string | undefined {
  return process.env.COMPOSIO_API_KEY || undefined;
}

function metaAccessToken(): string | undefined {
  return process.env.META_ACCESS_TOKEN || undefined;
}

const GRAPH_INSIGHT_FIELDS = [
  "campaign_name", "campaign_id", "adset_name", "adset_id",
  "ad_name", "ad_id", "spend", "impressions", "clicks",
];

/** Jours YYYY-MM-DD de from à to inclus. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

interface GraphInsightRow {
  date_start?: string;
  campaign_name?: string;
  campaign_id?: string;
  adset_name?: string;
  adset_id?: string;
  ad_name?: string;
  ad_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  [k: string]: unknown;
}

function mapGraphRow(day: string, r: GraphInsightRow): MetaInsightRow {
  const str = (x: unknown) => (x != null && String(x).trim() !== "" ? String(x) : undefined);
  return {
    date: str(r.date_start) ?? day,
    ...(str(r.campaign_name) !== undefined ? { campaign: str(r.campaign_name)! } : {}),
    ...(str(r.campaign_id) !== undefined ? { campaignId: str(r.campaign_id)! } : {}),
    ...(str(r.adset_name) !== undefined ? { adset: str(r.adset_name)! } : {}),
    ...(str(r.adset_id) !== undefined ? { adsetId: str(r.adset_id)! } : {}),
    ...(str(r.ad_name) !== undefined ? { ad: str(r.ad_name)! } : {}),
    ...(str(r.ad_id) !== undefined ? { adId: str(r.ad_id)! } : {}),
    spend: Number(r.spend ?? 0) || 0,
    impressions: Number(r.impressions ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
  };
}

async function fetchMetaInsightsGraph(range: { from: string; to: string }): Promise<MetaInsightRow[]> {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) throw new Error("META_AD_ACCOUNT_ID absente (ex. act_928367685155102)");
  const base = process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";
  const params = new URLSearchParams({
    level: "ad",
    fields: GRAPH_INSIGHT_FIELDS.join(","),
    time_range: JSON.stringify({ since: range.from, until: range.to }),
    time_increment: "1",
    limit: "500",
    access_token: metaAccessToken()!,
  });
  const rows: MetaInsightRow[] = [];
  let url: string | undefined = `${base}/${accountId}/insights?${params}`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta Graph API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: GraphInsightRow[]; paging?: { next?: string } };
    for (const r of json.data ?? []) rows.push(mapGraphRow(range.from, r));
    url = json.paging?.next;
  }
  return rows;
}

async function fetchMetaInsightsComposio(range: { from: string; to: string }): Promise<MetaInsightRow[]> {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  if (!accountId) throw new Error("META_AD_ACCOUNT_ID absente (ex. act_928367685155102)");
  const base = process.env.COMPOSIO_API_BASE_URL ?? "https://backend.composio.dev";
  const connectedAccountId = process.env.COMPOSIO_META_ACCOUNT_ID; // optionnel : compte metaads par défaut sinon
  const userId = process.env.COMPOSIO_USER_ID; // optionnel : requis par certains projets Composio
  const rows: MetaInsightRow[] = [];
  for (const day of eachDay(range.from, range.to)) {
    let after: string | undefined;
    do {
      const res = await fetch(`${base}/api/v3/tools/execute/METAADS_GET_INSIGHTS`, {
        method: "POST",
        headers: { "x-api-key": composioApiKey()!, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(connectedAccountId ? { connected_account_id: connectedAccountId } : {}),
          ...(userId ? { user_id: userId } : {}),
          arguments: {
            object_id: accountId,
            level: "ad",
            time_range: { since: day, until: day },
            fields: GRAPH_INSIGHT_FIELDS,
            limit: 500,
            ...(after ? { after } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`Composio API ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        successful?: boolean;
        error?: unknown;
        data?: { data?: GraphInsightRow[]; paging?: { next?: string; cursors?: { after?: string } } };
      };
      if (json.successful === false) {
        throw new Error(`Composio METAADS_GET_INSIGHTS: ${JSON.stringify(json.error).slice(0, 300)}`);
      }
      for (const r of json.data?.data ?? []) rows.push(mapGraphRow(day, r));
      // Graph renvoie toujours cursors.after ; seule la présence de paging.next
      // indique une page suivante.
      after = json.data?.paging?.next ? json.data?.paging?.cursors?.after : undefined;
    } while (after);
  }
  return rows;
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
  if (!metaAccessToken() && !composioApiKey() && !windsorApiKey()) {
    console.warn("META_ACCESS_TOKEN, COMPOSIO_API_KEY et WINDSOR_API_KEY absentes — sync Meta sautée");
    return { synced: 0, totalSpend: "0", skipped: true };
  }
  const rows = metaAccessToken()
    ? await fetchMetaInsightsGraph(range)
    : composioApiKey()
      ? await fetchMetaInsightsComposio(range)
      : await fetchMetaInsights(range);
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

/**
 * Ingestion service (relais VPS Hermes) : le VPS fetch les insights Meta via
 * son CLI Composio et pousse les lignes ici, gardé par HERMES_API_KEY —
 * chemin de secours tant que COMPOSIO_API_KEY n'est pas posée côté Convex.
 */
export const ingestRows = action({
  args: { apiKey: v.string(), rows: v.array(upsertRowValidator) },
  handler: async (ctx, args) => {
    requireHermesKey(args.apiKey);
    for (let i = 0; i < args.rows.length; i += 100) {
      await ctx.runMutation(internal.adSpend.upsertRows, {
        rows: args.rows.slice(i, i + 100),
        now: Date.now(),
      });
    }
    const total = args.rows.reduce((s, r) => s + r.spend, 0);
    return { ingested: args.rows.length, totalSpend: total.toFixed(2) };
  },
});

/** Totaux de contrôle de la table adSpendDaily (vérif backfill/sync via CLI). */
export const stats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("adSpendDaily").collect();
    let spend = 0, impressions = 0, clicks = 0;
    let from: string | undefined, to: string | undefined;
    for (const d of docs) {
      spend += d.spend;
      impressions += d.impressions;
      clicks += d.clicks;
      if (!from || d.date < from) from = d.date;
      if (!to || d.date > to) to = d.date;
    }
    return { rows: docs.length, spend: spend.toFixed(2), impressions, clicks, from, to };
  },
});

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
