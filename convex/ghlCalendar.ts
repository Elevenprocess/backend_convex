/**
 * Calendrier GHL — sync (cron 15 min + manuelle) et lectures front (Tranche 8b).
 * GHL est la source de vérité des rendez-vous. Couches : helpers purs dans
 * model/ghl/, fetch API dans ghlClient.ts, écritures ici en mutations internes.
 */
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireUser, roleOf } from "./model/access";
import type { Role } from "./model/enums";
import { ghlRequest, isGhlConfigured, requireGhlLocationId } from "./ghlClient";
import {
  normalizeEvents, normalizeGhlCalendars, normalizeGhlContact, normalizeGhlUsers,
  normalizeSlots, splitContactName,
} from "./model/ghl/calendarNormalize";
import {
  calendarIdForSector, calendarsForEvents, isSectorLike, parseSectorCalendars,
  publicSectors, sectorFromCalendarName,
} from "./model/ghl/sectorConfig";
import {
  SYNCED_NOTES_PREFIX, boundRdvEventsRange, buildSyncedRdvNotes, leadPatchFromGhlEvent,
  mapGhlStatusToRdvStatus, scopeGhlEventsToCommercial, splitDateRange,
} from "./model/ghl/calendarSync";
import { shouldRearmDebriefOnReschedule } from "./model/rdvReschedule";
import type { GhlCalendarEvent, GhlContactInfo } from "./model/ghl/calendarTypes";

// ─── Cache events (TTL 60 s, table — la Map mémoire NestJS ne survit pas aux
// isolates Convex) ────────────────────────────────────────────────────────────

