/**
 * Webhooks entrants GHL — audit trail + traitement (Tranche 8a).
 * Les http actions (convex/http.ts) orchestrent : record → traiter →
 * markProcessed/markFailed. Chaque étape est une mutation séparée pour que
 * l'event d'audit survive à l'échec du traitement (parité NestJS).
 */
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { webhookProviderValidator, leadStatusValidator } from "./model/enums";
import { mapGhlLeadPayload } from "./model/ghl/leadWebhook";
import { mapGhlStageToStatus } from "./model/ghl/stageMapper";
import { ensureDossier } from "./model/ensureDossier";
import { refreshLeadAgg } from "./model/leadAgg";
import { logSystemActivity, leadLabel, LEAD_STATUS_LABEL, label } from "./model/activity";
import { deriveAcquisitionChannel, isSiteWebUtm } from "./model/acquisitionChannel";
import { syncProjectFromLeadStatus } from "./model/ghl/projectSync";
import { notifyRetourSetters } from "./model/notify";

// Résolution d'un contact GHL vers son lead — les deux familles d'ids :
// lead natif Convex → l'id GHL est dans externalId (source "ghl") ;
// lead migré de Render → externalId = uuid Postgres, l'id GHL est dans
// ghlContactId (backfillé). Ne chercher que externalId recréait chaque client
// migré en doublon « nouveau » à chaque webhook le concernant.
export async function findLeadByGhlContact(
  ctx: QueryCtx,
  ghlContactId: string,
): Promise<Doc<"leads"> | null> {
  const byExternal = await ctx.db
    .query("leads")
    .withIndex("by_externalId", (q) => q.eq("externalId", ghlContactId))
    .collect();
  const native = byExternal.find((l) => l.source === "ghl");
  if (native) return native;
  return await ctx.db
    .query("leads")
    .withIndex("by_ghlContactId", (q) => q.eq("ghlContactId", ghlContactId))
    .first();
}

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

    // 2) Lookup lead existant (id GHL dans externalId OU ghlContactId — migré)
    const existing = await findLeadByGhlContact(ctx, input.externalId);

    let leadId: Id<"leads">;
    let created = false;
    let statusChanged = false;
    let retourApplied = false;
    let previousStatus: Doc<"leads">["status"] | undefined;

    if (!existing) {
      // Création minimale (opportunité arrivée avant contact.created).
      leadId = await ctx.db.insert("leads", {
        createdAt: Date.now(),
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
        ...(mapped.sideEffect === "retour_setters" ? { retourSetters: { at: input.occurredAt } } : {}),
        ...(input.silent ? { createdAt: input.occurredAt } : {}),
      });
      created = true;
      statusChanged = true;
      retourApplied = mapped.sideEffect === "retour_setters";
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
      // Retour aux setters : on mémorise d'où vient le lead (étape/statut GHL
      // avant le renvoi) — seulement sur un vrai passage dans l'étape, pas sur
      // un replay du même stage (sinon fromStage serait l'étape retour elle-même).
      if (
        mapped.sideEffect === "retour_setters" &&
        (existing.ghlStageName !== normalizedStage || existing.retourSetters === undefined)
      ) {
        patch.retourSetters = {
          at: input.occurredAt,
          ...(existing.ghlStageName && existing.ghlStageName !== normalizedStage
            ? { fromStage: existing.ghlStageName }
            : {}),
          fromStatus: existing.status,
        };
        retourApplied = true;
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
      await refreshLeadAgg(ctx, leadId);
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

    // 4b) Retour aux setters : prévenir le setter du lead (sinon les setter_lead)
    // pour qu'il sache que ce prospect revient en relance court terme.
    if (retourApplied && !input.silent) {
      const leadDoc = await ctx.db.get(leadId);
      if (leadDoc) {
        await notifyRetourSetters(ctx, {
          lead: leadDoc,
          fromStage: leadDoc.retourSetters?.fromStage,
        });
        // Remarques écrites par les commerciaux sur la fiche GHL → miroir local
        // pour que le setter les voie dans Velora (ghlContactNotes).
        await ctx.scheduler.runAfter(0, internal.ghlContactNotes.pull, { leadId });
      }
    }

    // 5) Journal d'activité (jamais en backfill silencieux : ce n'est pas une action).
    if (!input.silent && (created || statusChanged || retourApplied || mapped.sideEffect === "archived")) {
      const leadDoc = await ctx.db.get(leadId);
      const subject = leadLabel(leadDoc);
      const nextStatus = leadDoc?.status ?? mapped.status ?? "nouveau";
      let summary: string;
      let action: string;
      if (created) {
        action = "lead.created";
        summary = `Prospect ${subject} créé depuis GHL (étape « ${normalizedStage} »)`;
      } else if (retourApplied) {
        action = "lead.retour_setters";
        const from = leadDoc?.retourSetters?.fromStage;
        summary = `Prospect ${subject} renvoyé aux setters par les commerciaux${from ? ` (était « ${from} »)` : ""} — repassé « ${label(LEAD_STATUS_LABEL, nextStatus)} »`;
      } else if (mapped.sideEffect === "archived") {
        action = "lead.archived";
        summary = `Prospect ${subject} archivé depuis GHL (étape « ${normalizedStage} »)`;
      } else {
        action = "lead.status_changed";
        summary = `Prospect ${subject} passé de « ${label(LEAD_STATUS_LABEL, previousStatus)} » à « ${label(LEAD_STATUS_LABEL, nextStatus)} » (étape GHL « ${normalizedStage} »)`;
      }
      await logSystemActivity(ctx, {
        source: "GHL", onBehalfOf: assignedToId ?? null,
        action, entityType: "lead", entityId: leadId, leadId, subject, summary,
        details: {
          ghlStageName: normalizedStage, before: { status: previousStatus ?? null }, after: { status: nextStatus },
          monetaryValue: input.monetaryValue ?? null, lostReason: input.lostReason ?? null,
        },
        at: input.occurredAt,
      });
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
  utmCampaign: v.optional(v.string()), utmContent: v.optional(v.string()),
  campaign: v.optional(v.string()),
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
 * → pas de nouvelle fiche, mais on marque la re-soumission (resubmittedAt) —
 * un contact connu qui refait une simulation est un signal de recontact. S'il
 * était perdu/sans réponse, il repasse « à rappeler » pour retomber dans la
 * file des setters. La sourceMap est chargée DANS la transaction.
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
      const existing = await findLeadByGhlContact(ctx, args.externalId);
      if (existing) {
        const patch: { resubmittedAt: number; status?: "a_rappeler" } = {
          resubmittedAt: Date.now(),
        };
        if (existing.status === "perdu" || existing.status === "pas_de_reponse") {
          patch.status = "a_rappeler";
        }
        await ctx.db.patch(existing._id, patch);
        await logSystemActivity(ctx, {
          source: "GHL", action: "lead.resubmitted", entityType: "lead", entityId: existing._id,
          leadId: existing._id, subject: leadLabel(existing),
          summary: `Prospect ${leadLabel(existing)} a refait une simulation (re-soumission)${patch.status ? " — repassé « À rappeler »" : ""}`,
          details: { before: { status: existing.status }, after: { status: patch.status ?? existing.status } },
        });
        return { leadId: existing._id, duplicate: true };
      }
    }

    const rows = await ctx.db.query("acquisitionSourceMap").collect();
    const sourceMap = new Map(rows.map((r) => [r.rawSource, r.channel as string]));
    const channel = deriveAcquisitionChannel(args.signals, sourceMap);

    const leadId = await ctx.db.insert("leads", {
      createdAt: Date.now(),
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
      source: "ghl",
      status: "nouveau",
      ...stripUndefined(args.data),
      acquisitionChannel: channel,
    });
    {
      const created = await ctx.db.get(leadId);
      await logSystemActivity(ctx, {
        source: "GHL", action: "lead.created", entityType: "lead", entityId: leadId, leadId,
        subject: leadLabel(created),
        summary: `Nouveau prospect ${leadLabel(created)} reçu de GHL (canal ${channel}${args.data.canalAcquisition ? `, ${args.data.canalAcquisition}` : ""})`,
        details: { channel, canalAcquisition: args.data.canalAcquisition ?? null, utmSource: args.data.utmSource ?? null, campaign: args.data.campaign ?? null },
      });
    }
    return { leadId, duplicate: false };
  },
});

