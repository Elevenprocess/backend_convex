// Objectifs commerciaux par mois — portage de CommercialObjectivesService.
// Business managers (admin + commercial_lead) : lecture par période, upsert
// (une ligne par commercial × période, l'éditeur envoie l'objectif complet).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import type { Role } from "./model/enums";

const BUSINESS_MANAGER_ROLES: Role[] = ["admin", "commercial_lead"];

export const listByPeriod = query({
  args: { period: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, BUSINESS_MANAGER_ROLES);
    return await ctx.db
      .query("commercialObjectives")
      .withIndex("by_period", (q) => q.eq("period", args.period))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    commercialId: v.id("users"),
    period: v.string(),
    caTarget: v.optional(v.number()),
    ventesTarget: v.optional(v.number()),
    rdvTarget: v.optional(v.number()),
    closingTarget: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, BUSINESS_MANAGER_ROLES);
    // Remplace toutes les cibles à chaque écriture (objectif complet envoyé).
    const targets = {
      caTarget: args.caTarget,
      ventesTarget: args.ventesTarget,
      rdvTarget: args.rdvTarget,
      closingTarget: args.closingTarget,
    };
    const existing = await ctx.db
      .query("commercialObjectives")
      .withIndex("by_commercial_period", (q) => q.eq("commercialId", args.commercialId).eq("period", args.period))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...targets, updatedById: actor._id });
      return existing._id;
    }
    return await ctx.db.insert("commercialObjectives", {
      commercialId: args.commercialId,
      period: args.period,
      ...targets,
      createdById: actor._id,
      updatedById: actor._id,
    });
  },
});
