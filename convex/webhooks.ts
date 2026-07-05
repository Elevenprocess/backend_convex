/**
 * Webhooks entrants GHL — audit trail + traitement (Tranche 8a).
 * Les http actions (convex/http.ts) orchestrent : record → traiter →
 * markProcessed/markFailed. Chaque étape est une mutation séparée pour que
 * l'event d'audit survive à l'échec du traitement (parité NestJS).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { webhookProviderValidator } from "./model/enums";
import { mapGhlStageToStatus } from "./model/ghl/stageMapper";

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

/**
 * Portage central de LeadsService.applyGhlStageChange (NestJS l.678-878).
 * Idempotent : le replay du même mouvement (lead, stage, occurredAt) est
 * dédupé par lookup sur l'index by_lead_stage_changedAt (transactionnel).
 * lostReason stocké BRUT (résolution label → 8d).
 */
export const applyGhlStageChange = internalMutation({
  args: {
    externalId: v.string(),
    ghlStageName: v.string(),
    ghlPipelineId: v.optional(v.string()),
    monetaryValue: v.optional(v.number()),
    ghlAssignedUserId: v.optional(v.string()),
    lostReason: v.optional(v.string()),
    webhookEventId: v.optional(v.string()),
    occurredAt: v.number(),
    contactSeed: v.optional(
      v.object({
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
      }),
    ),
    silent: v.optional(v.boolean()),
  },
  handler: async (ctx, input) => {
    const mapped = mapGhlStageToStatus(input.ghlStageName);
    if (!mapped.isKnown) {
      console.warn(
        `Stage GHL inconnu reçu via webhook : "${input.ghlStageName}" (externalId=${input.externalId}) — status conservé.`,
      );
    }
    const normalizedStage = mapped.normalizedName ?? input.ghlStageName.trim();

    // 1) Résoudre le commercial via users.ghlUserId
    let assignedToId: Id<"users"> | undefined;
    if (input.ghlAssignedUserId !== undefined) {
      const ghlUserId = input.ghlAssignedUserId;
      const u = await ctx.db
        .query("users")
        .withIndex("by_ghlUserId", (q) => q.eq("ghlUserId", ghlUserId))
        .first();
      if (u) assignedToId = u._id;
      else
        console.warn(
          `Commercial GHL non mappé : ghlUserId=${ghlUserId} — assignedToId laissé inchangé.`,
        );
    }

    // 2) Lookup lead existant (externalId GHL = contact_id, source ghl)
    const candidates = await ctx.db
      .query("leads")
      .withIndex("by_externalId", (q) => q.eq("externalId", input.externalId))
      .collect();
    const existing = candidates.find((l) => l.source === "ghl");

    let leadId: Id<"leads">;
    let created = false;
    let statusChanged = false;
    let previousStatus: Doc<"leads">["status"] | undefined;

    if (!existing) {
      // Création minimale (opportunité arrivée avant contact.created).
      leadId = await ctx.db.insert("leads", {
        externalId: input.externalId,
        source: "ghl",
        status: mapped.status ?? "nouveau",
        ...(input.contactSeed?.firstName !== undefined ? { firstName: input.contactSeed.firstName } : {}),
        ...(input.contactSeed?.lastName !== undefined ? { lastName: input.contactSeed.lastName } : {}),
        ...(input.contactSeed?.email !== undefined ? { email: input.contactSeed.email } : {}),
        ...(input.contactSeed?.phone !== undefined ? { phone: input.contactSeed.phone } : {}),
        ...(assignedToId !== undefined ? { assignedToId } : {}),
        ghlStageName: normalizedStage,
        ...(input.ghlPipelineId !== undefined ? { ghlPipelineId: input.ghlPipelineId } : {}),
        ...(input.monetaryValue !== undefined ? { monetaryValue: input.monetaryValue } : {}),
        ...(input.lostReason !== undefined ? { lostReason: input.lostReason } : {}),
        ...(mapped.sideEffect === "archived" ? { deletedAt: input.occurredAt } : {}),
        ...(input.silent ? { createdAt: input.occurredAt } : {}),
      });
      created = true;
      statusChanged = true;
    } else {
      leadId = existing._id;
      previousStatus = existing.status;
      const patch: Partial<Doc<"leads">> = { ghlStageName: normalizedStage };
      if (input.ghlPipelineId !== undefined) patch.ghlPipelineId = input.ghlPipelineId;
      if (input.monetaryValue !== undefined) patch.monetaryValue = input.monetaryValue;
      if (input.lostReason !== undefined) patch.lostReason = input.lostReason;
      if (assignedToId !== undefined) patch.assignedToId = assignedToId;
      if (mapped.isKnown && mapped.status) {
        const nextStatus = mapped.status;
        patch.status = nextStatus;
        statusChanged = previousStatus !== nextStatus;
      }
      if (mapped.sideEffect === "archived" && existing.deletedAt === undefined) {
        patch.deletedAt = input.occurredAt;
      }
      await ctx.db.patch(leadId, patch);
    }

    // 3) Historique idempotent : lookup exact avant insert (index composite).
    const dup = await ctx.db
      .query("leadStageHistory")
      .withIndex("by_lead_stage_changedAt", (q) =>
        q.eq("leadId", leadId).eq("ghlStageName", normalizedStage).eq("changedAt", input.occurredAt),
      )
      .first();
    let historyAppended = false;
    if (!dup) {
      await ctx.db.insert("leadStageHistory", {
        leadId,
        ghlStageName: normalizedStage,
        saasStatus: mapped.status ?? previousStatus ?? "nouveau",
        ...(assignedToId !== undefined ? { assignedToId } : {}),
        ...(input.monetaryValue !== undefined ? { monetaryValue: input.monetaryValue } : {}),
        changedAt: input.occurredAt,
        source: input.silent ? "backfill" : "webhook",
        ...(input.webhookEventId !== undefined ? { webhookEventId: input.webhookEventId } : {}),
      });
      historyAppended = true;
    }

    return {
      leadId, created, statusChanged, historyAppended,
      ...(mapped.sideEffect !== undefined ? { sideEffect: mapped.sideEffect } : {}),
    };
  },
});
