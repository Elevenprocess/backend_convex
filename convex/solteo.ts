/**
 * ELE-179 — Récepteur Soltéo → GHL (et plus tard Velora).
 *
 * - POST /webhooks/solteo (http.ts) : secret fail-closed, enregistrement +
 *   dédoublonnage, réponse 200 immédiate, traitement planifié.
 * - Toujours relire GET /projects/{id}/details (le webhook n'est pas signé).
 * - Cron de rattrapage 20 min : projets Soltéo mis à jour depuis le curseur.
 * - quote_signed : montant TTC sur l'opportunité GHL PUIS étape
 *   « 11. Devis Signé » ; garde-fou montant > 0.
 * - TOUTES les écritures GHL sont derrière SOLTEO_GHL_WRITE_ENABLED === "true"
 *   (OFF par défaut) : sinon le plan est seulement journalisé (status logged).
 * - Écarts (opp introuvable, montant ≤ 0, erreur) → syncDiscrepancies.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ghlRequest, isGhlConfigured, requireGhlLocationId } from "./ghlClient";
import { isSolteoConfigured, solteoGet } from "./solteoClient";
import { solteoEventNeedsProjectRead } from "./model/solteo/webhook";
import {
  buildGhlPlan, findSignedStage, pickSignedOffer,
  type GhlOpp, type GhlPipelines, type SolteoProjectDetails,
} from "./model/solteo/signedQuote";
import { recordDiscrepancy } from "./model/syncDiscrepancies";

export function solteoGhlWritesEnabled(): boolean {
  return process.env.SOLTEO_GHL_WRITE_ENABLED === "true";
}

const CURSOR = "solteo_projects_updatedAt";
const INITIAL_WINDOW_MS = 48 * 60 * 60 * 1000;
const TERMINAL = new Set(["stage_set", "already_ok"]);
const signedStatus = v.union(
  v.literal("logged"), v.literal("amount_set"), v.literal("stage_set"),
  v.literal("already_ok"), v.literal("skipped"), v.literal("error"),
);

// ─── File d'événements ──────────────────────────────────────────────────────

export const recordEvent = internalMutation({
  args: {
    dedupeKey: v.string(),
    eventType: v.string(),
    projectId: v.optional(v.string()),
    quoteId: v.optional(v.string()),
    payload: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ eventId: Id<"solteoEvents">; duplicate: boolean }> => {
    const dup = await ctx.db
      .query("solteoEvents")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first();
    if (dup) return { eventId: dup._id, duplicate: true };
    const { now, ...rest } = args;
    const eventId = await ctx.db.insert("solteoEvents", { ...rest, status: "queued", receivedAt: now });
    await ctx.scheduler.runAfter(0, internal.solteo.processEvent, { eventId });
    return { eventId, duplicate: false };
  },
});

export const getEvent = internalQuery({
  args: { eventId: v.id("solteoEvents") },
  handler: async (ctx, args): Promise<Doc<"solteoEvents"> | null> => ctx.db.get(args.eventId),
});

export const markEvent = internalMutation({
  args: {
    eventId: v.id("solteoEvents"),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: args.status,
      processedAt: Date.now(),
      ...(args.error !== undefined ? { error: args.error.slice(0, 2000) } : {}),
    });
    return null;
  },
});

export const processEvent = internalAction({
  args: { eventId: v.id("solteoEvents") },
  handler: async (ctx, args): Promise<null> => {
    const ev = await ctx.runQuery(internal.solteo.getEvent, { eventId: args.eventId });
    if (!ev || ev.status !== "queued") return null;
    if (!solteoEventNeedsProjectRead(ev.eventType) || !ev.projectId) {
      await ctx.runMutation(internal.solteo.markEvent, { eventId: args.eventId, status: "ignored" });
      return null;
    }
    try {
      await handleProject(ctx, ev.projectId, ev.quoteId ?? undefined);
      await ctx.runMutation(internal.solteo.markEvent, { eventId: args.eventId, status: "processed" });
    } catch (e) {
      await ctx.runMutation(internal.solteo.markEvent, {
        eventId: args.eventId, status: "failed", error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  },
});

// ─── Suivi des devis signés ─────────────────────────────────────────────────

export const getSignedQuote = internalQuery({
  args: { quoteId: v.string() },
  handler: async (ctx, args): Promise<Doc<"solteoSignedQuotes"> | null> =>
    ctx.db.query("solteoSignedQuotes").withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId)).first(),
});

export const upsertSignedQuote = internalMutation({
  args: {
    quoteId: v.string(),
    projectId: v.string(),
    totalPriceTtc: v.optional(v.number()),
    signedAt: v.optional(v.string()),
    ghlOpportunityId: v.optional(v.string()),
    ghlContactId: v.optional(v.string()),
    status: signedStatus,
    plan: v.string(),
    reason: v.optional(v.string()),
    discrepancy: v.optional(v.object({ kind: v.string(), details: v.string() })),
  },
  handler: async (ctx, args) => {
    const { discrepancy, ...row } = args;
    const now = Date.now();
    const existing = await ctx.db
      .query("solteoSignedQuotes")
      .withIndex("by_quoteId", (q) => q.eq("quoteId", args.quoteId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { ...row, updatedAt: now });
    else await ctx.db.insert("solteoSignedQuotes", { ...row, updatedAt: now });
    if (discrepancy) {
      await recordDiscrepancy(ctx, {
        key: `solteo:${discrepancy.kind}:${args.quoteId}`,
        source: "solteo",
        kind: discrepancy.kind,
        entityRef: `project=${args.projectId} quote=${args.quoteId}`,
        details: discrepancy.details,
        now,
      });
    }
    return null;
  },
});

export const listRetryable = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ projectId: string; quoteId: string }>> => {
    const out: Array<{ projectId: string; quoteId: string }> = [];
    for (const status of ["logged", "amount_set", "error"] as const) {
      const rows = await ctx.db
        .query("solteoSignedQuotes")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(20);
      for (const r of rows) out.push({ projectId: r.projectId, quoteId: r.quoteId });
    }
    return out.slice(0, 20);
  },
});

// ─── Curseur de rattrapage ──────────────────────────────────────────────────

export const getCursor = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<number | null> => {
    const row = await ctx.db.query("syncCursors").withIndex("by_name", (q) => q.eq("name", args.name)).first();
    return row ? row.value : null;
  },
});

export const setCursor = internalMutation({
  args: { name: v.string(), value: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("syncCursors").withIndex("by_name", (q) => q.eq("name", args.name)).first();
    if (row) await ctx.db.patch(row._id, { value: args.value });
    else await ctx.db.insert("syncCursors", args);
    return null;
  },
});

// ─── Lecture GHL ────────────────────────────────────────────────────────────

async function resolveOpportunity(
  details: SolteoProjectDetails,
  pipelineId: string | undefined,
): Promise<{ opp: GhlOpp | null; contactId?: string; note?: string }> {
  const oppId = details.externalId ?? undefined;
  const contactId = details.client?.externalId ?? undefined;
  if (oppId) {
    try {
      const r = (await ghlRequest(`/opportunities/${encodeURIComponent(oppId)}`)) as { opportunity?: GhlOpp } | null;
      if (r?.opportunity?.id) return { opp: r.opportunity, ...(contactId ? { contactId } : {}) };
    } catch {
      /* repli sur le contact */
    }
  }
  if (!contactId) return { opp: null, note: "ni project.externalId ni client.externalId exploitable" };
  const search = (await ghlRequest("/opportunities/search", {
    query: { location_id: requireGhlLocationId(), contact_id: contactId, pipeline_id: pipelineId, status: "all", limit: 20 },
  })) as { opportunities?: GhlOpp[] } | null;
  const opps = (search?.opportunities ?? []).filter((o) => !pipelineId || o.pipelineId === pipelineId);
  if (opps.length === 1) return { opp: opps[0]!, contactId };
  return { opp: null, contactId, note: `${opps.length} opportunité(s) CRM Vente pour le contact ${contactId}` };
}

