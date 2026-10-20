/**
 * Journal des écarts de synchro (ELE-177 / ELE-179 / ELE-180). Règle : GHL fait
 * foi pour les RDV, Soltéo pour les ventes ; un écart est SIGNALÉ ici, jamais
 * corrigé en écrasant l'autre source. Upsert idempotent sur `key`.
 */
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createNotification } from "./notify";

/** ELE-180 : écarts graves → alerte immédiate (notification Velora). */
export const GRAVE_KINDS: ReadonlySet<string> = new Set([
  "opportunity_not_found",       // vente Soltéo sans opportunité/RDV GHL
  "vente_solteo_sans_rdv",       // vente Soltéo sans RDV dans Velora
  "vente_solteo_sans_lead",      // vente Soltéo sans lead Velora
  "ghl_signe_sans_devis_solteo", // étape 11 GHL sans devis signé Soltéo
  "amount_not_positive",
  "amount_mismatch",
  "montant_velora_diff",
]);

/** Destinataires : SYNC_ALERT_EMAILS (virgules) sinon admins actifs. */
export async function alertRecipients(ctx: MutationCtx): Promise<Id<"users">[]> {
  const emails = (process.env.SYNC_ALERT_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const users = (await ctx.db.query("users").collect()).filter(
    (u) => u.deletedAt === undefined && u.active !== false,
  );
  const picked = emails.length > 0
    ? users.filter((u) => u.email && emails.includes(u.email.toLowerCase()))
    : users.filter((u) => u.role === "admin");
  return picked.map((u) => u._id);
}

export type DiscrepancyInput = {
  key: string;
  source: "ghl_calendar" | "solteo";
  kind: string;
  entityRef: string;
  details: string;
  now: number;
};

export async function recordDiscrepancy(ctx: MutationCtx, d: DiscrepancyInput): Promise<void> {
  const existing = await ctx.db
    .query("syncDiscrepancies")
    .withIndex("by_key", (q) => q.eq("key", d.key))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      details: d.details.slice(0, 2000),
      lastSeenAt: d.now,
      count: existing.count + 1,
    });
    return;
  }
  const grave = GRAVE_KINDS.has(d.kind);
  await ctx.db.insert("syncDiscrepancies", {
    ...(grave ? { notifiedAt: d.now } : {}),
    key: d.key,
    source: d.source,
    kind: d.kind,
    entityRef: d.entityRef,
    details: d.details.slice(0, 2000),
    firstSeenAt: d.now,
    lastSeenAt: d.now,
    count: 1,
  });
  if (grave) {
    for (const userId of await alertRecipients(ctx)) {
      await createNotification(ctx, {
        userId,
        type: "sync_discrepancy",
        title: `⚠️ Écart synchro : ${d.kind}`,
        body: `${d.entityRef} — ${d.details}`.slice(0, 500),
        payload: { key: d.key, source: d.source },
      });
    }
  }
}
