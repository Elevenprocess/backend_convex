import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { rdvLocationValidator } from "./model/enums";
import { requireRole, assertCommercialRole } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";

export const OPEN_RDV_STATUSES = ["planifie", "reporte"] as const;
export const COMMERCIAL = ["admin", "commercial", "commercial_lead"] as const;

export const create = mutation({
  args: {
    leadId: v.id("leads"),
    commercialId: v.optional(v.id("users")),
    scheduledAt: v.optional(v.number()),
    locationType: v.optional(rdvLocationValidator),
    externalId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);

    const open = await ctx.db
      .query("rdv")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    if (
      open.some(
        (r) =>
          r.deletedAt === undefined &&
          (OPEN_RDV_STATUSES as readonly string[]).includes(r.status),
      )
    ) {
      throw new Error(
        "Un RDV ouvert existe déjà pour ce lead ; termine-le avant d'en créer un nouveau.",
      );
    }

    if (args.commercialId) await assertCommercialRole(ctx, args.commercialId);

    const rdvId = await ctx.db.insert("rdv", {
      leadId: args.leadId,
      commercialId: args.commercialId,
      scheduledAt: args.scheduledAt,
      locationType: args.locationType ?? "domicile",
      status: "planifie",
      externalId: args.externalId,
      notes: args.notes,
    });

    const lead = await ctx.db.get(args.leadId);
    if (lead && lead.status !== "qualifie") {
      await ctx.db.patch(args.leadId, {
        status: "qualifie",
        ...(args.commercialId ? { assignedToId: args.commercialId } : {}),
      });
      await insertStageHistory(ctx, {
        leadId: args.leadId,
        ghlStageName: "qualifie",
        saasStatus: "qualifie",
        assignedToId: args.commercialId ?? lead.assignedToId,
        changedAt: Date.now(),
        source: "manual",
      });
    } else if (lead && args.commercialId && lead.assignedToId !== args.commercialId) {
      await ctx.db.patch(args.leadId, { assignedToId: args.commercialId });
    }

    return rdvId;
  },
});
