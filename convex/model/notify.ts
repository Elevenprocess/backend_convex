/**
 * Création de notifications (portage de NotificationsService.createAndEmit :
 * l'insert suffit, la réactivité Convex remplace l'emit socket).
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { acompte40Message, acompteRelanceMessage, acompteSoldeMessage, acompteTrancheMessage, debriefCreatedMessage, rdvCancelledMessage, rdvRescheduledMessage, vtDateChangedMessage } from "./notifMessages";
import { acompteStateForClient, todayReunion } from "./acompteGuard";
import { roleOf } from "./access";

// Notifie chaque responsable commercial (commercial_lead actif) à la création
// d'un débrief. Best-effort, in-app (remplace le WhatsApp NestJS).
export async function notifyDebriefCreated(
  ctx: MutationCtx,
  input: {
    leadId?: Id<"leads">;
    commercialId: Id<"users">;
    outcome: string;
    montantTotal?: number;
    rdvId?: Id<"rdv">;
  },
): Promise<void> {
  const managers = (await ctx.db.query("users").collect()).filter(
    (u) => u.role === "commercial_lead" && u.active !== false && u.deletedAt === undefined,
  );
  if (managers.length === 0) return;
  const commercial = await ctx.db.get(input.commercialId);
  const commercialName = commercial?.name ?? "Un commercial";
  const msg = debriefCreatedMessage({ commercialName, outcome: input.outcome, montantTotal: input.montantTotal });
  for (const manager of managers) {
    await createNotification(ctx, {
      userId: manager._id,
      type: msg.type,
      title: msg.title,
      body: msg.body,
      payload: {
        ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
        ...(input.rdvId !== undefined ? { rdvId: input.rdvId } : {}),
      },
    });
  }
}

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

/**
 * Best-effort : alerte le commercial concerné quand l'accueil signale une
 * annulation ou un report de RDV (numéro central). Destinataire = commercial
 * du RDV, sinon commercial assigné au lead. La date de report exacte est portée
 * par le payload (formatée côté front).
 */
export async function notifyRdvReceptionFlag(
  ctx: MutationCtx,
  input: {
    rdvId: Id<"rdv">;
    kind: "annule" | "reporte";
    reason?: string;
    newScheduledAt?: number;
  },
): Promise<void> {
  try {
    const rdv = await ctx.db.get(input.rdvId);
    if (!rdv) return;
    const lead = rdv.leadId ? await ctx.db.get(rdv.leadId) : null;
    const targetId = rdv.commercialId ?? lead?.assignedToId;
    if (!targetId) return;
    const leadName =
      [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Un prospect";
    const msg =
      input.kind === "annule"
        ? rdvCancelledMessage({ leadName, reason: input.reason })
        : rdvRescheduledMessage({ leadName, reason: input.reason });
    await createNotification(ctx, {
      userId: targetId,
      type: msg.type,
      title: msg.title,
      body: msg.body,
      payload: {
        rdvId: input.rdvId,
        ...(rdv.leadId ? { leadId: rdv.leadId } : {}),
        ...(input.newScheduledAt !== undefined ? { newScheduledAt: input.newScheduledAt } : {}),
      },
    });
  } catch (err) {
    // Best-effort : ne jamais bloquer le signalement.
    console.error("[notifyRdvReceptionFlag] erreur best-effort", err);
  }
}

const SOLDE_TYPES = new Set([
  "comptant",
  "financement",
  "financement_sans_apport",
  "apport_financement",
]);

/**
 * Best-effort : notifie finances/admin quand un jalon franchi rend une ou
 * plusieurs tranches d'acompte « à encaisser ». Piloté par l'ÉCHÉANCIER réel
 * (devis / custom / template — assembleEcheancier) ; retombe sur les deux
 * messages historiques (40 % VT comptant, solde install financement) quand
 * le dossier n'a pas d'échéancier assemblable.
 */
export async function notifyAcompte(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  substepKey: string,
): Promise<void> {
  try {
    const client = await ctx.db.get(clientId);
    if (!client) return;

    // ── Chemin échéancier (source de vérité finances) ────────────────────────
    const state = await acompteStateForClient(ctx, client, todayReunion());
    if (state) {
      const dues = state.echeances.filter(
        (e) => e.jalonKey === substepKey && e.statut === "a_encaisser",
      );
      if (dues.length === 0) return;
      const recipients = (await ctx.db.query("users").collect()).filter(
        (u) => ["finances", "admin"].includes(roleOf(u)) && u.active !== false,
      );
      const leadName = state.clientName ?? "Client";
      for (const due of dues) {
        const msg = acompteTrancheMessage({
          leadName,
          label: due.label,
          montant: due.montantPrevu,
        });
        for (const r of recipients) {
          await createNotification(ctx, {
            userId: r._id,
            type: msg.type,
            title: msg.title,
            body: msg.body,
            payload: { clientId, debriefId: state.debriefId, ordre: due.ordre },
          });
        }
      }
      return;
    }

    // ── Fallback legacy (pas d'échéancier assemblable) ───────────────────────
    if (substepKey !== "vt_validee" && substepKey !== "install_effectuee") return;

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
