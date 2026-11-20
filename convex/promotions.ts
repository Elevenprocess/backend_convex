// API des promotions (onglet Promotion de la page Leads). Gestion admin,
// lecture « en cours » pour tous. Le rattachement des leads est dans
// model/promotionAttach.ts (tags) et attachLegacy ci-dessous (statuts).
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole, requireUser } from "./model/access";
import { logActivity } from "./model/activity";
import { applyTagsToLead } from "./model/promotionAttach";
import { findLeadByGhlContact } from "./webhooks";
import { leadStatusValidator } from "./model/enums";
import {
  normalizeTag, parseGhlTags, promotionConflict, promotionStatus, reunionDayEndMs, reunionDayStartMs,
  type PromotionLike, type PromotionStatus,
} from "./model/promotions";

const promotionInput = {
  name: v.string(),
  tag: v.optional(v.string()),
  startDay: v.string(),
  endDay: v.string(),
  offer: v.optional(v.string()),
  pitch: v.optional(v.string()),
  officeCalendarId: v.optional(v.string()),
  officeAddress: v.optional(v.string()),
  legacyStatuses: v.optional(v.array(leadStatusValidator)),
  legacyArrivedFromDay: v.optional(v.string()),
  legacyArrivedToDay: v.optional(v.string()),
};

type PromotionInputArgs = {
  name: string; tag?: string; startDay: string; endDay: string; offer?: string; pitch?: string;
  officeCalendarId?: string; officeAddress?: string; legacyStatuses?: Doc<"leads">["status"][];
  legacyArrivedFromDay?: string; legacyArrivedToDay?: string;
};

const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? undefined : t;
};

/** Retire les clés dont la valeur est undefined (Convex refuse undefined dans un document). */
function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, val]) => val !== undefined)) as T;
}

/** Valide et convertit la saisie admin en champs de table (sans createdBy/createdAt/archived). */
function toFields(args: PromotionInputArgs) {
  const name = clean(args.name);
  if (!name) throw new Error("Le nom de la promotion est obligatoire.");
  const startAt = reunionDayStartMs(args.startDay);
  const endAt = reunionDayEndMs(args.endDay);
  if (endAt <= startAt) throw new Error("La date de fin doit être après la date de début.");
  const tag = clean(args.tag);
  const legacyStatuses = args.legacyStatuses && args.legacyStatuses.length > 0 ? args.legacyStatuses : undefined;
  if (!tag && !legacyStatuses) {
    throw new Error("Indique un tag ou au moins un statut d'anciens leads.");
  }
  return {
    name,
    tag,
    tagKey: tag ? normalizeTag(tag) : undefined,
    startAt,
    endAt,
    offer: clean(args.offer),
    pitch: clean(args.pitch),
    officeCalendarId: clean(args.officeCalendarId),
    officeAddress: clean(args.officeAddress),
    legacyStatuses,
    legacyArrivedFrom: args.legacyArrivedFromDay ? reunionDayStartMs(args.legacyArrivedFromDay) : undefined,
    legacyArrivedTo: args.legacyArrivedToDay ? reunionDayEndMs(args.legacyArrivedToDay) : undefined,
  };
}

function asLike(
  p: Pick<Doc<"promotions">, "tagKey" | "startAt" | "endAt" | "archived" | "officeCalendarId">,
  id: string,
): PromotionLike {
  return { _id: id, tagKey: p.tagKey, startAt: p.startAt, endAt: p.endAt, archived: p.archived, officeCalendarId: p.officeCalendarId };
}

export const create = mutation({
  args: promotionInput,
  handler: async (ctx, args): Promise<Id<"promotions">> => {
    const user = await requireRole(ctx, ["admin"]);
    const fields = toFields(args);
    const others = await ctx.db.query("promotions").collect();
    const conflict = promotionConflict(
      asLike({ ...fields, archived: false }, "__new__"),
      others.map((o) => asLike(o, o._id)),
    );
    if (conflict) throw new Error(conflict);
    const id = await ctx.db.insert(
      "promotions",
      stripUndefined({ ...fields, archived: false, createdBy: user._id, createdAt: Date.now() }),
    );
    await logActivity(ctx, {
      action: "promotion.created", entityType: "promotion", entityId: id, subject: fields.name,
      summary: `a créé la promotion « ${fields.name} »`,
      details: { tag: fields.tag ?? null, startAt: fields.startAt, endAt: fields.endAt },
    });
    return id;
  },
});

