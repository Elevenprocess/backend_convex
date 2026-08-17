/**
 * Envoi des liens débrief aux commerciaux via l'agent Hermes (VPS) — ELE-8.
 *
 * Le canal email reste GHL (champ contact `lien_debrief` + workflow, boutons
 * HTML). Ici : la surface WhatsApp/SMS. L'agent Hermes poll `due` (clé
 * HERMES_API_KEY, fail-closed), envoie le lien brut au téléphone du
 * commercial, puis acquitte avec `markSent` (pose rdv.debriefNotifiedAt,
 * anti-doublon). Sans acquittement, le RDV ressort au poll suivant.
 */

import { v } from "convex/values";
import { action, internalAction, internalQuery, mutation, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireHermesKey } from "./model/hermesAuth";
import { logSystemActivity, leadLabelById } from "./model/activity";
import { signDebriefToken } from "./model/debriefLinkToken";
import { ghlRequest, isGhlConfigured } from "./ghlClient";

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Même défaut que http.ts (frontendBase, privé au routeur HTTP).
function frontendBase(): string {
  return (process.env.FRONTEND_URL ?? "https://velora.electroconceptoi.com")
    .split(",")[0].trim().replace(/\/$/, "");
}

// Même chaîne de secrets que ghlDebriefLink.
function debriefSecret(): string {
  return process.env.DEBRIEF_LINK_SECRET || process.env.BETTER_AUTH_SECRET || "";
}

type DueRow = {
  rdvId: string;
  scheduledAt: number | null;
  status: string;
  commercial: { id: string; name: string | null; phone: string | null; email: string | null };
  lead: { firstName: string | null; lastName: string | null; city: string | null };
};

/**
 * RDV passés dont le débrief n'est ni rempli ni déjà notifié par Hermes.
 * `annule`/`reporte` exclus (le RDV n'a pas eu lieu tel quel), ainsi que les
 * RDV sans commercial ou dont le commercial est supprimé/inactif.
 */
export const dueRows = internalQuery({
  args: { fromMs: v.number(), toMs: v.number(), limit: v.number() },
  handler: async (ctx, args): Promise<DueRow[]> => {
    const rows = await ctx.db
      .query("rdv")
      .withIndex("by_scheduledAt", (q) => q.gte("scheduledAt", args.fromMs).lte("scheduledAt", args.toMs))
      .collect();
    const out: DueRow[] = [];
    for (const r of rows) {
      if (r.deletedAt !== undefined || r.debriefFilledAt !== undefined || r.debriefNotifiedAt !== undefined) continue;
      if (r.status === "annule" || r.status === "reporte") continue;
      if (r.commercialId === undefined) continue;
      const commercial = await ctx.db.get(r.commercialId);
      if (!commercial || commercial.deletedAt !== undefined || commercial.active === false) continue;
      const lead = await ctx.db.get(r.leadId);
      if (!lead || lead.deletedAt !== undefined) continue;
      out.push({
        rdvId: r._id,
        scheduledAt: r.scheduledAt ?? null,
        status: r.status,
        commercial: {
          id: commercial._id,
          name: commercial.name ?? null,
          phone: commercial.phone ?? null,
          email: commercial.email ?? null,
        },
        lead: {
          firstName: lead.firstName ?? null,
          lastName: lead.lastName ?? null,
          city: lead.city ?? null,
        },
      });
      if (out.length >= args.limit) break;
    }
    return out;
  },
});

/**
 * Débriefs à envoyer, avec lien magique signé (permanent, comme le flux GHL).
 * Action (et pas query) : la signature HMAC passe par crypto.subtle.
 */
export const due = action({
  args: {
    apiKey: v.string(),
    lookbackDays: v.optional(v.number()),
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<DueRow & { link: string }>> => {
    requireHermesKey(args.apiKey);
    const secret = debriefSecret();
    if (!secret) throw new Error("DEBRIEF_LINK_SECRET / BETTER_AUTH_SECRET manquant");
    const now = args.now ?? Date.now();
    const lookbackMs = Math.max(1, args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 86_400_000;
    const rows: DueRow[] = await ctx.runQuery(internal.hermesDebrief.dueRows, {
      fromMs: now - lookbackMs,
      toMs: now,
      limit: Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    });
    const base = frontendBase();
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        link: `${base}/#/debrief/${encodeURIComponent(await signDebriefToken(r.rdvId, secret))}`,
      })),
    );
  },
});

/**
 * Ligne d'envoi pour un RDV précis (flux webhook GHL → relais Hermes).
 * Mêmes exclusions que dueRows ; debriefNotifiedAt posé → null (anti-doublon
 * si le workflow GHL re-déclenche).
 */