// ─── Cœur : un projet Soltéo ────────────────────────────────────────────────

export async function handleProject(ctx: ActionCtx, projectId: string, quoteId?: string): Promise<string> {
  const details = (await solteoGet(`/projects/${encodeURIComponent(projectId)}/details`)) as SolteoProjectDetails | null;
  if (!details?.id) return "project_not_found";
  const company = process.env.SOLTEO_COMPANY_ID;
  if (company && details.companyId && details.companyId !== company) return "foreign_company";
  const offer = pickSignedOffer(details, quoteId);
  if (!offer) return "no_signed_offer";

  const prev = await ctx.runQuery(internal.solteo.getSignedQuote, { quoteId: offer.id });
  if (prev && TERMINAL.has(prev.status)) return prev.status;

  const base = {
    quoteId: offer.id,
    projectId: details.id,
    ...(typeof offer.totalPrice === "number" ? { totalPriceTtc: offer.totalPrice } : {}),
    ...(offer.signedAt ? { signedAt: offer.signedAt } : {}),
  };

  if (!isGhlConfigured()) {
    await ctx.runMutation(internal.solteo.upsertSignedQuote, {
      ...base, status: "skipped", plan: "[]", reason: "ghl_not_configured",
    });
    return "skipped";
  }

  const pipelines = (await ghlRequest("/opportunities/pipelines", {
    query: { locationId: requireGhlLocationId() },
  })) as { pipelines?: GhlPipelines } | null;
  const target = findSignedStage(pipelines?.pipelines ?? []);
  const { opp, contactId, note } = await resolveOpportunity(details, target?.pipelineId);
  const plan = buildGhlPlan({ totalPriceTtc: offer.totalPrice, opp, target });
  const ids = {
    ...(opp?.id ? { ghlOpportunityId: opp.id } : {}),
    ...(contactId ? { ghlContactId: contactId } : {}),
  };

  if (!plan.ok) {
    await ctx.runMutation(internal.solteo.upsertSignedQuote, {
      ...base, ...ids, status: "skipped", plan: "[]", reason: plan.reason,
      discrepancy: { kind: plan.reason, details: [note, ...plan.notes].filter(Boolean).join(" ; ") || plan.reason },
    });
    return "skipped";
  }
  const planJson = JSON.stringify(plan.steps);
  const mismatch = plan.notes.length > 0 ? { kind: "amount_mismatch", details: plan.notes.join(" ; ") } : undefined;
  if (plan.steps.length === 0) {
    await ctx.runMutation(internal.solteo.upsertSignedQuote, { ...base, ...ids, status: "already_ok", plan: planJson });
    return "already_ok";
  }
  if (!solteoGhlWritesEnabled()) {
    await ctx.runMutation(internal.solteo.upsertSignedQuote, {
      ...base, ...ids, status: "logged", plan: planJson, reason: "SOLTEO_GHL_WRITE_ENABLED off",
      ...(mismatch ? { discrepancy: mismatch } : {}),
    });
    return "logged";
  }

  // Écritures réelles, dans l'ordre imposé : montant PUIS étape.
  try {
    for (const step of plan.steps) {
      if (step.op === "set_amount") {
        await ghlRequest(`/opportunities/${encodeURIComponent(step.opportunityId)}`, {
          method: "PUT", body: { monetaryValue: step.monetaryValue },
        });
        await ctx.runMutation(internal.solteo.upsertSignedQuote, { ...base, ...ids, status: "amount_set", plan: planJson });
      } else {
        await ghlRequest(`/opportunities/${encodeURIComponent(step.opportunityId)}`, {
          method: "PUT", body: { pipelineId: step.pipelineId, pipelineStageId: step.pipelineStageId },
        });
      }
    }
    await ctx.runMutation(internal.solteo.upsertSignedQuote, {
      ...base, ...ids, status: "stage_set", plan: planJson, ...(mismatch ? { discrepancy: mismatch } : {}),
    });
    return "stage_set";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.runMutation(internal.solteo.upsertSignedQuote, {
      ...base, ...ids, status: "error", plan: planJson, reason: msg.slice(0, 500),
      discrepancy: { kind: "ghl_write_error", details: msg },
    });
    return "error";
  }
}

