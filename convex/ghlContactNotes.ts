/**
 * Lecture des notes/remarques de la fiche contact GHL → miroir local
 * `ghlContactNotes` (retour terrain 30/08 : « les commerciaux remplissent les
 * remarques dans GHL, les setters ont besoin de les voir dans Velora »).
 *
 * Déclencheurs :
 *  - retour aux setters (webhooks.applyGhlStageChange, étape « (BIS) Retour
 *    aux Setters ») → `pull` planifié aussitôt ;
 *  - ouverture de la fiche prospect → action `refresh` (throttlée : au plus
 *    une lecture GHL toutes les REFRESH_MIN_INTERVAL_MS par lead).
 * Best-effort : jamais bloquant. Les notes poussées par Velora elle-même
 * (miroir des débriefs) sont exclues pour ne pas doubler les débriefs.
 */
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ghlRequest, isGhlConfigured } from "./ghlClient";
import { requireUser } from "./model/access";
import { excludeMirroredNotes, parseGhlNotes } from "./model/ghl/contactNotes";

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}/;
export const REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

function ghlContactOf(lead: Doc<"leads">): string | null {
  const id = lead.ghlContactId ?? lead.externalId;
  if (!id || UUID_PREFIX.test(id)) return null;
  return id;
}

export const contactRef = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    const contactId = ghlContactOf(lead);
    if (!contactId) return null;
    const debriefs = await ctx.db
      .query("debriefs")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    const mirroredIds = debriefs.map((d) => d.ghlNoteId).filter((x): x is string => typeof x === "string");
    return { contactId, mirroredIds, syncedAt: lead.ghlNotesSyncedAt ?? null };
  },
});

export const upsertForLead = internalMutation({
  args: {
    leadId: v.id("leads"),
    now: v.number(),
    notes: v.array(
      v.object({
        id: v.string(),
        body: v.string(),
        ghlUserId: v.optional(v.string()),
        dateAdded: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ghlContactNotes")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    const byGhlId = new Map(existing.map((n) => [n.ghlNoteId, n]));
    const authorCache = new Map<string, string | undefined>();
    const authorOf = async (ghlUserId: string | undefined) => {
      if (!ghlUserId) return undefined;
      if (authorCache.has(ghlUserId)) return authorCache.get(ghlUserId);
      const u = await ctx.db
        .query("users")
        .withIndex("by_ghlUserId", (q) => q.eq("ghlUserId", ghlUserId))
        .first();
      authorCache.set(ghlUserId, u?.name);
      return u?.name;
    };
    let inserted = 0, updated = 0, removed = 0;
    const keep = new Set<string>();
    for (const n of args.notes) {
      keep.add(n.id);
      const authorName = await authorOf(n.ghlUserId);
      const prev = byGhlId.get(n.id);
      if (!prev) {
        await ctx.db.insert("ghlContactNotes", {
          leadId: args.leadId, ghlNoteId: n.id, body: n.body, dateAdded: n.dateAdded, syncedAt: args.now,
          ...(n.ghlUserId ? { ghlUserId: n.ghlUserId } : {}),
          ...(authorName ? { authorName } : {}),
        });
        inserted++;
      } else if (prev.body !== n.body || prev.dateAdded !== n.dateAdded || (authorName && prev.authorName !== authorName)) {
        await ctx.db.patch(prev._id, {
          body: n.body, dateAdded: n.dateAdded, syncedAt: args.now,
          ...(n.ghlUserId ? { ghlUserId: n.ghlUserId } : {}),
          ...(authorName ? { authorName } : {}),
        });
        updated++;
      }
    }
    // Note supprimée côté GHL → on la retire aussi (miroir fidèle).
    for (const prev of existing) {
      if (!keep.has(prev.ghlNoteId)) { await ctx.db.delete(prev._id); removed++; }
    }
    await ctx.db.patch(args.leadId, { ghlNotesSyncedAt: args.now });
    return { inserted, updated, removed, total: args.notes.length };
  },
});

async function pullNotes(
  ctx: { runQuery: any; runMutation: any },
  leadId: Id<"leads">,
): Promise<{ ok: boolean; total?: number; inserted?: number; reason?: string }> {
  if (!isGhlConfigured()) return { ok: false, reason: "ghl_not_configured" };
  const ref = await ctx.runQuery(internal.ghlContactNotes.contactRef, { leadId });
  if (!ref) return { ok: false, reason: "no_ghl_contact" };
  try {
    const raw = await ghlRequest(`/contacts/${encodeURIComponent(ref.contactId)}/notes`, { method: "GET" });
    const now = Date.now();
    const notes = excludeMirroredNotes(parseGhlNotes(raw, now), ref.mirroredIds);
    const r = await ctx.runMutation(internal.ghlContactNotes.upsertForLead, {
      leadId, now,
      notes: notes.map((n) => ({ id: n.id, body: n.body, dateAdded: n.dateAdded, ...(n.ghlUserId ? { ghlUserId: n.ghlUserId } : {}) })),
    });
    if (r.inserted || r.updated || r.removed) {
      console.log(`Notes GHL lead ${leadId} (contact ${ref.contactId}) : ${r.total} notes, +${r.inserted} ~${r.updated} -${r.removed}`);
    }
    return { ok: true, total: r.total, inserted: r.inserted };
  } catch (err) {
    console.warn(`Lecture notes GHL échouée (lead ${leadId}, contact ${ref.contactId}) : ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: "ghl_error" };
  }
}

/** Planifié par le retour aux setters (et utilisable en backfill ciblé). */
export const pull = internalAction({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => pullNotes(ctx, args.leadId),
});

export const canRefresh = internalQuery({
  args: { leadId: v.id("leads"), now: v.number(), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined || !ghlContactOf(lead)) return { allowed: false as const, reason: "no_ghl_contact" };
    const last = lead.ghlNotesSyncedAt ?? 0;
    if (!args.force && args.now - last < REFRESH_MIN_INTERVAL_MS) return { allowed: false as const, reason: "recent" };
    return { allowed: true as const };
  },
});

/** Fiche prospect : rafraîchir les remarques GHL (auto à l'ouverture, ou bouton). */
export const refresh = action({
  args: { leadId: v.id("leads"), force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ ok: boolean; total?: number; inserted?: number; reason?: string }> => {
    const gate = await ctx.runQuery(internal.ghlContactNotes.canRefresh, { leadId: args.leadId, now: Date.now(), force: args.force });
    if (!gate.allowed) return { ok: false, reason: gate.reason };
    return await pullNotes(ctx, args.leadId);
  },
});

/** Fiche prospect : notes GHL du lead, plus récentes en premier. */
export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    const rows = await ctx.db
      .query("ghlContactNotes")
      .withIndex("by_lead_dateAdded", (q) => q.eq("leadId", args.leadId))
      .order("desc")
      .collect();
    return {
      hasGhlContact: Boolean(lead && ghlContactOf(lead)),
      syncedAt: lead?.ghlNotesSyncedAt ?? null,
      notes: rows.map((n) => ({
        id: n._id, ghlNoteId: n.ghlNoteId, body: n.body, dateAdded: n.dateAdded,
        authorName: n.authorName ?? null, ghlUserId: n.ghlUserId ?? null,
      })),
    };
  },
});
