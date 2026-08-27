/**
 * Retour aux setters — polling GHL (retour terrain commerciaux 2026-08-27).
 * Les commerciaux déplacent dans GHL les leads sans suite vers l'étape
 * « (BIS) Retour aux Setters 🔙 ». Le webhook opportunité GHL n'étant pas
 * branché en pratique (3 événements reçus sur 2 000), ce cron interroge
 * l'étape toutes les 15 min et rejoue applyGhlStageChange (même chemin que le
 * webhook : statut pas_de_reponse, marqueur retourSetters, notif, journal)
 * pour les entrées RÉCENTES uniquement — l'étape contient un stock ancien
 * (≈280 opportunités, souvent abandonnées) qu'on ne doit pas réveiller.
 * Idempotent : dédup par l'historique d'étapes (lead, stage, lastStageChangeAt).
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ghlRequest, isGhlConfigured, requireGhlLocationId } from "./ghlClient";
import { RETOUR_SETTERS_STAGE } from "./model/ghl/stageMapper";
import {
  DEFAULT_RETOUR_WINDOW_MS, pickRetourCandidates, type GhlOpportunityRow, type RetourCandidate,
} from "./model/ghl/retourSetters";
import { findLeadByGhlContact } from "./webhooks";

// Pipeline « 1. CRM Vente 📊 » / étape « (BIS) Retour aux Setters 🔙 »
// (location djBlEHfSx8UmYXjUqhCS) — surchargeables par env si GHL change.
const DEFAULT_PIPELINE_ID = "pw8ROH6ho0I4QhYZgbmV";
const DEFAULT_STAGE_ID = "bd935d46-a091-40a2-a728-4b53be5abb53";
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

export const alreadyApplied = internalQuery({
  args: { contactId: v.string(), occurredAt: v.number() },
  handler: async (ctx, args) => {
    const lead = await findLeadByGhlContact(ctx, args.contactId);
    if (!lead) return false;
    const dup = await ctx.db
      .query("leadStageHistory")
      .withIndex("by_lead_stage_changedAt", (q) =>
        q.eq("leadId", lead._id).eq("ghlStageName", RETOUR_SETTERS_STAGE).eq("changedAt", args.occurredAt),
      )
      .first();
    return dup !== null;
  },
});

async function fetchStageOpportunities(): Promise<GhlOpportunityRow[]> {
  const locationId = requireGhlLocationId();
  const pipelineId = process.env.GHL_RETOUR_SETTERS_PIPELINE_ID || DEFAULT_PIPELINE_ID;
  const stageId = process.env.GHL_RETOUR_SETTERS_STAGE_ID || DEFAULT_STAGE_ID;
  const rows: GhlOpportunityRow[] = [];
  let startAfter: string | number | undefined;
  let startAfterId: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await ghlRequest("/opportunities/search", {
      query: {
        location_id: locationId, pipeline_id: pipelineId, pipeline_stage_id: stageId,
        limit: PAGE_LIMIT, startAfter, startAfterId,
      },
    })) as { opportunities?: GhlOpportunityRow[]; meta?: { startAfter?: number; startAfterId?: string; nextPage?: number | null } } | null;
    const batch = res?.opportunities ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_LIMIT || !res?.meta?.nextPage || !res.meta.startAfterId) break;
    startAfter = res.meta.startAfter;
    startAfterId = res.meta.startAfterId;
  }
  return rows;
}

export type RetourSyncResult = {
  fetched: number; candidates: number; applied: number; skipped: number;
  leads: Array<{ contactId: string; leadId?: string; created?: boolean }>;
};

/** Passage manuel : `npx convex run ghlRetourSetters:sync '{"dryRun":true}'`. */
export const sync = internalAction({
  args: { windowMs: v.optional(v.number()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<RetourSyncResult | null> => {
    if (!isGhlConfigured()) return null;
    const now = Date.now();
    const rows = await fetchStageOpportunities();
    const candidates: RetourCandidate[] = pickRetourCandidates(rows, now, args.windowMs ?? DEFAULT_RETOUR_WINDOW_MS);
    const result: RetourSyncResult = { fetched: rows.length, candidates: candidates.length, applied: 0, skipped: 0, leads: [] };
    for (const c of candidates) {
      const done: boolean = await ctx.runQuery(internal.ghlRetourSetters.alreadyApplied, {
        contactId: c.contactId, occurredAt: c.occurredAt,
      });
      if (done) { result.skipped++; continue; }
      if (args.dryRun) { result.leads.push({ contactId: c.contactId }); result.applied++; continue; }
      const r: { leadId: string; created: boolean } = await ctx.runMutation(internal.webhooks.applyGhlStageChange, {
        externalId: c.contactId,
        ghlStageName: RETOUR_SETTERS_STAGE,
        occurredAt: c.occurredAt,
        contactSeed: c.contactSeed,
        ...(c.ghlPipelineId !== undefined ? { ghlPipelineId: c.ghlPipelineId } : {}),
        ...(c.monetaryValue !== undefined ? { monetaryValue: c.monetaryValue } : {}),
        ...(c.ghlAssignedUserId !== undefined ? { ghlAssignedUserId: c.ghlAssignedUserId } : {}),
      });
      result.applied++;
      result.leads.push({ contactId: c.contactId, leadId: r.leadId, created: r.created });
    }
    if (result.applied > 0 || result.candidates > 0) {
      console.log(`Retour aux setters GHL : ${result.fetched} opp. dans l'étape, ${result.candidates} récentes, ${result.applied} appliquées, ${result.skipped} déjà traitées${args.dryRun ? " (dry-run)" : ""}`);
    }
    return result;
  },
});

// Cron 15 min. No-op tant que GHL_SYNC_ENABLED !== "true".
export const syncScheduled = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    if (process.env.GHL_SYNC_ENABLED !== "true" || !isGhlConfigured()) return null;
    try {
      await ctx.runAction(internal.ghlRetourSetters.sync, {});
    } catch (error) {
      console.warn(`Retour aux setters GHL échoué : ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  },
});