// ─── Rattrapage (cron 20 min) ───────────────────────────────────────────────

type SolteoProjectListItem = { id: string; updatedAt?: string | null };

export const catchUpScheduled = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scanned: number; handled: number } | null> => {
    if (!isSolteoConfigured()) return null;
    const now = Date.now();
    const cursor = (await ctx.runQuery(internal.solteo.getCursor, { name: CURSOR })) ?? now - INITIAL_WINDOW_MS;
    let maxSeen = cursor;
    let scanned = 0;
    let handled = 0;
    // Ordre de tri de /external/v1/projects non garanti par la spec : on
    // balaie au plus 5 pages de 100 sans arrêt anticipé.
    for (let page = 1; page <= 5; page++) {
      const res = (await solteoGet("/external/v1/projects", { page, perPage: 100 })) as
        { items?: SolteoProjectListItem[]; pages?: number } | null;
      const items = res?.items ?? [];
      for (const it of items) {
        scanned++;
        const ts = Date.parse(it.updatedAt ?? "");
        if (!Number.isFinite(ts) || ts <= cursor) continue;
        if (ts > maxSeen) maxSeen = ts;
        try { await handleProject(ctx, it.id); handled++; } catch (e) {
          console.warn(`solteo catch-up ${it.id} : ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!res?.pages || page >= res.pages) break;
    }
    if (solteoGhlWritesEnabled()) {
      const retry = await ctx.runQuery(internal.solteo.listRetryable, {});
      for (const r of retry) {
        try { await handleProject(ctx, r.projectId, r.quoteId); } catch { /* journalisé au prochain passage */ }
      }
    }
    await ctx.runMutation(internal.solteo.setCursor, { name: CURSOR, value: maxSeen });
    return { scanned, handled };
  },
});
