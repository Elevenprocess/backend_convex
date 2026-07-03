/**
 * Création de notifications (portage de NotificationsService.createAndEmit :
 * l'insert suffit, la réactivité Convex remplace l'emit socket).
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { acompte40Message, acompteSoldeMessage, vtDateChangedMessage } from "./notifMessages";
import { roleOf } from "./access";

export async function createNotification(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    type: string;
    title: string;
    body?: string;
    payload?: unknown;
  },
): Promise<Id<"notifications">> {
  return await ctx.db.insert("notifications", {
    userId: input.userId,
    type: input.type,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  });
}

/** Best-effort : notifie le technicien assigné qu'une date de VT a changé. */
export async function notifyVtDateChange(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  nextDate: string | null,
): Promise<void> {
  try {
    const client = await ctx.db.get(clientId);
    if (!client?.technicienVtId) return;
    const lead = await ctx.db.get(client.leadId);
    const leadName =
      [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Client";
    const { title, body } = vtDateChangedMessage({ leadName, date: nextDate });
    await createNotification(ctx, {
      userId: client.technicienVtId,
      type: "vt_date_changed",
      title,
      body,
      payload: { clientId },
    });
  } catch (err) {
    // Best-effort : ne jamais bloquer la transition de sous-étape.
    console.error("[notifyVtDateChange] erreur best-effort", err);
  }
}

const SOLDE_TYPES = new Set([
  "comptant",
  "financement",
  "financement_sans_apport",
  "apport_financement",
]);

/** Best-effort : notifie finances/admin à la transition vt_validee ou install_effectuee → fait. */
export async function notifyAcompte(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  substepKey: "vt_validee" | "install_effectuee",
): Promise<void> {
  try {
    const client = await ctx.db.get(clientId);
    if (!client) return;

    // Débrief vente du lead → financingType (parité requête NestJS).
    const debriefs = await ctx.db
      .query("debriefs")
      .withIndex("by_lead", (q) => q.eq("leadId", client.leadId))
      .collect();
    const vente = debriefs.find((d) => d.outcome === "vente" && d.deletedAt === undefined);
    if (!vente?.financingType) return;

    const shouldFire40 = substepKey === "vt_validee" && vente.financingType === "comptant";
    const shouldFireSolde =
      substepKey === "install_effectuee" && SOLDE_TYPES.has(vente.financingType);
    if (!shouldFire40 && !shouldFireSolde) return;

    const lead = await ctx.db.get(client.leadId);
    const leadName =
      [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Client";

    // Destinataires : finances + admin actifs.
    const recipients = (await ctx.db.query("users").collect()).filter(
      (u) => ["finances", "admin"].includes(roleOf(u)) && u.active !== false,
    );
    if (recipients.length === 0) return;

    const msg = shouldFire40 ? acompte40Message({ leadName }) : acompteSoldeMessage({ leadName });
    for (const r of recipients) {
      await createNotification(ctx, {
        userId: r._id,
        type: msg.type,
        title: msg.title,
        body: msg.body,
        payload: { clientId },
      });
    }
  } catch (err) {
    // Best-effort : ne jamais bloquer la transition de sous-étape.
    console.error("[notifyAcompte] erreur best-effort", err);
  }
}
