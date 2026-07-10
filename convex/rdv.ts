import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  rdvLocationValidator, rdvStatusValidator, rdvResultValidator, financingTypeValidator,
} from "./model/enums";
import { requireRole, assertCommercialRole, requireUser } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";
import { deriveLeadStatus } from "./model/deriveLeadStatus";
import { notifyRdvReceptionFlag } from "./model/notify";

export const OPEN_RDV_STATUSES = ["planifie", "reporte"] as const;
export const COMMERCIAL = ["admin", "commercial", "commercial_lead"] as const;
// Accueil : reçoit les annulations/reports par appel ou WhatsApp sur le numéro
// central et les signale au commercial. Distinct des rôles commerciaux qui, eux,
// gèrent le débrief via rdv.update.
export const RECEPTION = ["admin", "responsable_technique", "back_office"] as const;

export const create = mutation({
  args: {
    leadId: v.id("leads"),
    commercialId: v.optional(v.id("users")),
    scheduledAt: v.optional(v.number()),
    locationType: v.optional(rdvLocationValidator),
    externalId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);

    const open = await ctx.db
      .query("rdv")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    if (
      open.some(
        (r) =>
          r.deletedAt === undefined &&
          (OPEN_RDV_STATUSES as readonly string[]).includes(r.status),
      )
    ) {
      throw new Error(
        "Un RDV ouvert existe déjà pour ce lead ; termine-le avant d'en créer un nouveau.",
      );
    }

    if (args.commercialId) await assertCommercialRole(ctx, args.commercialId);

    const rdvId = await ctx.db.insert("rdv", {
      leadId: args.leadId,
      commercialId: args.commercialId,
      scheduledAt: args.scheduledAt,
      locationType: args.locationType ?? "domicile",
      status: "planifie",
      externalId: args.externalId,
      notes: args.notes,
    });

    const lead = await ctx.db.get(args.leadId);
    if (lead && lead.status !== "qualifie") {
      await ctx.db.patch(args.leadId, {
        status: "qualifie",
        ...(args.commercialId ? { assignedToId: args.commercialId } : {}),
      });
      await insertStageHistory(ctx, {
        leadId: args.leadId,
        ghlStageName: "qualifie",
        saasStatus: "qualifie",
        assignedToId: args.commercialId ?? lead.assignedToId,
        changedAt: Date.now(),
        source: "manual",
      });
    } else if (lead && args.commercialId && lead.assignedToId !== args.commercialId) {
      await ctx.db.patch(args.leadId, { assignedToId: args.commercialId });
    }

    return rdvId;
  },
});

/**
 * Signalement par l'accueil (RECEPTION) d'une annulation ou d'un report de RDV
 * transmis par le prospect sur le numéro central (appel / WhatsApp). Met à jour
 * le statut du RDV ET alerte immédiatement le commercial concerné (notification
 * in-app + push côté front). N'exige PAS un rôle commercial : c'est justement
 * l'accueil qui déclenche à la place du commercial.
 */
