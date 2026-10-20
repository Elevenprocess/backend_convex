/**
 * ELE-180 — Résumé quotidien des écarts de synchro (GHL ↔ Soltéo ↔ Velora)
 * envoyé en notification Velora aux destinataires SYNC_ALERT_EMAILS (sinon
 * admins). Les cas graves sont déjà alertés à chaud par recordDiscrepancy.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { alertRecipients } from "./model/syncDiscrepancies";
import { createNotification } from "./model/notify";

const DAY = 24 * 3600 * 1000;

export const openDiscrepancies = internalQuery({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const since = args.sinceMs ?? 0;
    const rows = await ctx.db.query("syncDiscrepancies").withIndex("by_lastSeen", (q) => q.gte("lastSeenAt", since)).collect();
    return rows.filter((r) => r.resolvedAt === undefined);
  },
});

export const dailyDigest = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ total: number; recipients: number }> => {
    const now = Date.now();
    const rows = (await ctx.db.query("syncDiscrepancies").withIndex("by_lastSeen", (q) => q.gte("lastSeenAt", now - DAY)).collect())
      .filter((r) => r.resolvedAt === undefined);
    if (rows.length === 0) return { total: 0, recipients: 0 };
    const byKind = new Map<string, number>();
    for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    const lines = [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `• ${k} : ${n}`);
    const sample = rows.slice(0, 10).map((r) => `- ${r.kind} — ${r.entityRef}`);
    const recipients = await alertRecipients(ctx);
    for (const userId of recipients) {
      await createNotification(ctx, {
        userId, type: "sync_discrepancy_digest",
        title: `Écarts synchro (24 h) : ${rows.length}`,
        body: [...lines, "", ...sample].join("\n").slice(0, 2000),
      });
    }
    return { total: rows.length, recipients: recipients.length };
  },
});

/** Maintenance : clôture des écarts d'un type (faux positifs) et marque leurs alertes comme lues. */
export const resolveKind = internalMutation({
  args: { kind: v.string() },
  handler: async (ctx, args): Promise<{ resolved: number; notifications: number }> => {
    const now = Date.now();
    const rows = await ctx.db.query("syncDiscrepancies").withIndex("by_kind", (q) => q.eq("kind", args.kind)).collect();
    let resolved = 0;
    for (const r of rows) if (r.resolvedAt === undefined) { await ctx.db.patch(r._id, { resolvedAt: now }); resolved++; }
    let notifications = 0;
    for (const n of await ctx.db.query("notifications").collect()) {
      if (n.type === "sync_discrepancy" && n.readAt === undefined && n.title.endsWith(args.kind)) {
        await ctx.db.patch(n._id, { readAt: now }); notifications++;
      }
    }
    return { resolved, notifications };
  },
});
