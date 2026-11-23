// API des promotions (onglet Promotion de la page Leads). Gestion admin,
// lecture « en cours » pour tous. Le rattachement des leads est dans
// model/promotionAttach.ts (tags) et attachLegacy ci-dessous (statuts).
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireLeadWriteRole, requireRole, requireUser } from "./model/access";
import { ghlRequest, isGhlConfigured, requireGhlLocationId } from "./ghlClient";
import { ghlSlotTexts, isOfficeSlot } from "./model/promotionSlots";
import { buildGhlProspectRemark } from "./model/ghl/prospectRemark";
import { renderPromotionMail } from "./model/emails/promotionMails";
import { leadLabel, logActivity, logSystemActivity } from "./model/activity";
import { applyTagsToLead, blankSlateForPromotion } from "./model/promotionAttach";
import { findLeadByGhlContact } from "./webhooks";
import { OPEN_RDV_STATUSES } from "./rdv";
import { leadStatusValidator } from "./model/enums";
import { ANSWERED_RESULTS, CALLBACK_RESULTS, QUALIFIED_STATUSES } from "./model/funnelMath";
import {
  formatPromotionSlot, legacyRejectReason, normalizeTag, parseGhlTags, promotionConflict, promotionStatus, reunionDayEndMs, reunionDayStartMs,
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
  slotBookingUrl: v.optional(v.string()),
  legacyStatuses: v.optional(v.array(leadStatusValidator)),
  legacyArrivedFromDay: v.optional(v.string()),
  legacyArrivedToDay: v.optional(v.string()),
};

type PromotionInputArgs = {
  name: string; tag?: string; startDay: string; endDay: string; offer?: string; pitch?: string;
  officeCalendarId?: string; officeAddress?: string; slotBookingUrl?: string; legacyStatuses?: Doc<"leads">["status"][];
  legacyArrivedFromDay?: string; legacyArrivedToDay?: string;
};

const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? undefined : t;
};

/** Adresse du site de réservation : vide = aucune, sinon https obligatoire. */
function cleanBookingUrl(raw: string | undefined): string | undefined {
  const url = clean(raw);
  if (url && !/^https:\/\/\S+$/.test(url)) throw new Error("Le lien du site de réservation doit commencer par https://");
  return url;
}

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
  const slotBookingUrl = cleanBookingUrl(args.slotBookingUrl);
  const legacyStatuses = args.legacyStatuses && args.legacyStatuses.length > 0 ? args.legacyStatuses : undefined;
  // Ni tag ni statut : la promo reçoit ses leads par son lien webhook.
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
    slotBookingUrl,
    legacyStatuses,
    legacyArrivedFrom: args.legacyArrivedFromDay ? reunionDayStartMs(args.legacyArrivedFromDay) : undefined,
    legacyArrivedTo: args.legacyArrivedToDay ? reunionDayEndMs(args.legacyArrivedToDay) : undefined,
  };
}

/** Clé aléatoire non devinable du lien webhook d'une promo. */
export function newWebhookKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
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
      stripUndefined({ ...fields, archived: false, webhookKey: newWebhookKey(), createdBy: user._id, createdAt: Date.now() }),
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
      stripUndefined({
        ...fields, archived: existing.archived, webhookKey: existing.webhookKey ?? newWebhookKey(),
        createdBy: existing.createdBy, createdAt: existing.createdAt,
      }),
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

/** Donne un lien webhook à une promo qui n'en a pas (promos créées avant le lien). */
export const ensureWebhookKey = mutation({
  args: { id: v.id("promotions") },
  handler: async (ctx, { id }) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Promotion introuvable.");
    if (existing.webhookKey) return existing.webhookKey;
    const webhookKey = newWebhookKey();
    await ctx.db.patch(id, { webhookKey });
    return webhookKey;
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
        slotBookingUrl: p.slotBookingUrl,
        officeSlots: p.ghlSlotSync !== undefined,
      }));
  },
});

export const officeCalendarForBooking = internalQuery({
  args: { calendarId: v.string(), now: v.number() },
  handler: async (ctx, { calendarId, now }) => {
    const rows = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", now)).collect();
    const promo = rows.find((p) => p.officeCalendarId === calendarId && promotionStatus(p, now) === "en_cours");
    return promo ? { promotionId: promo._id, officeAddress: promo.officeAddress } : null;
  },
});