/**
 * Sync GHL → projets, appelé best-effort par la http action APRÈS
 * applyGhlStageChange (mutation séparée : son échec ne doit pas faire
 * échouer le webhook — parité NestJS .catch(warn)).
 */
export const syncProjectFromLead = internalMutation({
  args: { leadId: v.id("leads"), leadStatus: leadStatusValidator },
  handler: async (ctx, args) => {
    await syncProjectFromLeadStatus(ctx, args.leadId, args.leadStatus);
    return null;
  },
});

/**
 * Backfill : rejoue un lot de webhookEvents contact.created pour reclassifier
 * les leads restés en « other » (bug historique : l'attribution GHL imbriquée
 * sous contact.attributionSource n'était jamais lue → aucun signal → other).
 * Ne reclasse JAMAIS un lead déjà hors « other » ; pose aussi canalAcquisition
 * et l'attribution manquants pour le mapping admin. Piloté par
 * reclassifyFromEvents (batches par _creationTime).
 */
export const reclassifyBatch = internalMutation({
  args: { after: v.optional(v.number()), batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batch = args.batch ?? 50;
    const rows = await ctx.db.query("acquisitionSourceMap").collect();
    const sourceMap = new Map(rows.map((r) => [r.rawSource, r.channel as string]));

    const events = await ctx.db
      .query("webhookEvents")
      .filter((q) => q.gt(q.field("_creationTime"), args.after ?? 0))
      .order("asc")
      .take(batch);

    let patched = 0;
    let cursor = args.after ?? 0;
    for (const ev of events) {
      cursor = ev._creationTime;
      if (ev.eventType !== "contact.created") continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(ev.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const mapped = mapGhlLeadPayload(payload);
      if (mapped.externalId === undefined) continue;
      const lead = await findLeadByGhlContact(ctx, mapped.externalId);
      if (!lead || lead.deletedAt !== undefined) continue;

      const patch: Record<string, unknown> = {};
      if (lead.canalAcquisition === undefined && mapped.data.canalAcquisition !== undefined) {
        patch.canalAcquisition = mapped.data.canalAcquisition;
      }
      if (lead.attributionMedium === undefined && mapped.data.attributionMedium !== undefined) {
        patch.attributionMedium = mapped.data.attributionMedium;
      }
      if (lead.attributionSessionSource === undefined && mapped.data.attributionSessionSource !== undefined) {
        patch.attributionSessionSource = mapped.data.attributionSessionSource;
      }
      // Tracking pub : rattrape les champs UTM/campagne jamais posés (utmContent
      // notamment, capté seulement depuis le 2026-08-03). Ne remplit que les trous.
      for (const key of [
        "utmSource", "utmMedium", "utmCampaign", "utmContent",
        "campaign", "adset", "ad", "campaignId", "adsetId", "adId",
      ] as const) {
        if (lead[key] === undefined && mapped.data[key] !== undefined) {
          patch[key] = mapped.data[key];
        }
      }
      // Reclasse les « other » ET les leads site web comptés Meta à tort
      // (le mapping admin du workflow simulateur les rattachait à Meta avant
      // que l'utm_source « site web » ne soit pris en compte).
      if ((lead.acquisitionChannel ?? "other") === "other" || isSiteWebUtm(mapped.signals.utmSource)) {
        const channel = deriveAcquisitionChannel(mapped.signals, sourceMap);
        if (channel !== lead.acquisitionChannel) patch.acquisitionChannel = channel;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(lead._id, patch);
        patched += 1;
      }
    }
    return { scanned: events.length, patched, cursor, done: events.length < batch };
  },
});

/**
 * Backfill des re-soumissions : rejoue les contact.created stockés et marque
 * resubmittedAt sur les leads qui existaient déjà AVANT l'événement (> 1 h
 * d'écart = re-soumission, pas l'événement de création lui-même). Le passage
 * en « à rappeler » n'est appliqué qu'aux re-soumissions récentes
 * (recontactWindowMs, défaut 14 j) sur les statuts perdu/pas_de_reponse.
 */
export const resubmissionsBackfillBatch = internalMutation({
  args: {
    after: v.optional(v.number()),
    batch: v.optional(v.number()),
    now: v.number(),
    recontactWindowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = args.batch ?? 50;
    const recontactWindow = args.recontactWindowMs ?? 14 * 86_400_000;
    const events = await ctx.db
      .query("webhookEvents")
      .filter((q) => q.gt(q.field("_creationTime"), args.after ?? 0))
      .order("asc")
      .take(batch);

    let marked = 0;
    let recontact = 0;
    let cursor = args.after ?? 0;
    for (const ev of events) {
      cursor = ev._creationTime;
      if (ev.eventType !== "contact.created") continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(ev.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const mapped = mapGhlLeadPayload(payload);
      if (mapped.externalId === undefined) continue;
      const lead = await findLeadByGhlContact(ctx, mapped.externalId);
      if (!lead || lead.deletedAt !== undefined) continue;
      const leadCreatedAt = lead.createdAt ?? lead._creationTime;
      if (ev._creationTime - leadCreatedAt < 3_600_000) continue; // event de création

      const patch: { resubmittedAt?: number; status?: "a_rappeler" } = {};
      if ((lead.resubmittedAt ?? 0) < ev._creationTime) patch.resubmittedAt = ev._creationTime;
      if (
        args.now - ev._creationTime <= recontactWindow &&
        (lead.status === "perdu" || lead.status === "pas_de_reponse")
      ) {
        patch.status = "a_rappeler";
        recontact += 1;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(lead._id, patch);
        marked += 1;
      }
    }
    return { scanned: events.length, marked, recontact, cursor, done: events.length < batch };
  },
});

/** Boucle resubmissionsBackfillBatch jusqu'à épuisement des events. */
export const resubmissionsBackfill = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let after = 0;
    let scanned = 0;
    let marked = 0;
    let recontact = 0;
    for (;;) {
      const r: { scanned: number; marked: number; recontact: number; cursor: number; done: boolean } =
        await ctx.runMutation(internal.webhooks.resubmissionsBackfillBatch, { after, batch: 50, now });
      scanned += r.scanned;
      marked += r.marked;
      recontact += r.recontact;
      if (r.done) break;
      after = r.cursor;
    }
    console.log(`Re-soumissions : ${scanned} events, ${marked} leads marqués, ${recontact} repassés à rappeler`);
    return { scanned, marked, recontact };
  },
});

/** Backfill complet : boucle reclassifyBatch jusqu'à épuisement des events. */
export const reclassifyFromEvents = internalAction({
  args: {},
  handler: async (ctx) => {
    let after = 0;
    let scanned = 0;
    let patched = 0;
    for (;;) {
      const r: { scanned: number; patched: number; cursor: number; done: boolean } =
        await ctx.runMutation(internal.webhooks.reclassifyBatch, { after, batch: 50 });
      scanned += r.scanned;
      patched += r.patched;
      if (r.done) break;
      after = r.cursor;
    }
    console.log(`Reclassification : ${scanned} events scannés, ${patched} leads corrigés`);
    return { scanned, patched };
  },
});
