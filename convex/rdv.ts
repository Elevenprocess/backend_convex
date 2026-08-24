import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  rdvLocationValidator, rdvStatusValidator, rdvResultValidator, financingTypeValidator,
} from "./model/enums";
import { requireRole, assertCommercialRole, requireUser } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";
import { refreshLeadAgg } from "./model/leadAgg";
import { deriveLeadStatus } from "./model/deriveLeadStatus";
import { notifyRdvReceptionFlag } from "./model/notify";
import {
  logActivity, leadLabelById, userLabelById, RDV_STATUS_LABEL, RDV_RESULT_LABEL, label,
  fmtDateTime, fmtEur, diffFields, fieldsSentence,
} from "./model/activity";

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

    {
      const { subject } = await leadLabelById(ctx, args.leadId);
      const commercialName = args.commercialId ? await userLabelById(ctx, args.commercialId) : null;
      const bits = [args.scheduledAt ? `le ${fmtDateTime(args.scheduledAt)}` : "sans date"];
      if (commercialName) bits.push(`commercial : ${commercialName}`);
      await logActivity(ctx, {
        action: "rdv.created", entityType: "rdv", entityId: rdvId, leadId: args.leadId,
        subject,
        summary: `a planifié un RDV avec ${subject} (${bits.join(", ")})`,
        details: {
          scheduledAt: args.scheduledAt ?? null, commercialId: args.commercialId ?? null,
          locationType: args.locationType ?? "domicile", notes: args.notes ?? null,
        },
      });
    }
    await refreshLeadAgg(ctx, args.leadId);
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

    {
      const { subject } = await leadLabelById(ctx, existing.leadId);
      const what =
        args.kind === "annule"
          ? "a signalé l'annulation du RDV"
          : replan
            ? `a signalé le report du RDV au ${fmtDateTime(args.newScheduledAt)}`
            : "a signalé le report (sans nouvelle date) du RDV";
      await logActivity(ctx, {
        action: args.kind === "annule" ? "rdv.reception_cancelled" : "rdv.reception_postponed",
        entityType: "rdv", entityId: args.rdvId, leadId: existing.leadId,
        subject,
        summary: `${what} de ${subject}${args.reason ? ` — motif : ${args.reason}` : ""}`,
        details: {
          kind: args.kind, reason: args.reason ?? null, newScheduledAt: args.newScheduledAt ?? null,
          before: { status: existing.status, scheduledAt: existing.scheduledAt ?? null },
          after: { status: patch.status, scheduledAt: (patch.scheduledAt as number | undefined) ?? existing.scheduledAt ?? null },
        },
        at: now,
      });
    }

    // Alerte le commercial concerné (best-effort, ne bloque pas le signalement).
    await notifyRdvReceptionFlag(ctx, {
      rdvId: args.rdvId,
      kind: args.kind,
      reason: args.reason,
      newScheduledAt: replan ? args.newScheduledAt : undefined,
    });
    await refreshLeadAgg(ctx, existing.leadId);
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

    {
      const diff = diffFields(existing as unknown as Record<string, unknown>, patch);
      if (diff.changed.length > 0) {
        const { subject } = await leadLabelById(ctx, existing.leadId);
        let action = "rdv.updated";
        let what: string;
        if (replan) {
          action = "rdv.rescheduled";
          what = `a reporté le RDV de ${subject} au ${fmtDateTime(args.scheduledAt)}`;
        } else if (args.status !== undefined && args.status !== existing.status) {
          action = "rdv.status_changed";
          what = `a passé le RDV de ${subject} à « ${label(RDV_STATUS_LABEL, args.status)} »`;
          if (args.result) what += ` (résultat : ${label(RDV_RESULT_LABEL, args.result)})`;
        } else if (args.result !== undefined && args.result !== (existing.result ?? null)) {
          action = "rdv.debriefed";
          what = args.result
            ? `a débriefé le RDV de ${subject} : ${label(RDV_RESULT_LABEL, args.result)}`
            : `a effacé le résultat du RDV de ${subject}`;
          if (args.montantTotal !== undefined) what += ` — ${fmtEur(args.montantTotal)}`;
        } else if (args.scheduledAt !== undefined && args.scheduledAt !== existing.scheduledAt) {
          action = "rdv.rescheduled";
          what = `a déplacé le RDV de ${subject} au ${fmtDateTime(args.scheduledAt)}`;
        } else {
          what = `a modifié le RDV de ${subject} (${fieldsSentence(diff.changed)})`;
        }
        await logActivity(ctx, {
          action, entityType: "rdv", entityId: args.rdvId, leadId: existing.leadId,
          subject, summary: what,
          details: { before: diff.before, after: diff.after },
          at: now,
        });
      }
    }

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
    await refreshLeadAgg(ctx, existing.leadId);
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