/** Calendriers bureau à synchroniser (promos pas finies depuis plus de 3 jours). */
export const officeCalendars = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", now - 3 * 86_400_000)).collect();
    return rows
      .filter((p) => !p.archived && p.officeCalendarId)
      .map((p) => ({ calendarId: p.officeCalendarId as string, promotionId: p._id }));
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

// ---- Anciens leads ciblés par statut (aperçu + rattachement en masse) ----

async function hasUpcomingRdv(ctx: QueryCtx, leadId: Id<"leads">, now: number): Promise<boolean> {
  const rows = await ctx.db.query("rdv").withIndex("by_lead", (q) => q.eq("leadId", leadId)).collect();
  return rows.some(
    (r) => r.deletedAt === undefined
      && (OPEN_RDV_STATUSES as readonly string[]).includes(r.status)
      && (r.scheduledAt ?? 0) > now,
  );
}

async function legacyReason(ctx: QueryCtx, lead: Doc<"leads">, promo: Doc<"promotions">, now: number) {
  const candidate = {
    status: lead.status,
    arrivedAt: lead.createdAt ?? lead._creationTime,
    deletedAt: lead.deletedAt,
    promotionId: lead.promotionId,
    hasUpcomingRdv: false,
  };
  // Les RDV ne sont interrogés que pour un lead encore éligible (rdv_a_venir est la dernière règle).
  const reason = legacyRejectReason(candidate, promo);
  if (reason !== null) return reason;
  return (await hasUpcomingRdv(ctx, lead._id, now)) ? "rdv_a_venir" as const : null;
}