export const flagByReception = mutation({
  args: {
    rdvId: v.id("rdv"),
    kind: v.union(v.literal("annule"), v.literal("reporte")),
    reason: v.optional(v.string()),
    // Report vers une nouvelle date (ms). Optionnel : un report sans date connue
    // laisse le RDV en statut « reporte » (à replanifier).
    newScheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, [...RECEPTION]);
    const existing = await ctx.db.get(args.rdvId);
    if (!existing) throw new Error("RDV introuvable");
    if (existing.deletedAt !== undefined) throw new Error("RDV supprimé");

    const now = Date.now();
    const patch: Record<string, unknown> = {
      cancelReason: args.reason,
      receptionAlertAt: now,
      receptionAlertKind: args.kind,
      receptionAlertBy: actor._id,
    };

    // Report vers une date future → on replanifie (RDV ré-ouvert à la nouvelle date).
    const replan = args.kind === "reporte" && args.newScheduledAt !== undefined && args.newScheduledAt > now;
    if (args.kind === "annule") {
      patch.status = "annule";
    } else if (replan) {
      patch.status = "planifie";
      patch.scheduledAt = args.newScheduledAt;
      patch.result = undefined;
      patch.debriefFilledAt = undefined;
      patch.debriefDueAt = undefined;
    } else {
      patch.status = "reporte";
    }

    await ctx.db.patch(args.rdvId, patch);

    // Dérive le statut du lead (annule → perdu ; reporte sans date → a_rappeler).
    // On ne touche pas au lead lors d'une replanification (le RDV reste ouvert).
    if (!replan && existing.leadId) {
      const derived = deriveLeadStatus(patch.status as "annule" | "reporte", null);
      if (derived) {
        const lead = await ctx.db.get(existing.leadId);
        if (lead && lead.status !== derived) {
          await ctx.db.patch(existing.leadId, { status: derived });
          await insertStageHistory(ctx, {
            leadId: existing.leadId,
            ghlStageName: derived,
            saasStatus: derived,
            assignedToId: lead.assignedToId,
            changedAt: now,
            source: "manual",
          });
        }
      }
    }

    // Alerte le commercial concerné (best-effort, ne bloque pas le signalement).
    await notifyRdvReceptionFlag(ctx, {
      rdvId: args.rdvId,
      kind: args.kind,
      reason: args.reason,
      newScheduledAt: replan ? args.newScheduledAt : undefined,
    });
    return null;
  },
});

export const update = mutation({
  args: {
    rdvId: v.id("rdv"),
    status: v.optional(rdvStatusValidator),
    result: v.optional(v.union(rdvResultValidator, v.null())),
    scheduledAt: v.optional(v.number()),
    montantTotal: v.optional(v.number()),
    financingType: v.optional(financingTypeValidator),
    objections: v.optional(v.string()),
    nonSaleReason: v.optional(v.string()),
    kits: v.optional(v.string()),
    notes: v.optional(v.string()),
    debriefFilledAt: v.optional(v.number()),
    signatureAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const existing = await ctx.db.get(args.rdvId);
    if (!existing) throw new Error("RDV introuvable");

    const now = Date.now();
    const patch: Record<string, unknown> = {};
    if (args.status !== undefined) patch.status = args.status;
    if (args.result !== undefined) patch.result = args.result ?? undefined; // null → efface
    if (args.scheduledAt !== undefined) patch.scheduledAt = args.scheduledAt;
    if (args.montantTotal !== undefined) patch.montantTotal = args.montantTotal;
    if (args.financingType !== undefined) patch.financingType = args.financingType;
    if (args.objections !== undefined) patch.objections = args.objections;
    if (args.nonSaleReason !== undefined) patch.nonSaleReason = args.nonSaleReason;
    if (args.kits !== undefined) patch.kits = args.kits;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.signatureAt !== undefined) patch.signatureAt = args.signatureAt;
    if (args.debriefFilledAt !== undefined) patch.debriefFilledAt = args.debriefFilledAt;

    // valeurs effectives (selon args, sinon existant)
    const effStatus = args.status !== undefined ? args.status : existing.status;
    const effResult = args.result !== undefined ? (args.result ?? null) : (existing.result ?? null);

    // Re-planification : report vers une date future
    const isReport = args.result === "reporte" || args.status === "reporte";
    const toFuture = args.scheduledAt !== undefined && args.scheduledAt > now;
    let replan = false;
    if (isReport && toFuture) {
      replan = true;
      patch.status = "planifie";
      patch.result = undefined;
      patch.debriefFilledAt = undefined;
      patch.debriefDueAt = undefined;
    }

    // Auto-remplit debriefFilledAt quand un result non-reporte est saisi
    if (!replan && args.result && args.result !== "reporte"
        && args.debriefFilledAt === undefined && existing.debriefFilledAt === undefined) {
      patch.debriefFilledAt = now;
    }

    // Débrief dû : passage à honore sans result/fill
    if (!replan && effStatus === "honore" && effResult === null
        && patch.debriefFilledAt === undefined && existing.debriefFilledAt === undefined
        && existing.debriefDueAt === undefined) {
      patch.debriefDueAt = now;
    }

    await ctx.db.patch(args.rdvId, patch);

    // Dérive le statut du lead (sauf en re-planification)
    if (!replan && existing.leadId) {
      const derived = deriveLeadStatus(effStatus, effResult);
      if (derived) {
        const lead = await ctx.db.get(existing.leadId);
        if (lead && lead.status !== derived) {
          await ctx.db.patch(existing.leadId, { status: derived });
          await insertStageHistory(ctx, {
            leadId: existing.leadId,
            ghlStageName: derived,
            saasStatus: derived,
            assignedToId: lead.assignedToId,
            changedAt: now,
            source: "manual",
          });
        }
      }
    }
    return null;
  },
});

