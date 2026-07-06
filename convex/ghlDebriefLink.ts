/**
 * Lien débrief GHL (flux sortant) — Tranche 8c-1. Pousse le token magique dans
 * le champ contact `lien_debrief` (backfill cron 2 min) et le statut du RDV
 * après débrief. DÉBRANCHÉ tant que GHL_SYNC_ENABLED !== "true".
 */
import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";

// Portage verbatim de mapRdvResultToGhlAppointmentStatus (service NestJS).
export function mapRdvResultToGhlAppointmentStatus(
  result: string | undefined,
  status: string | undefined,
): string | undefined {
  if (result === "signe") return "confirmed";
  if (result === "no_show" || status === "no_show") return "noshow";
  if (result === "reporte" || status === "reporte") return "cancelled";
  if (result === "perdu" || result === "reflexion") return "showed";
  return undefined;
}

export const dueRdvForBackfill = internalQuery({
  args: { fromMs: v.number(), toMs: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("rdv")
      .withIndex("by_scheduledAt", (q) => q.gte("scheduledAt", args.fromMs).lte("scheduledAt", args.toMs))
      .collect();
    const out: Array<{ rdvId: (typeof rows)[number]["_id"]; contactExternalId: string }> = [];
    for (const r of rows) {
      if (r.deletedAt !== undefined || r.debriefFilledAt !== undefined || r.debriefDueAt !== undefined) continue;
      if (r.externalId === undefined) continue;
      const lead = await ctx.db.get(r.leadId);
      if (!lead || lead.deletedAt !== undefined || lead.externalId === undefined) continue;
      out.push({ rdvId: r._id, contactExternalId: lead.externalId });
      if (out.length >= args.limit) break;
    }
    return out;
  },
});

export const markDebriefDuePushed = internalMutation({
  args: { rdvId: v.id("rdv"), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.rdvId, { debriefDueAt: args.now });
    return null;
  },
});

export const rdvForDebriefPush = internalQuery({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.rdvId);
    if (!r || r.deletedAt !== undefined) return null;
    return { externalId: r.externalId, result: r.result, status: r.status };
  },
});