// Volontairement en une seule query non paginée : la base compte ~2 600 leads.
// Au-delà de quelques milliers de leads sur les statuts ciblés, il faudra paginer
// (limites Convex par fonction).
export const previewLegacy = query({
  args: { promotionId: v.id("promotions"), now: v.number() },
  handler: async (ctx, { promotionId, now }) => {
    await requireRole(ctx, ["admin"]);
    const promo = await ctx.db.get(promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const byStatus: Record<string, number> = {};
    let eligible = 0, skipped = 0;
    for (const status of promo.legacyStatuses ?? []) {
      const leads = await ctx.db.query("leads").withIndex("by_status_createdAt", (q) => q.eq("status", status)).collect();
      for (const lead of leads) {
        const reason = await legacyReason(ctx, lead, promo, now);
        if (reason === null) { eligible++; byStatus[status] = (byStatus[status] ?? 0) + 1; }
        else if (reason !== "statut" && reason !== "periode") skipped++;
      }
    }
    return { eligible, byStatus, skipped };
  },
});

export const attachLegacyBatch = internalMutation({
  args: {
    promotionId: v.id("promotions"),
    status: leadStatusValidator,
    cursor: v.union(v.string(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<{ scanned: number; attached: number; skipped: number; cursor: string; done: boolean }> => {
    const promo = await ctx.db.get(args.promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const page = await ctx.db
      .query("leads")
      .withIndex("by_status_createdAt", (q) => q.eq("status", args.status))
      .paginate({ numItems: 200, cursor: args.cursor });
    let attached = 0, skipped = 0;
    for (const lead of page.page) {
      const reason = await legacyReason(ctx, lead, promo, args.now);
      if (reason === null) {
        await ctx.db.patch(lead._id, {
          promotionId: promo._id, promotionJoinedAt: args.now, promotionSource: "statut",
          ...(await blankSlateForPromotion(ctx, lead, args.now, promo.name)),
        });
        attached++;
      } else if (reason !== "statut" && reason !== "periode") {
        skipped++;
      }
    }
    if (attached > 0) {
      await logActivity(ctx, {
        fallbackSource: "Promotions",
        action: "promotion.legacy_attached", entityType: "promotion", entityId: promo._id, subject: promo.name,
        summary: `a rattaché ${attached} ancien(s) lead(s) « ${args.status} » à la promotion « ${promo.name} »`,
      });
    }
    return { scanned: page.page.length, attached, skipped, cursor: page.continueCursor, done: page.isDone };
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("promotions") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

/** Action admin : rattache les anciens leads des statuts ciblés (idempotent). */
export const attachLegacy = action({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, { promotionId }): Promise<{ scanned: number; attached: number; skipped: number }> => {
    await ctx.runQuery(internal.promotions.assertAdmin, {});
    const now = Date.now();
    const promo = await ctx.runQuery(internal.promotions.getInternal, { id: promotionId });
    if (!promo) throw new Error("Promotion introuvable.");
    if (promotionStatus(promo, now) === "terminee") throw new Error("Promotion terminée : rattachement impossible.");
    let scanned = 0, attached = 0, skipped = 0;
    for (const status of promo.legacyStatuses ?? []) {
      let cursor: string | null = null;
      for (;;) {
        const r: { scanned: number; attached: number; skipped: number; cursor: string; done: boolean } =
          await ctx.runMutation(internal.promotions.attachLegacyBatch, { promotionId, status, cursor, now });
        scanned += r.scanned; attached += r.attached; skipped += r.skipped;
        if (r.done) break;
        cursor = r.cursor;
      }
    }
    return { scanned, attached, skipped };
  },
});

// ─── Chiffres d'une promotion ────────────────────────────────────
// Mêmes définitions qu'analytics.ts (model/funnelMath.ts) : « joint » = au moins
// un appel au résultat ANSWERED_RESULTS ou CALLBACK_RESULTS (rappel planifié), « qualifié » = QUALIFIED_STATUSES,
// « signé » = statut signe. RDV non supprimés, comptés par type de lieu.
type StatBlock = {
  leads: number; joints: number; rdvDomicile: number; rdvBureau: number; qualifies: number; signes: number;
};
const emptyBlock = (): StatBlock => ({ leads: 0, joints: 0, rdvDomicile: 0, rdvBureau: 0, qualifies: 0, signes: 0 });

export const stats = query({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, { promotionId }) => {
    await requireRole(ctx, ["admin"]);
    const nouveaux = emptyBlock();
    const anciens = emptyBlock();
    const leads = await ctx.db.query("leads").withIndex("by_promotion", (q) => q.eq("promotionId", promotionId)).collect();
    const inPromo = new Set<string>();
    for (const lead of leads) {
      if (lead.deletedAt !== undefined) continue;
      inPromo.add(lead._id);
      const block = lead.promotionSource === "statut" ? anciens : nouveaux;
      block.leads++;
      if (QUALIFIED_STATUSES.has(lead.status)) block.qualifies++;
      if (lead.status === "signe") block.signes++;
      const calls = await ctx.db.query("callLogs").withIndex("by_lead_calledAt", (q) => q.eq("leadId", lead._id)).collect();
      if (calls.some((c) => ANSWERED_RESULTS.has(c.result) || CALLBACK_RESULTS.has(c.result))) block.joints++;
      const rdvs = await ctx.db.query("rdv").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect();
      for (const r of rdvs) {
        if (r.deletedAt !== undefined) continue;
        // « visio » est compté avec domicile : tout ce qui n'est pas agence.
        if (r.locationType === "agence") block.rdvBureau++;
        else block.rdvDomicile++;
      }
    }
    // RDV bureau pris pendant la promo sur un lead qui n'est pas rattaché à la promo.
    const promoRdvs = await ctx.db.query("rdv").withIndex("by_promotion", (q) => q.eq("promotionId", promotionId)).collect();
    const rdvBureauHorsPromo = promoRdvs.filter(
      (r) => r.deletedAt === undefined && r.locationType === "agence" && !inPromo.has(r.leadId),
    ).length;
    return { nouveaux, anciens, rdvBureauHorsPromo };
  },
});

/**
 * Route /webhooks/ghl/promotion/<clé> : retrouve la promo par sa clé de lien.
 * null = clé inconnue (la route répond 404 sans rien créer).
 */
export const byWebhookKey = internalQuery({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, { key, now }) => {
    if (!key) return null;
    const promo = await ctx.db.query("promotions").withIndex("by_webhookKey", (q) => q.eq("webhookKey", key)).unique();
    if (!promo) return null;
    return { promotionId: promo._id, name: promo.name, status: promotionStatus(promo, now) };
  },
});

/**
 * Rattache un lead à la promo du lien webhook (seulement si elle est en cours
 * et si le lead n'est pas déjà dans une promo). Compté comme « nouveau » lead
 * de promo (promotionSource « tag »), comme un rattachement par tag GHL.
 */
export const attachFromWebhook = internalMutation({
  args: { promotionId: v.id("promotions"), leadId: v.id("leads"), at: v.number() },
  handler: async (ctx, { promotionId, leadId, at }) => {
    const promo = await ctx.db.get(promotionId);
    if (!promo || promotionStatus(promo, at) !== "en_cours") return { attached: false, reason: "promo_inactive" as const };
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) return { attached: false, reason: "lead_introuvable" as const };
    if (lead.promotionId === promotionId) return { attached: true, reason: "deja_rattache" as const };
    if (lead.promotionId !== undefined) return { attached: false, reason: "autre_promo" as const };
    await ctx.db.patch(leadId, {
      promotionId, promotionJoinedAt: at, promotionSource: "tag",
      ...(await blankSlateForPromotion(ctx, lead, at, promo.name)),
    });
    await logSystemActivity(ctx, {
      source: "GHL", action: "lead.promotion.joined", entityType: "lead", entityId: leadId, leadId,
      subject: leadLabel(lead),
      summary: `${leadLabel(lead)} rattaché à la promotion « ${promo.name} » (lien webhook GHL)`,
      details: { promotionId },
    });
    return { attached: true, reason: "rattache" as const };
  },
});

/**
 * Range sur le lead le créneau d’arrivée reçu du site d’inscription (lien
 * webhook de la promo). Lead retrouvé par son contact GHL ou par son id.
 * leadId null = lead inconnu (la route le crée puis rappelle avec son id).
 * Ne marque PAS de re-soumission : choisir son heure n’est pas une nouvelle demande.
 */
export const setSlotFromWebhook = internalMutation({
  args: {
    externalId: v.optional(v.string()), leadId: v.optional(v.id("leads")),
    day: v.string(), hour: v.number(), ticket: v.optional(v.string()), at: v.number(),
  },
  handler: async (ctx, { externalId, leadId, day, hour, ticket, at }) => {
    const lead = leadId !== undefined ? await ctx.db.get(leadId)
      : externalId !== undefined ? await findLeadByGhlContact(ctx, externalId) : null;
    if (!lead || lead.deletedAt !== undefined) return { leadId: null, changed: false };
    const nextTicket = ticket ?? lead.promotionTicket;
    if (lead.promotionSlotDay === day && lead.promotionSlotHour === hour && lead.promotionTicket === nextTicket) {
      return { leadId: lead._id, changed: false };
    }
    const moved = lead.promotionSlotDay !== undefined;
    await ctx.db.patch(lead._id, stripUndefined({ promotionSlotDay: day, promotionSlotHour: hour, promotionTicket: nextTicket }));
    await logSystemActivity(ctx, {
      at, source: "GHL", action: "lead.promotion.slot", entityType: "lead", entityId: lead._id, leadId: lead._id,
      subject: leadLabel(lead),
      summary: `${leadLabel(lead)} ${moved ? "a changé de créneau" : "a son créneau"} : ${formatPromotionSlot(day, hour, nextTicket)}`,
      details: { day, hour, ticket: nextTicket ?? null },
    });
    return { leadId: lead._id, changed: true };
  },
});

/** Règle (ou vide) le site de réservation d’une promo sans passer par le formulaire admin (`npx convex run`). */
export const setSlotBookingUrl = internalMutation({
  args: { id: v.id("promotions"), url: v.optional(v.string()) },
  handler: async (ctx, { id, url }) => {
    const promo = await ctx.db.get(id);
    if (!promo) throw new Error("Promotion introuvable.");
    const slotBookingUrl = cleanBookingUrl(url);
    await ctx.db.patch(id, { slotBookingUrl });
    return { name: promo.name, slotBookingUrl: slotBookingUrl ?? null };
  },
});

/**
 * Rattrapage ponctuel (23/11) : remet en « page blanche » les leads DÉJÀ
 * rattachés à une promo avant la règle (cf. blankSlateForPromotion). Ne touche
 * pas un lead déjà retravaillé dans la promo (appel depuis son entrée) ni un
 * lead déjà remis à zéro. `npx convex run promotions:blankSlateExisting '{"promotionId":"…","dryRun":true}'`
 */
export const blankSlateExisting = internalMutation({
  args: { promotionId: v.id("promotions"), dryRun: v.boolean() },
  handler: async (ctx, { promotionId, dryRun }) => {
    const promo = await ctx.db.get(promotionId);
    if (!promo) throw new Error("Promotion introuvable.");
    const leads = await ctx.db.query("leads").withIndex("by_promotion", (q) => q.eq("promotionId", promotionId)).collect();
    const byStatus: Record<string, number> = {};
    let reset = 0, workedInPromo = 0, kept = 0;
    for (const lead of leads) {
      if (lead.deletedAt !== undefined || lead.promotionStatusBefore !== undefined || lead.status === "nouveau") continue;
      const joinedAt = lead.promotionJoinedAt ?? promo.startAt;
      const recentCall = await ctx.db
        .query("callLogs")
        .withIndex("by_lead_calledAt", (q) => q.eq("leadId", lead._id).gte("calledAt", joinedAt))
        .first();
      if (recentCall) { workedInPromo++; continue; }
      if (dryRun) {
        // Mêmes exceptions que blankSlateForPromotion, sans rien écrire.
        const keep = ["signature_en_cours", "signe"].includes(lead.status);
        if (keep) { kept++; continue; }
        byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;
        reset++;
        continue;
      }
      const patch = await blankSlateForPromotion(ctx, lead, Date.now(), promo.name);
      if (Object.keys(patch).length === 0) { kept++; continue; }
      await ctx.db.patch(lead._id, patch);
      byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;
      reset++;
    }
    return { promo: promo.name, total: leads.length, reset, byStatus, workedInPromo, kept, dryRun };
  },
});


// ---- RDV au bureau choisi par le setter (vendredi/samedi/dimanche + heure) ----

/** Configure (ou retire) la synchro GHL du créneau bureau d'une promo (`npx convex run`). */
export const setGhlSlotSync = internalMutation({
  args: {
    id: v.id("promotions"),
    sync: v.optional(v.object({
      pipelineId: v.string(), stageId: v.string(),
      dayFieldId: v.string(), hourFieldId: v.string(), labelFieldId: v.string(), startFieldId: v.string(),
      bookedWorkflowId: v.optional(v.string()),
      confirmationMailKey: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { id, sync }) => {
    const promo = await ctx.db.get(id);
    if (!promo) throw new Error("Promotion introuvable.");
    await ctx.db.patch(id, { ghlSlotSync: sync });
    return { name: promo.name, ghlSlotSync: sync ?? null };
  },
});

/**
 * Étape 1 (Velora) : vérifie le droit d'écrire (mode Explorer = lecture seule),
 * que le lead est dans une promo en cours avec créneaux bureau et que le
 * créneau est valide, puis le range sur la fiche. Renvoie ce qu'il faut pour GHL.
 */
export const setOfficeSlotByStaff = internalMutation({
  args: { leadId: v.id("leads"), day: v.string(), hour: v.number(), now: v.number(), notes: v.optional(v.string()) },
  handler: async (ctx, { leadId, day, hour, now, notes }) => {
    const user = await requireLeadWriteRole(ctx);
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) throw new Error("Prospect introuvable.");
    const promo = lead.promotionId ? await ctx.db.get(lead.promotionId) : null;
    if (!promo || promotionStatus(promo, now) !== "en_cours" || !promo.ghlSlotSync) {
      throw new Error("Ce prospect n'est pas dans une promotion en cours avec RDV au bureau.");
    }
    if (!isOfficeSlot(promo.startAt, promo.endAt, day, hour, now)) {
      throw new Error("Créneau impossible : du jeudi au samedi de 8 h à 18 h, dimanche de 8 h à 13 h, pas dans le passé.");
    }
    const changed = lead.promotionSlotDay !== day || lead.promotionSlotHour !== hour;
    // Premier créneau du prospect (aucun pris sur le site ni par un setter) :
    // l'automatisation « créneau réservé » est à lancer, une seule fois.
    const firstSlot = lead.promotionSlotDay === undefined && lead.promotionSlotWorkflow === undefined;
    if (changed) {
      await ctx.db.patch(leadId, { promotionSlotDay: day, promotionSlotHour: hour, ...(firstSlot ? { promotionSlotWorkflow: "pending" as const } : {}) });
      await logActivity(ctx, {
        action: "lead.promotion.slot", entityType: "lead", entityId: leadId, leadId,
        subject: leadLabel(lead),
        summary: `a fixé le RDV au bureau de ${leadLabel(lead)} : ${ghlSlotTexts(day, hour).creneau}`,
        details: { day, hour, before: lead.promotionSlotDay ? { day: lead.promotionSlotDay, hour: lead.promotionSlotHour ?? null } : null },
      });
    }
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.phone || "Prospect";
    const workflowPending = firstSlot || lead.promotionSlotWorkflow === "pending";
    // Remarques du setter → note contact GHL, comme pour un RDV à domicile.
    // Gardée sur la fiche jusqu'à sa création dans GHL (le renvoi la reprend).
    const [y, m, d] = day.split("-").map(Number);
    const newNote = notes !== undefined
      ? buildGhlProspectRemark({
        sector: "Bureau", firstName: lead.firstName, lastName: lead.lastName,
        addressLine: lead.addressLine, city: lead.city, postalCode: lead.postalCode,
        scheduledAt: Date.UTC(y, m - 1, d, hour) - 4 * 3_600_000,
        // En-têtes « RDV BUREAU… » / « RDV ECOI » de la note front : déjà dans l'en-tête GHL.
        notes: notes.split("\n").filter((l) => !/^RDV (BUREAU|ECOI)\b/.test(l.trim())).join("\n"),
      })
      : undefined;
    const pendingNote = newNote ?? lead.promotionGhlNote ?? null;
    // Tant que GHL n'a pas confirmé, la fiche montre « Renvoyer à GHL ».
    await ctx.db.patch(leadId, {
      promotionGhlSync: { status: "pending", at: now },
      ...(newNote ? { promotionGhlNote: newNote } : {}),
    });
    // Id contact GHL réel : ghlContactId (leads migrés, dont externalId = uuid de
    // l'ancienne base) sinon externalId (leads créés par les webhooks GHL).
    // Id contact GHL plausible (20 caractères) : un uuid de l'ancienne base n'en est pas un.
    const contactId = lead.ghlContactId ?? (lead.externalId && /^[A-Za-z0-9]{20}$/.test(lead.externalId) ? lead.externalId : null);
    const contact = {
      firstName: lead.firstName ?? undefined, lastName: lead.lastName ?? undefined,
      email: lead.email ?? undefined, phone: lead.phone ?? undefined,
      addressLine: lead.addressLine?.trim() || undefined, city: lead.city?.trim() || undefined,
      postalCode: lead.postalCode?.trim() || undefined,
    };
    // Mail « prix par écrit » : une seule fois par prospect, s'il a un e-mail.
    const mail = promo.ghlSlotSync.confirmationMailKey && lead.promotionMailSentAt === undefined && lead.email
      ? renderPromotionMail(promo.ghlSlotSync.confirmationMailKey, lead.firstName)
      : null;
    return { userId: user._id, externalId: contactId, contact, name, promoName: promo.name, sync: promo.ghlSlotSync, workflowPending, pendingNote, mail };
  },
});

/** Relie le lead à son contact GHL retrouvé ou recréé (ancien contact supprimé/fusionné). */
export const linkGhlContact = internalMutation({
  args: { leadId: v.id("leads"), contactId: v.string(), previous: v.union(v.string(), v.null()), created: v.boolean() },
  handler: async (ctx, { leadId, contactId, previous, created }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead) return;
    await ctx.db.patch(leadId, { ghlContactId: contactId });
    await logActivity(ctx, {
      action: "lead.ghl_contact_relinked", entityType: "lead", entityId: leadId, leadId,
      subject: leadLabel(lead),
      summary: `${created ? "a recréé" : "a retrouvé"} le contact GHL de ${leadLabel(lead)}${previous ? " (l'ancien n'existait plus dans GHL)" : ""}`,
      details: { previous, contactId, created },
    });
  },
});

export const markPromotionMailSent = internalMutation({
  args: { leadId: v.id("leads"), subject: v.string() },
  handler: async (ctx, { leadId, subject }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead) return;
    await ctx.db.patch(leadId, { promotionMailSentAt: Date.now() });
    await logActivity(ctx, {
      action: "lead.promotion.mail_sent", entityType: "lead", entityId: leadId, leadId,
      subject: leadLabel(lead),
      summary: `a envoyé le mail « ${subject} » à ${leadLabel(lead)}`,
      details: { subject },
    });
  },
});

export const markGhlNoteSent = internalMutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    await ctx.db.patch(leadId, { promotionGhlNote: undefined });
  },
});

export const markSlotWorkflowDone = internalMutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    await ctx.db.patch(leadId, { promotionSlotWorkflow: "done" });
  },
});

