/**
 * Webhooks entrants GHL — audit trail + traitement (Tranche 8a).
 * Les http actions (convex/http.ts) orchestrent : record → traiter →
 * markProcessed/markFailed. Chaque étape est une mutation séparée pour que
 * l'event d'audit survive à l'échec du traitement (parité NestJS).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { webhookProviderValidator } from "./model/enums";
import { mapGhlStageToStatus } from "./model/ghl/stageMapper";
import { ensureDossier } from "./model/ensureDossier";
import { deriveAcquisitionChannel } from "./model/acquisitionChannel";

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
 * Vrai si le lead a un projet 'signe' actif ET aucun dossier délivrabilité
 * actif. Dans cet état, le statut lead reste 'signe' (règle « signé gagne »)
 * quel que soit le mouvement GHL. Portage hasSignedProjectAwaitingDelivrabilite.
 */
async function hasSignedProjectAwaitingDelivrabilite(
  ctx: MutationCtx,
  leadId: Id<"leads">,
): Promise<boolean> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  const signed = projects.some((p) => p.status === "signe" && p.deletedAt === undefined);
  if (!signed) return false;
  const dossiers = await ctx.db
    .query("clients")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  return !dossiers.some((c) => c.deletedAt === undefined);
}

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
        // « signé gagne » : tant qu'un projet signé existe et n'a pas encore
        // été transmis à la délivrabilité (aucun dossier `clients` actif), on
        // refuse toute rétrogradation venant de GHL.
        let nextStatus = mapped.status;
        if (
          nextStatus !== "signe" &&
          (await hasSignedProjectAwaitingDelivrabilite(ctx, leadId))
        ) {
          console.log(
            `[signe-wins] lead=${leadId} mouvement GHL "${mapped.status}" ignoré : projet signé non encore transmis à la délivrabilité — statut maintenu 'signe'.`,
          );
          nextStatus = "signe";
        }
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

    // 4) Passage à 'signe' → dossier délivrabilité (une fois). Parité NestJS :
    // n'importe quel dossier actif du lead suffit à skipper (même lié projet).
    if (mapped.status === "signe" && previousStatus !== "signe") {
      const dossiers = await ctx.db
        .query("clients")
        .withIndex("by_lead", (q) => q.eq("leadId", leadId))
        .collect();
      if (!dossiers.some((c) => c.deletedAt === undefined)) {
        await ensureDossier(ctx, { leadId });
      }
    }

    return {
      leadId, created, statusChanged, historyAppended,
      ...(mapped.sideEffect !== undefined ? { sideEffect: mapped.sideEffect } : {}),
    };
  },
});

const leadDataValidator = v.object({
  firstName: v.optional(v.string()), lastName: v.optional(v.string()),
  email: v.optional(v.string()), phone: v.optional(v.string()),
  addressLine: v.optional(v.string()), city: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  utmSource: v.optional(v.string()), utmMedium: v.optional(v.string()),
  utmCampaign: v.optional(v.string()), campaign: v.optional(v.string()),
  adset: v.optional(v.string()), ad: v.optional(v.string()),
  canalAcquisition: v.optional(v.string()), campaignId: v.optional(v.string()),
  adsetId: v.optional(v.string()), adId: v.optional(v.string()),
  attributionMedium: v.optional(v.string()),
  attributionSessionSource: v.optional(v.string()),
});

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Création lead depuis contact.created. Dédup par externalId : lead existant
 * → aucune écriture (parité du TODO reclassify NestJS non résolu). La
 * sourceMap est chargée DANS la transaction (cohérence classification).
 */
export const createLeadFromWebhook = internalMutation({
  args: {
    externalId: v.optional(v.string()),
    data: leadDataValidator,
    signals: v.object({
      fbclid: v.optional(v.string()), gclid: v.optional(v.string()),
      utmSource: v.optional(v.string()), medium: v.optional(v.string()),
      sessionSource: v.optional(v.string()), canalAcquisition: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    if (args.externalId !== undefined) {
      const externalId = args.externalId;
      const candidates = await ctx.db
        .query("leads")
        .withIndex("by_externalId", (q) => q.eq("externalId", externalId))
        .collect();
      const existing = candidates.find((l) => l.source === "ghl");
      if (existing) return { leadId: existing._id, duplicate: true };
    }

    const rows = await ctx.db.query("acquisitionSourceMap").collect();
    const sourceMap = new Map(rows.map((r) => [r.rawSource, r.channel as string]));
    const channel = deriveAcquisitionChannel(args.signals, sourceMap);

    const leadId = await ctx.db.insert("leads", {
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
      source: "ghl",
      status: "nouveau",
      ...stripUndefined(args.data),
      acquisitionChannel: channel,
    });
    return { leadId, duplicate: false };
  },
});