export const get = query({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db.get(args.rdvId);
  },
});

// RDV d'un lead via l'index by_lead : la fiche client / page projet n'a besoin
// que de ceux-là. Avant, le front paginait TOUTE la table rdv (rdv:list ne
// filtrait pas par lead) puis filtrait côté client — la page projet chargeait
// des milliers de lignes pour en garder 2-3.
export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("rdv")
      .withIndex("by_lead", (ix) => ix.eq("leadId", args.leadId))
      .collect();
    return rows
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => (b.scheduledAt ?? b._creationTime) - (a.scheduledAt ?? a._creationTime));
  },
});

export const list = query({
  args: {
    commercialId: v.optional(v.id("users")),
    status: v.optional(rdvStatusValidator),
    result: v.optional(rdvResultValidator),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let q;
    if (args.commercialId !== undefined) {
      q = ctx.db.query("rdv").withIndex("by_commercial_scheduled", (ix) => ix.eq("commercialId", args.commercialId!));
    } else if (args.status !== undefined) {
      q = ctx.db.query("rdv").withIndex("by_status", (ix) => ix.eq("status", args.status!));
    } else {
      q = ctx.db.query("rdv").withIndex("by_scheduledAt");
    }
    let ordered = q.order("desc").filter((f) => f.eq(f.field("deletedAt"), undefined));
    if (args.status !== undefined && args.commercialId !== undefined) {
      ordered = ordered.filter((f) => f.eq(f.field("status"), args.status!));
    }
    if (args.result !== undefined) ordered = ordered.filter((f) => f.eq(f.field("result"), args.result!));
    if (args.from !== undefined) ordered = ordered.filter((f) => f.gte(f.field("scheduledAt"), args.from!));
    if (args.to !== undefined) ordered = ordered.filter((f) => f.lte(f.field("scheduledAt"), args.to!));
    const page = await ordered.paginate(args.paginationOpts);
    // Résumé lead embarqué : l'Overview affiche nom/ville/téléphone/setter du
    // prospect sans dépendre de la liste /leads (bornée à 500 côté client). Sans
    // ça, un lead qualifié hors du top-500 s'affichait « Prospect qualifié »
    // sans coordonnées. get ciblé par RDV de la page (volume borné à paginationOpts).
    const withLead = await Promise.all(
      page.page.map(async (r) => {
        const lead = await ctx.db.get(r.leadId);
        return {
          ...r,
          lead: lead
            ? {
                id: lead._id,
                firstName: lead.firstName ?? null,
                lastName: lead.lastName ?? null,
                city: lead.city ?? null,
                phone: lead.phone ?? null,
                email: lead.email ?? null,
                setterId: lead.setterId ?? null,
              }
            : null,
        };
      }),
    );
    return { ...page, page: withLead };
  },
});

export const awaitingDebrief = query({
  args: { commercialId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("rdv")
      .withIndex("by_debriefDue", (ix) => ix.gt("debriefDueAt", 0))
      .collect();
    return rows.filter(
      (r) =>
        r.deletedAt === undefined &&
        r.debriefFilledAt === undefined &&
        (args.commercialId === undefined || r.commercialId === args.commercialId),
    );
  },
});