export const logOfficeSlotGhl = internalMutation({
  args: { leadId: v.id("leads"), ok: v.boolean(), created: v.boolean(), error: v.optional(v.string()), workflow: v.optional(v.boolean()) },
  handler: async (ctx, { leadId, ok, created, error, workflow }) => {
    const lead = await ctx.db.get(leadId);
    await ctx.db.patch(leadId, {
      promotionGhlSync: ok ? { status: "ok", at: Date.now() } : { status: "failed", at: Date.now(), ...(error ? { error } : {}) },
    });
    await logActivity(ctx, {
      action: ok ? "lead.promotion.ghl_confirmed" : "lead.promotion.ghl_failed", entityType: "lead", entityId: leadId, leadId,
      subject: leadLabel(lead),
      summary: ok
        ? `a envoyé le créneau de ${leadLabel(lead)} à GHL et l'a passé en « Présence confirmée »${created ? " (opportunité créée)" : ""}${workflow ? ", automatisation « créneau réservé » lancée" : ""}`
        : `n'a pas pu envoyer le créneau de ${leadLabel(lead)} à GHL : ${error ?? "erreur inconnue"}`,
      details: { created, workflow: workflow ?? false, error: error ?? null },
    });
  },
});

type GhlOpp = { id: string; pipelineId?: string };

