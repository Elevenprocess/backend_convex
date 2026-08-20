// Backfill des agrégats dénormalisés leads.agg (cf. model/leadAgg.ts).
// À lancer une fois après déploiement (et après tout bump d'AGG_VERSION) :
//   npx convex run leadAggBackfill:backfillAll
// Idempotent : les leads déjà à la bonne version sont sautés.
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AGG_VERSION, computeLeadAgg } from "./model/leadAgg";

// Petits lots : chaque lead recalculé relit ses callLogs/rdv/devis/clients/
// stageHistory — 50 leads restent loin des limites de transaction.
const PAGE_SIZE = 50;

export const backfillPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("leads")
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    let refreshed = 0;
    let skipped = 0;
    for (const lead of page.page) {
      if (lead.agg?.v === AGG_VERSION) {
        skipped++;
        continue;
      }
      await ctx.db.patch(lead._id, { agg: await computeLeadAgg(ctx, lead) });
      refreshed++;
    }
    return { cursor: page.continueCursor, isDone: page.isDone, refreshed, skipped };
  },
});

export const backfillAll = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null;
    let totalRefreshed = 0;
    let totalSkipped = 0;
    let pages = 0;
    for (;;) {
      const res: { cursor: string; isDone: boolean; refreshed: number; skipped: number } =
        await ctx.runMutation(internal.leadAggBackfill.backfillPage, { cursor });
      totalRefreshed += res.refreshed;
      totalSkipped += res.skipped;
      pages++;
      if (pages % 10 === 0) {
        console.log(`leadAgg backfill : ${totalRefreshed} recalculés, ${totalSkipped} déjà à jour…`);
      }
      if (res.isDone) break;
      cursor = res.cursor;
    }
    console.log(`leadAgg backfill terminé : ${totalRefreshed} recalculés, ${totalSkipped} déjà à jour (${pages} pages).`);
    return { refreshed: totalRefreshed, skipped: totalSkipped };
  },
});
