// Objectifs commerciaux par mois — portage de CommercialObjectivesService.
// Business managers (admin + commercial_lead) : lecture par période, upsert
// (une ligne par commercial × période, l'éditeur envoie l'objectif complet).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import { logActivity, userLabelById } from "./model/activity";
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
    const commercialName = await userLabelById(ctx, args.commercialId);
    const summary = `a défini les objectifs ${args.period} de ${commercialName} (CA ${targets.caTarget ?? "—"}, ventes ${targets.ventesTarget ?? "—"}, RDV ${targets.rdvTarget ?? "—"}, closing ${targets.closingTarget ?? "—"})`;
    if (existing) {
      await ctx.db.patch(existing._id, { ...targets, updatedById: actor._id });
      await logActivity(ctx, {
        action: "objective.updated", entityType: "commercial_objective", entityId: existing._id,
        subject: commercialName, summary,
        details: { period: args.period, before: { caTarget: existing.caTarget ?? null, ventesTarget: existing.ventesTarget ?? null, rdvTarget: existing.rdvTarget ?? null, closingTarget: existing.closingTarget ?? null }, after: targets },
      });
      return existing._id;
    }
    const id = await ctx.db.insert("commercialObjectives", {
      commercialId: args.commercialId,
      period: args.period,
      ...targets,
      createdById: actor._id,
      updatedById: actor._id,
    });
    await logActivity(ctx, {
      action: "objective.created", entityType: "commercial_objective", entityId: id,
      subject: commercialName, summary, details: { period: args.period, after: targets },
    });
    return id;
  },
});
