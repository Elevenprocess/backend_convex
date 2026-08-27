/**
 * Miroir des débriefs en notes contact GHL (retour terrain commerciaux
 * 2026-08-27 : « ajouter le débrief en note/remarque du prospect dans GHL »).
 * Planifié par debriefs.createForLead / create / submitViaLink / update.
 * Best-effort : jamais bloquant, une note par débrief (id GHL mémorisé →
 * mise à jour au lieu d'un doublon quand le débrief est modifié).
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ghlRequest, isGhlConfigured } from "./ghlClient";
import { buildDebriefNote } from "./model/ghl/debriefNote";

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}/;

export const noteData = internalQuery({
  args: { debriefId: v.id("debriefs") },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.debriefId);
    if (!d || d.deletedAt !== undefined) return null;
    let leadId = d.leadId;
    if (!leadId && d.projectId) leadId = (await ctx.db.get(d.projectId))?.leadId;
    if (!leadId) return null;
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    // Id contact GHL réel : ghlContactId (lignes migrées) sinon externalId
    // (leads créés par les webhooks Convex). Un uuid Postgres = lead migré
    // non backfillé → pas de contact GHL connu.
    const contactExternalId = lead.ghlContactId ?? lead.externalId;
    if (!contactExternalId || UUID_PREFIX.test(contactExternalId)) return null;

    const commercial = await ctx.db.get(d.commercialId);
    const rdv = d.rdvId ? await ctx.db.get(d.rdvId) : null;
    const body = buildDebriefNote({
      outcome: d.outcome,
      nonSaleReason: d.nonSaleReason,
      reflexionReason: d.reflexionReason,
      suiviReason: d.suiviReason,
      objection: d.objection,
      acceptanceFactors: d.acceptanceFactors,
      notes: d.notes,
      montantTotal: d.montantTotal,
      financingType: d.financingType,
      paymentSubMethod: d.paymentSubMethod,
      financingOrg: d.financingOrg,
      kits: d.kits,
      signedAt: d.signedAt,
      commercialName: commercial?.name ?? null,
      filledAt: d.createdAt ?? d._creationTime,
      rdvAt: rdv?.scheduledAt ?? null,
      updated: d.ghlNoteId !== undefined,
    });
    return {
      contactExternalId,
      body,
      ghlNoteId: d.ghlNoteId ?? null,
      // Note attribuée au commercial dans GHL quand son compte est mappé.
      ghlUserId: commercial?.ghlUserId ?? null,
    };
  },
});

export const markPushed = internalMutation({
  args: { debriefId: v.id("debriefs"), ghlNoteId: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.debriefId);
    if (!d) return null;
    await ctx.db.patch(args.debriefId, {
      ghlNotePushedAt: args.now,
      ...(args.ghlNoteId !== undefined ? { ghlNoteId: args.ghlNoteId } : {}),
    });
    return null;
  },
});

function extractNoteId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const note = (obj.note && typeof obj.note === "object" ? obj.note : obj) as Record<string, unknown>;
  return typeof note.id === "string" && note.id ? note.id : undefined;
}

export const pushDebriefNote = internalAction({
  args: { debriefId: v.id("debriefs") },
  handler: async (ctx, args): Promise<boolean> => {
    if (!isGhlConfigured()) return false;
    const data = await ctx.runQuery(internal.ghlContactNote.noteData, { debriefId: args.debriefId });
    if (!data) return false;
    const contact = encodeURIComponent(data.contactExternalId);
    const body = { body: data.body, ...(data.ghlUserId ? { userId: data.ghlUserId } : {}) };
    try {
      let raw: unknown;
      if (data.ghlNoteId) {
        try {
          raw = await ghlRequest(`/contacts/${contact}/notes/${encodeURIComponent(data.ghlNoteId)}`, {
            method: "PUT", body,
          });
        } catch (err) {
          // Note supprimée côté GHL (ou id périmé) → on la recrée plutôt que de perdre le débrief.
          console.warn(`Note GHL ${data.ghlNoteId} non modifiable, recréation : ${err instanceof Error ? err.message : String(err)}`);
          raw = await ghlRequest(`/contacts/${contact}/notes`, { method: "POST", body });
        }
      } else {
        raw = await ghlRequest(`/contacts/${contact}/notes`, { method: "POST", body });
      }
      const noteId = extractNoteId(raw) ?? data.ghlNoteId ?? undefined;
      await ctx.runMutation(internal.ghlContactNote.markPushed, {
        debriefId: args.debriefId, now: Date.now(),
        ...(noteId !== undefined ? { ghlNoteId: noteId } : {}),
      });
      console.log(`Note débrief GHL ${data.ghlNoteId ? "mise à jour" : "créée"} (contact ${data.contactExternalId}, débrief ${args.debriefId})`);
      return true;
    } catch (err) {
      console.warn(`Note débrief GHL échouée (contact ${data.contactExternalId}, débrief ${args.debriefId}) : ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  },
});
