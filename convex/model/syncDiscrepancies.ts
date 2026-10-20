/**
 * Journal des écarts de synchro (ELE-177 / ELE-179 / ELE-180). Règle : GHL fait
 * foi pour les RDV, Soltéo pour les ventes ; un écart est SIGNALÉ ici, jamais
 * corrigé en écrasant l'autre source. Upsert idempotent sur `key`.
 */
import type { MutationCtx } from "../_generated/server";

export type DiscrepancyInput = {
  key: string;
  source: "ghl_calendar" | "solteo";
  kind: string;
  entityRef: string;
  details: string;
  now: number;
};

export async function recordDiscrepancy(ctx: MutationCtx, d: DiscrepancyInput): Promise<void> {
  const existing = await ctx.db
    .query("syncDiscrepancies")
    .withIndex("by_key", (q) => q.eq("key", d.key))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      details: d.details.slice(0, 2000),
      lastSeenAt: d.now,
      count: existing.count + 1,
    });
    return;
  }
  await ctx.db.insert("syncDiscrepancies", {
    key: d.key,
    source: d.source,
    kind: d.kind,
    entityRef: d.entityRef,
    details: d.details.slice(0, 2000),
    firstSeenAt: d.now,
    lastSeenAt: d.now,
    count: 1,
  });
}