export const update = mutation({
  args: { id: v.id("promotions"), ...promotionInput },
  handler: async (ctx, { id, ...args }) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Promotion introuvable.");
    const fields = toFields(args);
    const others = await ctx.db.query("promotions").collect();
    const conflict = promotionConflict(
      asLike({ ...fields, archived: existing.archived }, id),
      others.map((o) => asLike(o, o._id)),
    );
    if (conflict) throw new Error(conflict);
    // replace : les champs vidés dans le formulaire doivent disparaître.
    await ctx.db.replace(
      id,
      stripUndefined({ ...fields, archived: existing.archived, createdBy: existing.createdBy, createdAt: existing.createdAt }),
    );
    await logActivity(ctx, {
      action: "promotion.updated", entityType: "promotion", entityId: id, subject: fields.name,
      summary: `a modifié la promotion « ${fields.name} »`,
    });
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id("promotions") },
  handler: async (ctx, { id }) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Promotion introuvable.");
    await ctx.db.patch(id, { archived: true });
    await logActivity(ctx, {
      action: "promotion.archived", entityType: "promotion", entityId: id, subject: existing.name,
      summary: `a archivé la promotion « ${existing.name} »`,
    });
    return null;
  },
});

export type PromotionRow = Doc<"promotions"> & { status: PromotionStatus };

export const list = query({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<PromotionRow[]> => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db.query("promotions").collect();
    return rows
      .map((p) => ({ ...p, status: promotionStatus(p, now) }))
      .sort((a, b) => b.startAt - a.startAt);
  },
});

/** Promos en cours (bandeau setter, onglet Promotion, choix RDV bureau). */
export const active = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", now)).collect();
    return rows
      .filter((p) => promotionStatus(p, now) === "en_cours")
      .map((p) => ({
        _id: p._id, name: p.name, startAt: p.startAt, endAt: p.endAt,
        offer: p.offer, pitch: p.pitch, officeCalendarId: p.officeCalendarId, officeAddress: p.officeAddress,
      }));
  },
});

export const applyLeadTags = internalMutation({
  args: { leadId: v.id("leads"), tags: v.array(v.string()), at: v.number() },
  handler: async (ctx, args) => {
    const r = await applyTagsToLead(ctx, args.leadId, args.tags, args.at);
    return { attached: r.attached };
  },
});

/** Route /webhooks/ghl/tags : résout le contact (deux familles d'ids) puis rattache. */
export const applyContactTags = internalMutation({
  args: { contactId: v.string(), tags: v.array(v.string()), at: v.number() },
  handler: async (ctx, args) => {
    const lead = await findLeadByGhlContact(ctx, args.contactId);
    if (!lead || lead.deletedAt !== undefined) return { matched: false, attached: false };
    const r = await applyTagsToLead(ctx, lead._id, args.tags, args.at);
    return { matched: true, attached: r.attached };
  },
});

function contactIdFromPayload(p: Record<string, unknown>): string | undefined {
  const contact = (p.contact ?? {}) as Record<string, unknown>;
  for (const value of [p.contact_id, p.contactId, contact.id, p.id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Rejoue un lot de webhooks GHL reçus pendant la promo et rattache les tags (idempotent). */
export const backfillBatch = internalMutation({
  args: { promotionId: v.id("promotions"), after: v.number(), batch: v.number() },
  handler: async (ctx, args): Promise<{ scanned: number; attached: number; cursor: number; done: boolean }> => {
    const promo = await ctx.db.get(args.promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const from = Math.max(args.after, promo.startAt - 1);
    const events = await ctx.db
      .query("webhookEvents")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", from).lte("_creationTime", promo.endAt))
      .order("asc")
      .take(args.batch);
    let attached = 0;
    let cursor = from;
    for (const ev of events) {
      cursor = ev._creationTime;
      if (ev.provider !== "ghl") continue;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(ev.payload) as Record<string, unknown>; } catch { continue; }
      const tags = parseGhlTags(payload.tags ?? (payload.contact as Record<string, unknown> | undefined)?.tags);
      const contactId = contactIdFromPayload(payload);
      if (tags.length === 0 || !contactId) continue;
      const lead = await findLeadByGhlContact(ctx, contactId);
      if (!lead || lead.deletedAt !== undefined) continue;
      const r = await applyTagsToLead(ctx, lead._id, tags, ev._creationTime);
      if (r.attached) attached++;
    }
    return { scanned: events.length, attached, cursor, done: events.length < args.batch };
  },
});

export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ userId: Id<"users"> }> => {
    const user = await requireRole(ctx, ["admin"]);
    return { userId: user._id };
  },
});

/** Action admin : rattrape les tags de toute la promo depuis les webhooks stockés. */
export const backfill = action({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, args): Promise<{ scanned: number; attached: number }> => {
    await ctx.runQuery(internal.promotions.assertAdmin, {});
    let after = 0, scanned = 0, attached = 0;
    for (;;) {
      const r: { scanned: number; attached: number; cursor: number; done: boolean } =
        await ctx.runMutation(internal.promotions.backfillBatch, { promotionId: args.promotionId, after, batch: 100 });
      scanned += r.scanned;
      attached += r.attached;
      if (r.done) break;
      after = r.cursor;
    }
    return { scanned, attached };
  },
});