// RDV de signature uniquement (index by_signature) : la page Suivi n'a besoin
// que d'eux pour dater/chiffrer les dossiers signés. Avant, elle déroulait
// TOUTE la table rdv en pages de 200 (des milliers de lignes + résumé lead par
// ligne) pour n'en garder qu'une centaine.
export const listSignatures = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("rdv")
      .withIndex("by_signature", (ix) => ix.gt("signatureAt", 0))
      .collect();
    return rows
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => (b.signatureAt ?? 0) - (a.signatureAt ?? 0));
  },
});

// Résumé lead embarqué : l'Overview / les notifications affichent nom/ville/
// téléphone/setter du prospect sans dépendre de la liste /leads. get ciblé par
// RDV (volume borné par la page ou la fenêtre).
async function withLeadSummary(ctx: QueryCtx, rows: Doc<"rdv">[]) {
  return Promise.all(
    rows.map(async (r) => {
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
}

// Plage scheduledAt portée par l'INDEX (by_commercial_scheduled / by_scheduledAt)
// et non par un .filter() : un filtre post-index lit quand même tous les
// documents hors plage (bande passante DB facturée) et, en pagination, continue
// de balayer toute la table pour remplir la page.
function rdvRangeQuery(
  ctx: QueryCtx,
  args: { commercialId?: Id<"users">; status?: Doc<"rdv">["status"]; from?: number; to?: number },
) {
  const { from, to } = args;
  let q;
  let rangeViaIndex = true;
  if (args.commercialId !== undefined) {
    const commercialId = args.commercialId;
    q = ctx.db.query("rdv").withIndex("by_commercial_scheduled", (ix) => {
      const base = ix.eq("commercialId", commercialId);
      if (from !== undefined && to !== undefined) return base.gte("scheduledAt", from).lte("scheduledAt", to);
      if (from !== undefined) return base.gte("scheduledAt", from);
      if (to !== undefined) return base.lte("scheduledAt", to);
      return base;
    });
  } else if (args.status !== undefined) {
    rangeViaIndex = false;
    q = ctx.db.query("rdv").withIndex("by_status", (ix) => ix.eq("status", args.status!));
  } else {
    q = ctx.db.query("rdv").withIndex("by_scheduledAt", (ix) => {
      if (from !== undefined && to !== undefined) return ix.gte("scheduledAt", from).lte("scheduledAt", to);
      if (from !== undefined) return ix.gte("scheduledAt", from);
      if (to !== undefined) return ix.lte("scheduledAt", to);
      return ix;
    });
  }
  let ordered = q.order("desc").filter((f) => f.eq(f.field("deletedAt"), undefined));
  if (!rangeViaIndex) {
    if (args.from !== undefined) ordered = ordered.filter((f) => f.gte(f.field("scheduledAt"), args.from!));
    if (args.to !== undefined) ordered = ordered.filter((f) => f.lte(f.field("scheduledAt"), args.to!));
  }
  return ordered;
}

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
    let ordered = rdvRangeQuery(ctx, args);
    if (args.status !== undefined && args.commercialId !== undefined) {
      ordered = ordered.filter((f) => f.eq(f.field("status"), args.status!));
    }
    if (args.result !== undefined) ordered = ordered.filter((f) => f.eq(f.field("result"), args.result!));
    const page = await ordered.paginate(args.paginationOpts);
    return { ...page, page: await withLeadSummary(ctx, page.page) };
  },
});

// Fenêtre bornée NON paginée (notifications, agenda, analyses de période) :
// une seule souscription par jeu d'args, dédupliquée par le client Convex entre
// tous les composants qui la demandent — là où usePaginatedQuery ouvrait un
// drain complet de la table par composant (RootLayout + Topbar + Notifications).
export const listWindow = query({
  args: {
    commercialId: v.optional(v.id("users")),
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await rdvRangeQuery(ctx, args).take(Math.min(args.limit ?? 1500, 3000));
    return withLeadSummary(ctx, rows);
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
