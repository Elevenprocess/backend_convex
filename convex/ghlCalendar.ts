/**
 * Calendrier GHL — sync (cron 15 min + manuelle) et lectures front (Tranche 8b).
 * GHL est la source de vérité des rendez-vous. Couches : helpers purs dans
 * model/ghl/, fetch API dans ghlClient.ts, écritures ici en mutations internes.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser, roleOf } from "./model/access";
import {
  SYNCED_NOTES_PREFIX, buildSyncedRdvNotes, leadPatchFromGhlEvent, mapGhlStatusToRdvStatus,
} from "./model/ghl/calendarSync";
import { splitContactName } from "./model/ghl/calendarNormalize";
import { shouldRearmDebriefOnReschedule } from "./model/rdvReschedule";
import type { GhlCalendarEvent } from "./model/ghl/calendarTypes";

// ─── Cache events (TTL 60 s, table — la Map mémoire NestJS ne survit pas aux
// isolates Convex) ────────────────────────────────────────────────────────────

export const cacheGet = internalQuery({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("ghlEventsCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!row || row.expiresAt <= args.now) return null;
    return row.payload;
  },
});

export const cacheSet = internalMutation({
  args: { key: v.string(), payload: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ghlEventsCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { payload: args.payload, expiresAt: args.expiresAt });
    else await ctx.db.insert("ghlEventsCache", args);
    return null;
  },
});

// ─── Queries internes de support (les actions n'ont pas ctx.db) ─────────────

export const viewerInfo = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { userId: user._id, role: roleOf(user) };
  },
});

export const commercialsByGhlUserId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("users").collect();
    return rows
      .filter((u) =>
        u.deletedAt === undefined &&
        u.ghlUserId !== undefined &&
        (u.role === "commercial" || u.role === "commercial_lead"),
      )
      .map((u) => ({ ghlUserId: u.ghlUserId!, userId: u._id, name: u.name ?? "" }));
  },
});

export const leadSyncInfo = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    return { externalId: lead.externalId };
  },
});

export const userForMySector = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt !== undefined) return null;
    return { ghlUserId: user.ghlUserId, ghlCalendarId: user.ghlCalendarId };
  },
});

export const setUserGhlCalendarId = internalMutation({
  args: { userId: v.id("users"), calendarId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { ghlCalendarId: args.calendarId });
    return null;
  },
});

// ─── persistGhlEvents (cœur de la sync, portage l.887-985) ────────────────────

export const ghlEventValidator = v.object({
  id: v.string(),
  calendarId: v.string(),
  sector: v.optional(v.string()),
  title: v.optional(v.string()),
  startTime: v.string(),
  endTime: v.optional(v.string()),
  status: v.optional(v.string()),
  contactId: v.optional(v.string()),
  assignedUserId: v.optional(v.string()),
  commercialId: v.optional(v.id("users")),
  commercialName: v.optional(v.string()),
  isMappedCommercial: v.optional(v.boolean()),
  address: v.optional(v.string()),
  notes: v.optional(v.string()),
  contactName: v.optional(v.string()),
  contactFirstName: v.optional(v.string()),
  contactLastName: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  contactPhone: v.optional(v.string()),
  contactCity: v.optional(v.string()),
  contactPostalCode: v.optional(v.string()),
});

/**
 * Portage de persistGhlEvents (service NestJS l.887-985). GHL source de
 * vérité : crée/patch les RDV locaux, ré-arme le débrief sur reprogrammation
 * d'un RDV clôturé. SEAM 8c : pas de setContactDebriefLink ici — debriefDueAt
 * reste vide, le backfill 2 min (8c) rattrapera.
 */
