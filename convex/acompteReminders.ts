/**
 * Relances d'acomptes (cron quotidien) : pour chaque dossier vente, toute
 * tranche due (jalon franchi, non encaissée — « à encaisser » ou « en
 * retard ») déclenche une notification finances/admin, au plus une fois
 * tous les REMIND_EVERY_MS par tranche (table acompteAlerts).
 * L'alerte immédiate au franchissement du jalon reste dans notifyAcompte —
 * ici on ne fait que RELANCER ce qui traîne.
 */
import { internalMutation } from "./_generated/server";
import { assembleEcheancier } from "./model/assembleEcheancier";
import { todayReunion } from "./model/acompteGuard";
import { acompteRelanceMessage } from "./model/notifMessages";
import { createNotification } from "./model/notify";
import { roleOf } from "./model/access";

const REMIND_EVERY_MS = 3 * 24 * 3600 * 1000; // 3 jours

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const today = todayReunion(now);

    const recipients = (await ctx.db.query("users").collect()).filter(
      (u) => ["finances", "admin"].includes(roleOf(u)) && u.active !== false,
    );
    if (recipients.length === 0) return { reminded: 0 };

    const debriefs = await ctx.db
      .query("debriefs")
      .withIndex("by_outcome", (q) => q.eq("outcome", "vente"))
      .collect();

    let reminded = 0;
    for (const debrief of debriefs) {
      if (debrief.deletedAt !== undefined) continue;
      const hasMontant =
        (debrief.montantTotal != null && debrief.montantTotal > 0) ||
        (debrief.acompteAmount != null && debrief.acompteAmount > 0);
      if (!hasMontant) continue;

      const state = await assembleEcheancier(ctx, debrief, { today });
      if (!state) continue;
      const dues = state.echeances.filter(
        (e) => e.statut === "a_encaisser" || e.statut === "en_retard",
      );
      for (const due of dues) {
        const alert = await ctx.db
          .query("acompteAlerts")
          .withIndex("by_debrief_ordre", (q) =>
            q.eq("debriefId", debrief._id).eq("ordre", due.ordre),
          )
          .unique();
        if (alert && now - alert.sentAt < REMIND_EVERY_MS) continue;

        const msg = acompteRelanceMessage({
          leadName: state.clientName ?? state.projectName ?? "Client",
          label: due.label,
          montant: due.montantPrevu,
          enRetard: due.statut === "en_retard",
        });
        for (const r of recipients) {
          await createNotification(ctx, {
            userId: r._id,
            type: msg.type,
            title: msg.title,
            body: msg.body,
            payload: { debriefId: debrief._id, ordre: due.ordre, clientId: state.projectId },
          });
        }
        if (alert) await ctx.db.patch(alert._id, { sentAt: now });
        else await ctx.db.insert("acompteAlerts", { debriefId: debrief._id, ordre: due.ordre, sentAt: now });
        reminded++;
      }
    }
    return { reminded };
  },
});