export const cacheGet = internalQuery({
  args: { key: v.string(), now: v.number() },
  // Retour explicite : appelée via runQuery depuis des actions du même module →
  // sans annotation, l'inférence boucle (implicit any en cascade au push).
  handler: async (ctx, args): Promise<string | null> => {
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
  handler: async (ctx): Promise<Array<{ ghlUserId: string; userId: Id<"users">; name: string }>> => {
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
  handler: async (ctx, args): Promise<{ externalId: string | undefined } | null> => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    return { externalId: lead.externalId };
  },
});

export const userForMySector = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ ghlUserId: string | undefined; ghlCalendarId: string | undefined } | null> => {
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
  handler: async (ctx, args): Promise<{ created: number; updated: number; skipped: number }> => {
    let created = 0, updated = 0, skipped = 0;

    for (const event of args.events) {
      if (!event.id || !event.startTime) { skipped++; continue; }
      const scheduledAt = Date.parse(event.startTime);
      const status = mapGhlStatusToRdvStatus(event.status);

      // Deux familles d'ids : rdv natif → id GHL dans externalId ; rdv migré
      // de Render → externalId = uuid Postgres, id GHL dans ghlEventId. Ne
      // chercher que externalId dupliquerait chaque rdv migré à chaque sync.
      const candidates = await ctx.db
        .query("rdv")
        .withIndex("by_externalId", (q) => q.eq("externalId", event.id))
        .collect();
      let existing = candidates.find((r) => r.deletedAt === undefined);
      if (!existing) {
        const migrated = await ctx.db
          .query("rdv")
          .withIndex("by_ghlEventId", (q) => q.eq("ghlEventId", event.id))
          .collect();
        existing = migrated.find((r) => r.deletedAt === undefined);
      }

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
  // Bi-famille d'ids (cf. persistGhlEvents) : externalId pour les leads
  // natifs, ghlContactId pour les migrés de Render.
  const candidates = await ctx.db
    .query("leads")
    .withIndex("by_externalId", (q) => q.eq("externalId", contactId))
    .collect();
  let existing = candidates.find((l: Doc<"leads">) => l.deletedAt === undefined);
  if (!existing) {
    const migrated = await ctx.db
      .query("leads")
      .withIndex("by_ghlContactId", (q) => q.eq("ghlContactId", contactId))
      .collect();
    existing = migrated.find((l: Doc<"leads">) => l.deletedAt === undefined);
  }
  if (existing) {
    const patch = leadPatchFromGhlEvent(event);
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch as Partial<Doc<"leads">>);
    return existing._id;
  }
  const nameParts = splitContactName(event.contactName ?? event.title);
  const firstName = event.contactFirstName ?? nameParts.firstName;
  const lastName = event.contactLastName ?? nameParts.lastName;
  return await ctx.db.insert("leads", {
    createdAt: Date.now(),
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

// ─── Lectures front (actions) ─────────────────────────────────────────────────

const SETTER_VIEW = ["admin", "setter", "setter_lead"];
const SALES_VIEW = ["admin", "setter", "setter_lead", "commercial", "commercial_lead"];
const BUSINESS_VIEW = ["admin", "commercial_lead"];
const GHL_EVENTS_CACHE_TTL_MS = 60_000;

// Type de retour explicite : viewerInfo est dans CE module (internal.ghlCalendar)
// et est appelée via runQuery ici même → sans annotation, TS boucle sur
// l'inférence (implicit any en cascade sur tout le fichier au push Convex).
async function requireViewer(
  ctx: ActionCtx,
  allowed: string[],
): Promise<{ userId: Id<"users">; role: Role }> {
  const viewer = await ctx.runQuery(internal.ghlCalendar.viewerInfo, {});
  if (!allowed.includes(viewer.role)) throw new Error("Accès refusé");
  return viewer;
}

function sectorsFromEnv() {
  return parseSectorCalendars(process.env.GHL_SECTOR_CALENDARS);
}

/**
 * Portage loadEvents (l.701-728) : fetch par calendrier × fenêtre 30 j,
 * normalisation, dédoublonnage, tri, enrichissement contacts (batchs de 8,
 * échec unitaire avalé, priorité contact GHL > event) + commerciaux mappés.
 */
async function loadEventsImpl(
  ctx: ActionCtx,
  dto: { fromMs: number; toMs: number; sector?: string; calendarId?: string },
): Promise<{ configured: boolean; events: GhlCalendarEvent[] }> {
  if (!isGhlConfigured()) return { configured: false, events: [] };
  const calendars = calendarsForEvents(sectorsFromEnv(), dto);
  if (calendars.length === 0) return { configured: true, events: [] };

  const events: GhlCalendarEvent[] = [];
  for (const calendar of calendars) {
    for (const range of splitDateRange(dto.fromMs, dto.toMs)) {
      const raw = await ghlRequest("/calendars/events", {
        query: {
          locationId: requireGhlLocationId(),
          calendarId: calendar.calendarId,
          startTime: range.fromMs,
          endTime: range.toMs,
        },
      });
      events.push(...normalizeEvents(raw, calendar.calendarId, calendar.sector));
    }
  }

  const byId = new Map<string, GhlCalendarEvent>();
  for (const event of events) byId.set(event.id, event);
  const sorted = [...byId.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  return { configured: true, events: await enrichCommercials(ctx, await enrichContacts(sorted)) };
}

async function enrichContacts(events: GhlCalendarEvent[]): Promise<GhlCalendarEvent[]> {
  const contactIds = [...new Set(events.map((e) => e.contactId).filter((id): id is string => Boolean(id)))];
  if (contactIds.length === 0) return events;
  const byId = new Map<string, GhlContactInfo>();
  const concurrency = 8;
  for (let index = 0; index < contactIds.length; index += concurrency) {
    const batch = contactIds.slice(index, index + concurrency);
    await Promise.all(batch.map(async (contactId) => {
      try {
        const raw = await ghlRequest(`/contacts/${encodeURIComponent(contactId)}`);
        byId.set(contactId, normalizeGhlContact(raw, contactId));
      } catch {
        // Ne bloque pas l'agenda si un contact GHL est inaccessible.
      }
    }));
  }
  return events.map((event) => {
    const contact = event.contactId ? byId.get(event.contactId) : undefined;
    if (!contact) return event;
    return {
      ...event,
      contactName: contact.name ?? event.contactName,
      contactFirstName: contact.firstName ?? event.contactFirstName,
      contactLastName: contact.lastName ?? event.contactLastName,
      contactEmail: contact.email ?? event.contactEmail,
      contactPhone: contact.phone ?? event.contactPhone,
      contactCity: contact.city ?? event.contactCity,
      contactPostalCode: contact.postalCode ?? event.contactPostalCode,
      address: event.address ?? contact.addressLine,
    };
  });
}

async function enrichCommercials(ctx: ActionCtx, events: GhlCalendarEvent[]): Promise<GhlCalendarEvent[]> {
  const assignedIds = [...new Set(events.map((e) => e.assignedUserId).filter((id): id is string => Boolean(id)))];
  if (assignedIds.length === 0) {
    return events.map((e) => ({ ...e, commercialId: undefined, commercialName: undefined, isMappedCommercial: false }));
  }
  const rows = await ctx.runQuery(internal.ghlCalendar.commercialsByGhlUserId, {});
  const byGhlUserId = new Map(rows.map((r) => [r.ghlUserId, r]));
  return events.map((event) => {
    const commercial = event.assignedUserId ? byGhlUserId.get(event.assignedUserId) : undefined;
    return {
      ...event,
      commercialId: commercial?.userId,
      commercialName: commercial?.name,
      isMappedCommercial: Boolean(commercial),
    };
  });
}

export const getConfig = action({
  args: {},
  handler: async (ctx) => {
    await requireViewer(ctx, SALES_VIEW);
    const configured = sectorsFromEnv();
    return {
      configured: isGhlConfigured(),
      locationIdPresent: Boolean(process.env.GHL_LOCATION_ID),
      sectorCalendarCount: configured.length,
      sectors: publicSectors(configured),
    };
  },
});

export const listGroups = action({
  args: {},
  handler: async (ctx) => {
    await requireViewer(ctx, ["admin"]);
    return await ghlRequest("/calendars/groups", { query: { locationId: requireGhlLocationId() } });
  },
});

export const listCalendars = action({
  args: { groupId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireViewer(ctx, ["admin"]);
    return await ghlRequest("/calendars/", { query: { locationId: requireGhlLocationId(), groupId: args.groupId } });
  },
});

export const listUsers = action({
  args: {},
  handler: async (ctx) => {
    await requireViewer(ctx, BUSINESS_VIEW);
    const raw = await ghlRequest("/users/", { query: { locationId: requireGhlLocationId() } });
    return normalizeGhlUsers(raw);
  },
});

export const freeSlots = action({
  args: {
    from: v.number(), to: v.number(),
    sector: v.optional(v.string()), calendarId: v.optional(v.string()), timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireViewer(ctx, SETTER_VIEW);
    if (!isGhlConfigured()) return { configured: false, slots: [] };
    const calendarId = args.calendarId || calendarIdForSector(sectorsFromEnv(), args.sector);
    if (!calendarId) return { configured: true, slots: [] };
    const raw = await ghlRequest(`/calendars/${encodeURIComponent(calendarId)}/free-slots`, {
      query: { startDate: args.from, endDate: args.to, timezone: args.timezone || "Indian/Reunion" },
    });
    return { configured: true, slots: normalizeSlots(raw, calendarId, args.sector) };
  },
});

export const events = action({
  args: {
    from: v.number(), to: v.number(),
    sector: v.optional(v.string()), calendarId: v.optional(v.string()),
  },
  // Retour explicite : appelle internal.ghlCalendar.* via runQuery → sans
  // annotation, le type de l'api générée boucle (implicit any en cascade).
  handler: async (ctx, args): Promise<{ configured: boolean; events: GhlCalendarEvent[] }> => {
    const viewer = await requireViewer(ctx, SALES_VIEW);
    const bounded = boundRdvEventsRange(args.from, args.to);
    if (!bounded) return { configured: isGhlConfigured(), events: [] as GhlCalendarEvent[] };

    const dto = { ...bounded, sector: args.sector, calendarId: args.calendarId };
    const key = JSON.stringify({ from: bounded.fromMs, to: bounded.toMs, sector: args.sector ?? null, calendarId: args.calendarId ?? null });
    const now = Date.now();
    const cached = await ctx.runQuery(internal.ghlCalendar.cacheGet, { key, now });
    if (cached !== null) {
      return scopeGhlEventsToCommercial(
        { configured: true, events: JSON.parse(cached) as GhlCalendarEvent[] },
        { userId: viewer.userId, role: viewer.role },
      );
    }
    const result = await loadEventsImpl(ctx, dto);
    if (result.configured) {
      await ctx.runMutation(internal.ghlCalendar.cacheSet, {
        key, payload: JSON.stringify(result.events), expiresAt: now + GHL_EVENTS_CACHE_TTL_MS,
      });
    }
    return scopeGhlEventsToCommercial(result, { userId: viewer.userId, role: viewer.role });
  },
});

export const mySector = action({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<{
    configured: boolean; linked: boolean; userId: Id<"users">;
    ghlUserId: string | null; primarySector: string | null; primaryCalendarId: string | null;
    sectors: Array<{ sector: string; calendarId: string; label: string; primary: boolean }>;
  }> => {
    const viewer = await requireViewer(ctx, SALES_VIEW);
    const userId = args.userId ?? viewer.userId;
    const empty = {
      configured: false, linked: false, userId, ghlUserId: null as string | null,
      primarySector: null as string | null, primaryCalendarId: null as string | null,
      sectors: [] as Array<{ sector: string; calendarId: string; label: string; primary: boolean }>,
    };
    if (!isGhlConfigured()) return empty;
    const user = await ctx.runQuery(internal.ghlCalendar.userForMySector, { userId });
    if (!user?.ghlUserId) return { ...empty, configured: true };
    const ghlUserId = user.ghlUserId;

    const raw = await ghlRequest("/calendars/", { query: { locationId: requireGhlLocationId() } });
    const calendars = normalizeGhlCalendars(raw);
    const configuredSectors = publicSectors(sectorsFromEnv());
    const sectorByCalendarId = new Map(configuredSectors.filter((s) => s.calendarId).map((s) => [s.calendarId, s]));
    const matches = calendars
      .filter((calendar) => calendar.members.some((m) => m.userId === ghlUserId && m.selected !== false))
      .map((calendar) => {
        const configured = sectorByCalendarId.get(calendar.id);
        const sector = configured?.sector || sectorFromCalendarName(calendar.name);
        const label = configured?.label || calendar.name || sector;
        const member = calendar.members.find((m) => m.userId === ghlUserId);
        return { sector, calendarId: calendar.id, label, primary: Boolean(member?.primary) };
      })
      .filter((calendar) => Boolean(calendar.calendarId));

    const sectorCalendars = matches.filter((c) => isSectorLike(c.label) || sectorByCalendarId.has(c.calendarId));
    const candidates = sectorCalendars.length > 0 ? sectorCalendars : matches;
    const primary = candidates.find((c) => c.primary) ?? candidates[0] ?? null;

    if (primary && user.ghlCalendarId !== primary.calendarId) {
      await ctx.runMutation(internal.ghlCalendar.setUserGhlCalendarId, { userId, calendarId: primary.calendarId });
    }
    return {
      configured: true, linked: true, userId,
      ghlUserId,
      primarySector: primary?.label ?? null,
      primaryCalendarId: primary?.calendarId ?? null,
      sectors: candidates,
    };
  },
});

// ─── Sync (manuelle + cron) ───────────────────────────────────────────────────

const PERSIST_CHUNK_SIZE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

async function persistInChunks(
  ctx: ActionCtx,
  events: GhlCalendarEvent[],
  now: number,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0, updated = 0, skipped = 0;
  const payload = events as unknown as Array<Infer<typeof ghlEventValidator>>;
  for (let i = 0; i < payload.length; i += PERSIST_CHUNK_SIZE) {
    const r = await ctx.runMutation(internal.ghlCalendar.persistGhlEvents, {
      events: payload.slice(i, i + PERSIST_CHUNK_SIZE), now,
    });
    created += r.created; updated += r.updated; skipped += r.skipped;
  }
  return { created, updated, skipped };
}

export const syncEvents = action({
  args: {
    from: v.number(), to: v.number(),
    sector: v.optional(v.string()), calendarId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireViewer(ctx, SETTER_VIEW);
    const bounded = boundRdvEventsRange(args.from, args.to);
    if (!bounded || !isGhlConfigured()) {
      return { configured: isGhlConfigured(), created: 0, updated: 0, skipped: 0, events: [] as GhlCalendarEvent[] };
    }
    const result = await loadEventsImpl(ctx, { ...bounded, sector: args.sector, calendarId: args.calendarId });
    if (!result.configured) return { configured: false, created: 0, updated: 0, skipped: 0, events: [] as GhlCalendarEvent[] };
    const synced = await persistInChunks(ctx, result.events, Date.now());
    return { configured: true, ...synced, events: result.events };
  },
});

export const syncLeadEvents = action({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args): Promise<{
    configured: boolean; created: number; updated: number; skipped: number; matched: number; events: GhlCalendarEvent[];
  }> => {
    await requireViewer(ctx, SETTER_VIEW);
    if (!isGhlConfigured()) return { configured: false, created: 0, updated: 0, skipped: 0, matched: 0, events: [] as GhlCalendarEvent[] };
    const lead = await ctx.runQuery(internal.ghlCalendar.leadSyncInfo, { leadId: args.leadId });
    if (!lead?.externalId) return { configured: true, created: 0, updated: 0, skipped: 0, matched: 0, events: [] as GhlCalendarEvent[] };

    const now = Date.now();
    const result = await loadEventsImpl(ctx, { fromMs: now - DAY_MS, toMs: now + 45 * DAY_MS });
    if (!result.configured) return { configured: false, created: 0, updated: 0, skipped: 0, matched: 0, events: [] as GhlCalendarEvent[] };
    const matching = result.events.filter((event) => event.contactId === lead.externalId);
    const synced = await persistInChunks(ctx, matching, now);
    return { configured: true, ...synced, matched: matching.length, events: matching };
  },
});

/**
 * Synchro périodique 15 min (portage syncEventsScheduled l.745-763).
 * DÉBRANCHÉE par défaut : ne tourne que si GHL_SYNC_ENABLED === "true".
 * Fenêtre glissante [−3 j ; +60 j]. Best-effort : ne throw jamais.
 */
export const syncScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    if (process.env.GHL_SYNC_ENABLED !== "true") return null;
    if (!isGhlConfigured()) return null;
    const now = Date.now();
    try {
      const result = await loadEventsImpl(ctx, { fromMs: now - 3 * DAY_MS, toMs: now + 60 * DAY_MS });
      if (!result.configured) return null;
      const synced = await persistInChunks(ctx, result.events, now);
      if (synced.created || synced.updated) {
        console.log(`Sync calendrier GHL auto : ${synced.created} créé(s), ${synced.updated} mis à jour, ${synced.skipped} ignoré(s)`);
      }
    } catch (error) {
      console.warn(`Sync calendrier GHL auto échouée : ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  },
});

// ─── Mapping commerciaux GHL ↔ comptes Velora ────────────────────────────────
// Relie chaque membre des calendriers secteur GHL (Nord/Sud/Est/Ouest) à son
// compte users Velora : match par email (index "email"), sinon par nom plié ;
// compte créé (role commercial, team closing) s'il n'existe pas — il sera
// adopté par Convex Auth au premier login Google sur le même email. Pose
// ghlUserId (résolution commerciale des RDV sync) et ghlCalendarId quand un
// seul secteur. Idempotent.
export const mapGhlCommercials = internalMutation({
  args: {
    pairs: v.array(
      v.object({
        ghlUserId: v.string(),
        email: v.string(),
        name: v.string(),
        calendarId: v.optional(v.string()),
      }),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const fold = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const allUsers = await ctx.db.query("users").collect();
    const report = { linked: [] as string[], created: [] as string[], already: [] as string[] };

    for (const pair of args.pairs) {
      const email = pair.email.trim().toLowerCase();
      let user =
        (email
          ? await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique()
          : null) ??
        allUsers.find((u) => u.deletedAt === undefined && fold(u.name ?? "") === fold(pair.name)) ??
        null;

      if (user) {
        if (user.ghlUserId === pair.ghlUserId) {
          report.already.push(`${pair.name} → ${user.name ?? user.email}`);
          continue;
        }
        if (args.dryRun !== true) {
          await ctx.db.patch(user._id, {
            ghlUserId: pair.ghlUserId,
            ...(pair.calendarId !== undefined ? { ghlCalendarId: pair.calendarId } : {}),
          });
        }
        report.linked.push(`${pair.name} → ${user.name ?? user.email}`);
      } else {
        if (args.dryRun !== true) {
          await ctx.db.insert("users", {
            email,
            name: pair.name,
            role: "commercial",
            team: "closing",
            active: true,
            ghlUserId: pair.ghlUserId,
            ...(pair.calendarId !== undefined ? { ghlCalendarId: pair.calendarId } : {}),
          });
        }
        report.created.push(`${pair.name} (${email})`);
      }
    }
    return { dryRun: args.dryRun === true, ...report };
  },
});
