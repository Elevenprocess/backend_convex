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
import { action, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireHermesKey } from "./model/hermesAuth";
import { signDebriefToken } from "./model/debriefLinkToken";

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
    return null;
  },
});