/** false si GHL répond que le contact n'existe pas ; toute autre erreur remonte. */
async function ghlContactExists(contactId: string): Promise<boolean> {
  try {
    const r = (await ghlRequest(`/contacts/${encodeURIComponent(contactId)}`)) as { contact?: { id?: string } } | null;
    return Boolean(r?.contact?.id);
  } catch (err) {
    if (/not found/i.test(err instanceof Error ? err.message : String(err))) return false;
    throw err;
  }
}

/**
 * Bouton final « RDV au bureau » du setter : créneau rangé dans Velora, champs
 * du créneau mis à jour sur le contact GHL (billet inchangé), opportunité du
 * pipeline de la promo passée en « Présence confirmée » (créée si absente).
 * Rejouable sans risque (bouton « Réessayer l'envoi à GHL »).
 */
export const confirmOfficeSlot = action({
  args: { leadId: v.id("leads"), day: v.string(), hour: v.number(), notes: v.optional(v.string()) },
  handler: async (ctx, { leadId, day, hour, notes }): Promise<{ ghl: "ok"; created: boolean }> => {
    const info: {
      externalId: string | null; name: string; promoName: string; workflowPending: boolean; pendingNote: string | null;
      mail: { subject: string; html: string } | null;
      sync: NonNullable<Doc<"promotions">["ghlSlotSync"]>;
      contact: { firstName?: string; lastName?: string; email?: string; phone?: string; addressLine?: string; city?: string; postalCode?: string };
    } =
      await ctx.runMutation(internal.promotions.setOfficeSlotByStaff, { leadId, day, hour, now: Date.now(), ...(notes !== undefined ? { notes } : {}) });
    try {
      if (!isGhlConfigured()) throw new Error("GHL n'est pas configuré.");
      const locationId = requireGhlLocationId();
      // Contact GHL introuvable (supprimé, fusionné, jamais créé) : on le
      // retrouve par e-mail/téléphone ou on le recrée (upsert), puis on relie.
      let contactId = info.externalId;
      if (contactId && !(await ghlContactExists(contactId))) contactId = null;
      if (!contactId) {
        const c = info.contact;
        if (!c.email && !c.phone) throw new Error("ce prospect n'a ni e-mail ni téléphone pour retrouver son contact GHL.");
        const up = (await ghlRequest("/contacts/upsert", {
          method: "POST",
          body: {
            locationId, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
            address1: c.addressLine, city: c.city, postalCode: c.postalCode,
          },
        })) as { contact?: { id?: string }; new?: boolean } | null;
        const newId = up?.contact?.id;
        if (!newId) throw new Error("GHL n'a pas renvoyé de contact.");
        await ctx.runMutation(internal.promotions.linkGhlContact, { leadId, contactId: newId, previous: info.externalId, created: Boolean(up?.new) });
        contactId = newId;
      }
      info.externalId = contactId;
      const t = ghlSlotTexts(day, hour);
      const s = info.sync;
      // Adresse saisie par le setter à la fin de la qualification → fiche du
      // contact GHL (jamais d'effacement : seuls les champs remplis partent).
      const c = info.contact;
      await ghlRequest(`/contacts/${encodeURIComponent(info.externalId)}`, {
        method: "PUT",
        body: {
          ...(c.addressLine ? { address1: c.addressLine } : {}),
          ...(c.city ? { city: c.city } : {}),
          ...(c.postalCode ? { postalCode: c.postalCode } : {}),
          customFields: [
          { id: s.dayFieldId, value: t.jour },
          { id: s.hourFieldId, value: t.heure },
          { id: s.labelFieldId, value: t.creneau },
          { id: s.startFieldId, value: t.debut },
        ] },
      });
      if (info.pendingNote) {
        await ghlRequest(`/contacts/${encodeURIComponent(info.externalId)}/notes`, {
          method: "POST", body: { body: info.pendingNote },
        });
        await ctx.runMutation(internal.promotions.markGhlNoteSent, { leadId });
      }
      const found = (await ghlRequest("/opportunities/search", {
        query: { location_id: locationId, contact_id: info.externalId, pipeline_id: s.pipelineId, limit: 20 },
      })) as { opportunities?: GhlOpp[] } | null;
      const opp = (found?.opportunities ?? []).find((o) => o.pipelineId === s.pipelineId);
      if (opp) {
        await ghlRequest(`/opportunities/${encodeURIComponent(opp.id)}`, {
          method: "PUT", body: { pipelineId: s.pipelineId, pipelineStageId: s.stageId },
        });
      } else {
        await ghlRequest("/opportunities/", {
          method: "POST",
          body: {
            locationId, pipelineId: s.pipelineId, pipelineStageId: s.stageId,
            contactId: info.externalId, name: `${info.name} · ${info.promoName}`, status: "open",
          },
        });
      }
      // Présence confirmée : mail « prix par écrit » au prospect (une fois).
      if (info.mail) {
        await ghlRequest("/conversations/messages", {
          method: "POST", version: "2021-04-15",
          body: { type: "Email", contactId: info.externalId, subject: info.mail.subject, html: info.mail.html },
        });
        await ctx.runMutation(internal.promotions.markPromotionMailSent, { leadId, subject: info.mail.subject });
      }
      // Premier créneau : on lance l'automatisation GHL « créneau réservé »
      // APRÈS l'écriture des champs (elle peut s'en servir dans ses messages).
      let workflow = false;
      if (info.workflowPending && s.bookedWorkflowId) {
        await ghlRequest(`/contacts/${encodeURIComponent(info.externalId)}/workflow/${encodeURIComponent(s.bookedWorkflowId)}`, {
          method: "POST", body: {},
        });
        await ctx.runMutation(internal.promotions.markSlotWorkflowDone, { leadId });
        workflow = true;
      }
      await ctx.runMutation(internal.promotions.logOfficeSlotGhl, { leadId, ok: true, created: !opp, workflow });
      return { ghl: "ok", created: !opp };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.promotions.logOfficeSlotGhl, { leadId, ok: false, created: false, error: msg.slice(0, 300) });
      throw new Error(`Créneau enregistré dans Velora, mais l'envoi à GHL a échoué : ${msg}`);
    }
  },
});

/**
 * Rattrapage ponctuel (23/11) : leads dont le dernier envoi GHL du RDV bureau
 * a échoué AVANT que l'état soit gardé sur la fiche → promotionGhlSync failed.
 */
export const backfillGhlSyncFromLogs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("activityLog").order("desc").take(5000);
    const seen = new Set<string>();
    let failed = 0;
    for (const r of rows) {
      if (!r.leadId || (r.action !== "lead.promotion.ghl_failed" && r.action !== "lead.promotion.ghl_confirmed")) continue;
      if (seen.has(r.leadId)) continue;
      seen.add(r.leadId);
      const lead = await ctx.db.get(r.leadId);
      if (!lead || lead.promotionGhlSync !== undefined) continue;
      if (r.action === "lead.promotion.ghl_failed") {
        await ctx.db.patch(r.leadId, { promotionGhlSync: { status: "failed", at: r.at } });
        failed++;
      } else {
        await ctx.db.patch(r.leadId, { promotionGhlSync: { status: "ok", at: r.at } });
      }
    }
    return { leads: seen.size, failed };
  },
});
