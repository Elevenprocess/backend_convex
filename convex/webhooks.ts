/**
 * Webhooks entrants GHL — audit trail + traitement (Tranche 8a).
 * Les http actions (convex/http.ts) orchestrent : record → traiter →
 * markProcessed/markFailed. Chaque étape est une mutation séparée pour que
 * l'event d'audit survive à l'échec du traitement (parité NestJS).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { webhookProviderValidator } from "./model/enums";

export const recordEvent = internalMutation({
  args: {
    provider: webhookProviderValidator,
    eventType: v.string(),
    payload: v.string(),
    ipAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("webhookEvents", { ...args, status: "recorded" });
  },
});

export const markProcessed = internalMutation({
  args: { eventId: v.id("webhookEvents") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, { status: "processed", processedAt: Date.now() });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { eventId: v.id("webhookEvents"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "failed",
      error: args.error.slice(0, 2000),
      processedAt: Date.now(),
    });
    return null;
  },
});