export const rowForRdv = internalQuery({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args): Promise<DueRow | null> => {
    const r = await ctx.db.get(args.rdvId);
    if (!r || r.deletedAt !== undefined || r.debriefFilledAt !== undefined || r.debriefNotifiedAt !== undefined) return null;
    if (r.status === "annule" || r.status === "reporte") return null;
    if (r.commercialId === undefined) return null;
    const commercial = await ctx.db.get(r.commercialId);
    if (!commercial || commercial.deletedAt !== undefined || commercial.active === false) return null;
    const lead = await ctx.db.get(r.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    return {
      rdvId: r._id,
      scheduledAt: r.scheduledAt ?? null,
      status: r.status,
      commercial: {
        id: commercial._id,
        name: commercial.name ?? null,
        phone: commercial.phone ?? null,
        email: commercial.email ?? null,
      },
      lead: {
        firstName: lead.firstName ?? null,
        lastName: lead.lastName ?? null,
        city: lead.city ?? null,
      },
    };
  },
});

// Id GHL du rendez-vous (bi-famille d'ids, cf. persistGhlEvents) et ghlUserId
// du commercial actuellement stocké — de quoi détecter une réattribution GHL.
export const rdvGhlInfo = internalQuery({
  args: { rdvId: v.id("rdv") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ghlEventId: string | null; commercialGhlUserId: string | null } | null> => {
    const r = await ctx.db.get(args.rdvId);
    if (!r || r.deletedAt !== undefined) return null;
    const commercial = r.commercialId !== undefined ? await ctx.db.get(r.commercialId) : null;
    return {
      ghlEventId: r.ghlEventId ?? r.externalId ?? null,
      commercialGhlUserId: commercial?.ghlUserId ?? null,
    };
  },
});

// Compte Velora actif relié à un utilisateur GHL. Scan complet : users est
// petite et ghlUserId n'a pas d'index (même approche que mappedCommercials).
export const userByGhlUserId = internalQuery({
  args: { ghlUserId: v.string() },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> } | null> => {
    const users = await ctx.db.query("users").collect();
    const match = users.find(
      (u) => u.ghlUserId === args.ghlUserId && u.deletedAt === undefined && u.active !== false,
    );
    return match ? { userId: match._id } : null;
  },
});

/**
 * Réattributions faites côté Eleven Process (GHL) : relit l'assignedUserId du
 * rendez-vous au moment de l'envoi et réaligne rdv.commercialId (+ owner du
 * lead) si un autre commercial a été attribué depuis la dernière sync — le
 * débrief part alors vers le nouveau commercial. Best-effort : GHL injoignable
 * ou nouveau commercial non mappé → on garde le commercial connu.
 */
