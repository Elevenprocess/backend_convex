import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ensureDossier } from "./model/ensureDossier";

// ─── Seed de test scoping par rôle (TEMPORAIRE) ──────────────────────────────
// Interne uniquement (lancé via `npx convex run` avec la deploy key) : monte le
// scénario deux-équipes (A visible / B étrangère) pour vérifier qu'aucune
// donnée ne fuit entre comptes. À supprimer avec `wipe` après la campagne.

export const setup = internalMutation({
  args: {
    adminEmail: v.string(),
    setterEmail: v.string(),
    commercialEmail: v.string(),
    delivEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const byEmail = async (email: string) => {
      const u = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (!u) throw new Error(`Compte introuvable : ${email} (signup manquant)`);
      return u._id;
    };
    const adminId = await byEmail(args.adminEmail);
    const setter1 = await byEmail(args.setterEmail);
    const commercial1 = await byEmail(args.commercialEmail);
    const deliv = await byEmail(args.delivEmail);
    await ctx.db.patch(adminId, { role: "admin", name: "Admin Test" });
    await ctx.db.patch(setter1, { role: "setter", name: "Setter Test" });
    await ctx.db.patch(commercial1, { role: "commercial", name: "Commercial Test" });
    await ctx.db.patch(deliv, { role: "delivrabilite", name: "Deliv Test" });

    // Équipe B : jamais connectée, sert de « données d'autrui ».
    const setter2 = await ctx.db.insert("users", { email: "setter2@seed.velora", role: "setter", name: "Setter Autre", active: true });
    const commercial2 = await ctx.db.insert("users", { email: "commercial2@seed.velora", role: "commercial", name: "Commercial Autre", active: true });
    const technicien = await ctx.db.insert("users", { email: "tech@seed.velora", role: "technicien", name: "Tech Autre", active: true });

    const now = Date.now();
    const leadA = await ctx.db.insert("leads", {
      source: "manual", status: "rdv_pris", firstName: "Lead", lastName: "Alpha",
      phone: "+262691000001", setterId: setter1, assignedToId: commercial1, lastContactAt: now,
    });
    const leadB = await ctx.db.insert("leads", {
      source: "manual", status: "rdv_pris", firstName: "Lead", lastName: "Beta",
      phone: "+262691000002", setterId: setter2, assignedToId: commercial2, lastContactAt: now,
    });
    await ctx.db.insert("callLogs", { leadId: leadA, setterId: setter1, calledAt: now, result: "joint" });
    // setter2 a DEUX appels : rend détectable un setterStats non scopé (1 vs 2).
    await ctx.db.insert("callLogs", { leadId: leadB, setterId: setter2, calledAt: now, result: "joint" });
    await ctx.db.insert("callLogs", { leadId: leadB, setterId: setter2, calledAt: now - 3_600_000, result: "rappel_planifie" });
    // result=signe + montant : c'est du RDV que les KPI CA se dérivent.
    const rdvA = await ctx.db.insert("rdv", {
      leadId: leadA, commercialId: commercial1, scheduledAt: now - 3_600_000, locationType: "domicile",
      status: "honore", result: "signe", montantTotal: 10_000, financingType: "comptant", signatureAt: now,
    });
    const rdvB = await ctx.db.insert("rdv", {
      leadId: leadB, commercialId: commercial2, scheduledAt: now - 3_600_000, locationType: "visio",
      status: "honore", result: "signe", montantTotal: 20_000, financingType: "financement", signatureAt: now,
    });

    const projectA = await ctx.db.insert("projects", { leadId: leadA, commercialId: commercial1, name: "Projet Alpha", status: "signe" });
    const projectB = await ctx.db.insert("projects", { leadId: leadB, commercialId: commercial2, name: "Projet Beta", status: "signe" });
    await ctx.db.insert("debriefs", {
      leadId: leadA, projectId: projectA, rdvId: rdvA, commercialId: commercial1,
      outcome: "vente", montantTotal: 10_000, financingType: "comptant",
      acceptanceFactors: ["prix"], customEcheancier: false, signedAt: now,
    });
    await ctx.db.insert("debriefs", {
      leadId: leadB, projectId: projectB, rdvId: rdvB, commercialId: commercial2,
      outcome: "vente", montantTotal: 20_000, financingType: "financement",
      acceptanceFactors: ["confiance"], customEcheancier: false, signedAt: now,
    });

    const clientA = await ensureDossier(ctx, {
      leadId: leadA, projectId: projectA, montantTotal: 10_000,
      typeFinancement: "comptant", signedAt: now, actorId: adminId,
    });
    const clientB = await ensureDossier(ctx, {
      leadId: leadB, projectId: projectB, montantTotal: 20_000,
      typeFinancement: "financement", signedAt: now, actorId: adminId,
    });
    await ctx.db.patch(clientB, { technicienVtId: technicien });

    await ctx.db.insert("notifications", { userId: adminId, type: "seed", title: "Notif admin" });
    await ctx.db.insert("notifications", { userId: setter2, type: "seed", title: "Notif setter2 (ne doit fuiter nulle part)" });

    return { adminId, setter1, commercial1, deliv, setter2, commercial2, technicien, leadA, leadB, rdvA, rdvB, projectA, projectB, clientA, clientB };
  },
});

/** Purge complète des données de test (tables métier + comptes seed). */
export const wipe = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "notifications", "auditLog", "documents", "workflowSubsteps", "workflowSteps",
      "vtTechniciens", "clients", "acompteEcheances", "acompteEncaissements",
      "devis", "debriefs", "projects", "rdv", "callLogs", "leadCustomFields",
      "leadStageHistory", "leads", "referrers", "products",
    ] as const;
    let deleted = 0;
    for (const t of tables) {
      for (const row of await ctx.db.query(t).collect()) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
