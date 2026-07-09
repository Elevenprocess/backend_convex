/**
 * Lien débrief GHL (flux sortant) — Tranche 8c-1. Pousse le token magique dans
 * le champ contact `lien_debrief` (backfill cron 2 min) et le statut du RDV
 * après débrief. DÉBRANCHÉ tant que GHL_SYNC_ENABLED !== "true".
 */
import { v } from "convex/values";
import { action, internalAction, internalQuery, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ghlRequest, isGhlConfigured } from "./ghlClient";
import { signDebriefToken } from "./model/debriefLinkToken";

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

/**
 * Résout le RDV à débriefer pour une demande entrante GHL (webhook workflow).
 * Priorité : appointmentExternalId (id du RDV GHL, le plus précis) puis
 * contactExternalId (dernier RDV non débriefé du lead, sinon le plus récent).
 * Retourne aussi le contactExternalId (payload ou lead) pour la mise à jour
 * du champ contact `lien_debrief`.
 */
export const resolveRdvForDebriefRequest = internalQuery({
  args: {
    contactExternalId: v.optional(v.string()),
    appointmentExternalId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ rdvId: string; contactExternalId: string | null } | null> => {
    // 1. Par id de rendez-vous GHL.
    if (args.appointmentExternalId) {
      const rdv = await ctx.db
        .query("rdv")
        .withIndex("by_externalId", (q) => q.eq("externalId", args.appointmentExternalId))
        .first();
      if (rdv && rdv.deletedAt === undefined) {
        const lead = await ctx.db.get(rdv.leadId);
        return {
          rdvId: rdv._id,
          contactExternalId: args.contactExternalId ?? lead?.externalId ?? null,
        };
      }
    }

    // 2. Par contact GHL : dernier RDV du lead, non débriefé de préférence.
    if (args.contactExternalId) {
      const lead = await ctx.db
        .query("leads")
        .withIndex("by_externalId", (q) => q.eq("externalId", args.contactExternalId))
        .first();
      if (!lead || lead.deletedAt !== undefined) return null;
      const rows = (
        await ctx.db
          .query("rdv")
          .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
          .collect()
      ).filter((r) => r.deletedAt === undefined);
      if (rows.length === 0) return null;
      const byRecency = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
        (b.scheduledAt ?? b._creationTime) - (a.scheduledAt ?? a._creationTime);
      const pending = rows.filter((r) => r.debriefFilledAt === undefined).sort(byRecency);
      const chosen = pending[0] ?? rows.sort(byRecency)[0];
      return { rdvId: chosen._id, contactExternalId: args.contactExternalId };
    }

    return null;
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

// ─── Actions push (débranché tant que GHL_SYNC_ENABLED !== "true") ────────────

const GHL_MUTATION_RETRY_DELAYS_MS = [0, 1_500, 5_000];
const BACKFILL_PAST_MS = 6 * 60 * 60 * 1000;
const BACKFILL_AHEAD_MS = 45 * 24 * 60 * 60 * 1000;
const BACKFILL_LIMIT = 20;
const BACKFILL_SLEEP_MS = 750;

function debriefSecret(): string {
  return process.env.DEBRIEF_LINK_SECRET || process.env.BETTER_AUTH_SECRET || "";
}

function debriefFieldId(): string {
  return process.env.GHL_DEBRIEF_FIELD_ID || "hUV6MslrIoW3arEecq0U";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Écrit le token permanent dans le champ contact `lien_debrief`. Best-effort :
// retry uniquement sur 429, autre erreur → false (n'interrompt jamais la sync).
export const setContactDebriefLink = action({
  args: { contactExternalId: v.string(), rdvId: v.string() },
  handler: async (_ctx, args) => {
    if (!args.contactExternalId || !isGhlConfigured()) return false;
    const secret = debriefSecret();
    if (!secret) return false;
    const token = await signDebriefToken(args.rdvId, secret);
    for (const [idx, delayMs] of GHL_MUTATION_RETRY_DELAYS_MS.entries()) {
      if (delayMs > 0) await sleep(delayMs);
      try {
        await ghlRequest(`/contacts/${encodeURIComponent(args.contactExternalId)}`, {
          method: "PUT",
          body: { customFields: [{ id: debriefFieldId(), value: token }] },
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const retryable = /Too Many Requests|429/i.test(msg) && idx < GHL_MUTATION_RETRY_DELAYS_MS.length - 1;
        if (retryable) continue;
        console.warn(`setContactDebriefLink échec (contact ${args.contactExternalId}) : ${msg}`);
        return false;
      }
    }
    return false;
  },
});

// Backfill 2 min : pousse le lien pour les RDV à venir dont il n'a pas encore
// été poussé (debriefDueAt vide). DÉBRANCHÉ tant que GHL_SYNC_ENABLED !== "true".
export const syncDebriefLinksScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    if (process.env.GHL_SYNC_ENABLED !== "true" || !isGhlConfigured()) return null;
    const now = Date.now();
    try {
      const rows = await ctx.runQuery(internal.ghlDebriefLink.dueRdvForBackfill, {
        fromMs: now - BACKFILL_PAST_MS,
        toMs: now + BACKFILL_AHEAD_MS,
        limit: BACKFILL_LIMIT,
      });
      let pushed = 0;
      for (const row of rows) {
        const ok = await ctx.runAction(api.ghlDebriefLink.setContactDebriefLink, {
          contactExternalId: row.contactExternalId,
          rdvId: row.rdvId,
        });
        if (ok) {
          pushed++;
          await ctx.runMutation(internal.ghlDebriefLink.markDebriefDuePushed, { rdvId: row.rdvId, now: Date.now() });
        }
        await sleep(BACKFILL_SLEEP_MS);
      }
      if (rows.length > 0) console.log(`Backfill liens débrief GHL : ${pushed}/${rows.length} contact(s) mis à jour`);
    } catch (error) {
      console.warn(`Backfill liens débrief GHL échoué : ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  },
});

// Push du statut de rendez-vous GHL après débrief. Planifié par
// debriefs.submitViaLink. Best-effort.
export const pushRdvDebriefScheduled = internalAction({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    if (!isGhlConfigured()) return null;
    try {
      const r = await ctx.runQuery(internal.ghlDebriefLink.rdvForDebriefPush, { rdvId: args.rdvId });
      if (!r || !r.externalId) return null;
      const appointmentStatus = mapRdvResultToGhlAppointmentStatus(r.result, r.status);
      if (!appointmentStatus) return null;
      await ghlRequest(`/calendars/events/appointments/${encodeURIComponent(r.externalId)}`, {
        method: "PUT",
        body: { appointmentStatus },
      });
      console.log(`GHL appointment ${r.externalId} → ${appointmentStatus} (rdv ${args.rdvId})`);
    } catch (error) {
      console.warn(`GHL debrief push échoué (rdv ${args.rdvId}) : ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  },
});