async function refreshCommercialFromGhl(ctx: ActionCtx, rdvId: Id<"rdv">): Promise<void> {
  if (!isGhlConfigured()) return;
  try {
    const info = await ctx.runQuery(internal.hermesDebrief.rdvGhlInfo, { rdvId });
    if (!info?.ghlEventId) return;
    const raw = (await ghlRequest(
      `/calendars/events/appointments/${encodeURIComponent(info.ghlEventId)}`,
    )) as { appointment?: { assignedUserId?: string } } | null;
    const assigned = raw?.appointment?.assignedUserId;
    if (!assigned || assigned === info.commercialGhlUserId) return;
    const mapped = await ctx.runQuery(internal.hermesDebrief.userByGhlUserId, { ghlUserId: assigned });
    if (!mapped) return;
    await ctx.runMutation(internal.ghlAppointments.applyReassignment, {
      rdvId,
      commercialId: mapped.userId,
    });
    console.log(`Débrief ${rdvId} : commercial réaligné sur l'attribution GHL (${assigned}).`);
  } catch (err) {
    console.warn(
      `Réalignement commercial GHL avant débrief ${rdvId} ignoré : ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Signature HMAC-SHA256 hex (style GitHub X-Hub-Signature-256) attendue par
// le gateway webhook Hermes. crypto.subtle : runtime Convex sans crypto Node.
async function hmacSha256Hex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Relais événementiel vers l'agent Hermes du VPS (route /webhooks/veloradebrief).
 * Planifié par la route /webhooks/ghl/debrief-link : GHL déclenche en fin de
 * RDV, l'agent envoie le WhatsApp au commercial et acquitte via markSent.
 * No-op si HERMES_WEBHOOK_URL / HERMES_WEBHOOK_SECRET absents. Best-effort :
 * un échec réseau ne casse jamais le flux GHL (le RDV reste dans `due`).
 */
export const notifyAgent = internalAction({
  args: { rdvId: v.id("rdv"), link: v.string() },
  handler: async (ctx, args) => {
    const url = process.env.HERMES_WEBHOOK_URL;
    const secret = process.env.HERMES_WEBHOOK_SECRET;
    if (!url || !secret) return null;
    await refreshCommercialFromGhl(ctx, args.rdvId);
    const row: DueRow | null = await ctx.runQuery(internal.hermesDebrief.rowForRdv, { rdvId: args.rdvId });
    if (!row) return null;
    const body = JSON.stringify({ event: "debrief.send", ...row, link: args.link });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(body, secret)}`,
        },
        body,
      });
      if (!res.ok) console.warn(`Relais Hermes débrief ${args.rdvId} : HTTP ${res.status}`);
    } catch (err) {
      console.warn(`Relais Hermes débrief ${args.rdvId} échoué : ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  },
});

// Un RDV dure 1h30 et le workflow GHL déclenche l'envoi ~30 min après la fin.
// Un débrief est « en retard » (le flux événementiel l'a raté : webhook perdu,
// envoi échoué…) seulement passé ce délai + une marge.
const RDV_DURATION_MS = 90 * 60_000;
const EVENT_CHAIN_GRACE_MS = 45 * 60_000;
const OVERDUE_AFTER_MS = RDV_DURATION_MS + EVENT_CHAIN_GRACE_MS;
const CATCHUP_LOOKBACK_MS = 24 * 3_600_000;
// Rythme d'envoi : jamais de rafale (risque de blocage du compte WhatsApp par
// Meta) — 2 relais max par passage de cron, espacés de 3 min.
const CATCHUP_MAX_PER_RUN = 2;
const CATCHUP_STAGGER_MS = 3 * 60_000;

/**
 * Sélection pure des débriefs à relayer par le cron de rattrapage : les RDV
 * finis depuis assez longtemps pour que le flux événementiel ait eu sa chance.
 * Un téléphone Velora vide n'exclut plus : l'agent Hermes retrouve le numéro
 * via le profil GHL, et sans lui ces débriefs restaient bloqués sans fin.
 */
export function pickOverdueForRelay(rows: DueRow[], now: number): DueRow[] {
  return rows
    .filter((r) => r.scheduledAt !== null && r.scheduledAt + OVERDUE_AFTER_MS <= now)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))
    .slice(0, CATCHUP_MAX_PER_RUN);
}

/**
 * Filet de sécurité du flux événementiel (cron 30 min) : tout débrief des
 * dernières 24 h resté non envoyé bien après la fin du RDV est relayé à
 * l'agent Hermes, qui garde ses garde-fous (vérif de livraison, markSent).
 * No-op si HERMES_WEBHOOK_URL absent (même bascule que notifyAgent).
 */
export const relayOverdue = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.HERMES_WEBHOOK_URL || !process.env.HERMES_WEBHOOK_SECRET) return null;
    const secret = debriefSecret();
    if (!secret) return null;
    const now = Date.now();
    const rows: DueRow[] = await ctx.runQuery(internal.hermesDebrief.dueRows, {
      fromMs: now - CATCHUP_LOOKBACK_MS,
      toMs: now,
      limit: MAX_LIMIT,
    });
    const picked = pickOverdueForRelay(rows, now);
    const base = frontendBase();
    for (let i = 0; i < picked.length; i++) {
      const r = picked[i];
      const link = `${base}/#/debrief/${encodeURIComponent(await signDebriefToken(r.rdvId, secret))}`;
      // rowForRdv re-vérifie debriefNotifiedAt au moment du relais : pas de
      // doublon si le flux événementiel passe entre-temps.
      await ctx.scheduler.runAfter(i * CATCHUP_STAGGER_MS, internal.hermesDebrief.notifyAgent, {
        rdvId: r.rdvId as any,
        link,
      });
    }
    if (picked.length > 0) {
      console.log(`Rattrapage Hermes : ${picked.length} débrief(s) relayé(s) (${rows.length} dus sur 24 h).`);
    }
    return null;
  },
});

/**
 * Acquittement d'envoi par l'agent Hermes. Idempotent : un RDV déjà notifié
 * n'est pas re-stampé (le premier envoi fait foi).
 */
export const markSent = mutation({
  args: { apiKey: v.string(), rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    requireHermesKey(args.apiKey);
    const r = await ctx.db.get(args.rdvId);
    if (!r || r.deletedAt !== undefined) throw new Error("RDV introuvable");
    if (r.debriefNotifiedAt !== undefined) return null;
    await ctx.db.patch(args.rdvId, { debriefNotifiedAt: Date.now() });
    {
      const { subject } = await leadLabelById(ctx, r.leadId);
      await logSystemActivity(ctx, {
        source: "Débrief WhatsApp", action: "rdv.debrief_link_sent", entityType: "rdv", entityId: args.rdvId,
        leadId: r.leadId, subject,
        summary: `Lien de débrief WhatsApp envoyé au commercial pour le RDV de ${subject}`,
        details: { commercialId: r.commercialId ?? null },
      });
    }
    return null;
  },
});