export const persistGhlEvents = internalMutation({
  args: { events: v.array(ghlEventValidator), now: v.number() },
  handler: async (ctx, args) => {
    let created = 0, updated = 0, skipped = 0;

    for (const event of args.events) {
      if (!event.id || !event.startTime) { skipped++; continue; }
      const scheduledAt = Date.parse(event.startTime);
      const status = mapGhlStatusToRdvStatus(event.status);

      const candidates = await ctx.db
        .query("rdv")
        .withIndex("by_externalId", (q) => q.eq("externalId", event.id))
        .collect();
      const existing = candidates.find((r) => r.deletedAt === undefined);

      if (existing) {
        const rearm = shouldRearmDebriefOnReschedule({
          existingScheduledAt: existing.scheduledAt,
          existingStatus: existing.status,
          existingResult: existing.result,
          existingDebriefFilledAt: existing.debriefFilledAt,
          newScheduledAt: scheduledAt,
          now: args.now,
        });
        if (rearm) {
          const isSyncedNotes = existing.notes?.startsWith(SYNCED_NOTES_PREFIX);
          await ctx.db.patch(existing._id, {
            commercialId: event.commercialId,
            scheduledAt,
            status: "planifie",
            result: undefined,
            debriefFilledAt: undefined,
            ...(isSyncedNotes ? { notes: undefined } : {}),
          });
          updated++;
          continue;
        }
        if (existing.debriefFilledAt !== undefined) {
          await ctx.db.patch(existing._id, { commercialId: event.commercialId, scheduledAt, status });
        } else {
          await ctx.db.patch(existing._id, {
            commercialId: event.commercialId,
            scheduledAt,
            status,
            notes: buildSyncedRdvNotes(event as GhlCalendarEvent),
          });
        }
        updated++;
        continue;
      }

      const leadId = event.contactId
        ? await findOrCreateLeadFromGhlEvent(ctx, event as GhlCalendarEvent)
        : null;
      if (!leadId) { skipped++; continue; }
      await ctx.db.insert("rdv", {
        externalId: event.id,
        leadId,
        ...(event.commercialId !== undefined ? { commercialId: event.commercialId } : {}),
        scheduledAt,
        locationType: "domicile",
        status,
        notes: buildSyncedRdvNotes(event as GhlCalendarEvent),
      });
      if (event.commercialId !== undefined) {
        await ctx.db.patch(leadId, { status: "qualifie", assignedToId: event.commercialId });
      }
      created++;
    }

    return { created, updated, skipped };
  },
});

/** Portage findOrCreateLeadFromGhlEvent + findLeadIdByGhlContactId (l.1425-1465). */
async function findOrCreateLeadFromGhlEvent(
  ctx: MutationCtx,
  event: GhlCalendarEvent,
): Promise<Id<"leads"> | null> {
  if (!event.contactId) return null;
  const contactId = event.contactId;
  const candidates = await ctx.db
    .query("leads")
    .withIndex("by_externalId", (q) => q.eq("externalId", contactId))
    .collect();
  const existing = candidates.find((l: Doc<"leads">) => l.deletedAt === undefined);
  if (existing) {
    const patch = leadPatchFromGhlEvent(event);
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch as Partial<Doc<"leads">>);
    return existing._id;
  }
  const nameParts = splitContactName(event.contactName ?? event.title);
  const firstName = event.contactFirstName ?? nameParts.firstName;
  const lastName = event.contactLastName ?? nameParts.lastName;
  return await ctx.db.insert("leads", {
    externalId: contactId,
    source: "ghl",
    status: "qualifie",
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(event.contactEmail !== undefined ? { email: event.contactEmail } : {}),
    ...(event.contactPhone !== undefined ? { phone: event.contactPhone } : {}),
    ...(event.address !== undefined ? { addressLine: event.address } : {}),
    ...(event.contactCity !== undefined ? { city: event.contactCity } : {}),
    ...(event.contactPostalCode !== undefined ? { postalCode: event.contactPostalCode } : {}),
    ...(event.commercialId !== undefined ? { assignedToId: event.commercialId as Id<"users"> } : {}),
  });
}
