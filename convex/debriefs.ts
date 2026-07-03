import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import {
  debriefOutcomeValidator, debriefNonSaleReasonValidator,
  debriefReflexionReasonValidator, debriefSuiviReasonValidator,
  financingTypeValidator, paymentSubMethodValidator, financingOrgValidator,
  DebriefOutcome, DebriefNonSaleReason,
} from "./model/enums";
import { requireRole, requireUser, assertCommercialRole } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";
import { deriveLeadStatusFromDebrief } from "./model/deriveLeadStatusFromDebrief";
import { ensureProjectForLead } from "./model/ensureProject";
import { ensureDossier } from "./model/ensureDossier";
import {
  syncFromCommercial,
  commercialSaleActiveFromLeadStatus,
} from "./model/syncFromCommercial";

const COMMERCIAL = ["admin", "commercial", "commercial_lead"] as const;

// Champs métier partagés createForLead / create (hors clés de rattachement).
const DEBRIEF_FIELDS = {
  rdvId: v.optional(v.id("rdv")),
  nonSaleReason: v.optional(debriefNonSaleReasonValidator),
  reflexionReason: v.optional(debriefReflexionReasonValidator),
  suiviReason: v.optional(debriefSuiviReasonValidator),
  objection: v.optional(v.string()),
  acceptanceFactors: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  montantTotal: v.optional(v.number()),
  financingType: v.optional(financingTypeValidator),
  kits: v.optional(v.string()),
  signedAt: v.optional(v.number()),
  paymentSubMethod: v.optional(paymentSubMethodValidator),
  financingOrg: v.optional(financingOrgValidator),
  acomptePercent: v.optional(v.number()),
  acompteAmount: v.optional(v.number()),
  customEcheancier: v.optional(v.boolean()),
  externalId: v.optional(v.string()),
};

type DebriefDocFields = Omit<
  Doc<"debriefs">,
  "_id" | "_creationTime" | "projectId" | "leadId" | "commercialId" | "outcome" | "deletedAt"
>;

// Construit le document débrief à insérer (clés de rattachement + champs).
function buildDebriefDoc(
  args: Record<string, unknown> & { outcome: DebriefOutcome },
  rel: { leadId?: Id<"leads">; projectId?: Id<"projects">; commercialId: Id<"users"> },
): Record<string, unknown> {
  const fields: DebriefDocFields = {
    rdvId: args.rdvId as Id<"rdv"> | undefined,
    nonSaleReason: args.nonSaleReason as DebriefDocFields["nonSaleReason"],
    reflexionReason: args.reflexionReason as DebriefDocFields["reflexionReason"],
    suiviReason: args.suiviReason as DebriefDocFields["suiviReason"],
    objection: args.objection as string | undefined,
    acceptanceFactors: (args.acceptanceFactors as string[] | undefined) ?? [],
    notes: args.notes as string | undefined,
    montantTotal: args.montantTotal as number | undefined,
    financingType: args.financingType as DebriefDocFields["financingType"],
    kits: args.kits as string | undefined,
    signedAt: args.signedAt as number | undefined,
    paymentSubMethod: args.paymentSubMethod as DebriefDocFields["paymentSubMethod"],
    financingOrg: args.financingOrg as DebriefDocFields["financingOrg"],
    acomptePercent: args.acomptePercent as number | undefined,
    acompteAmount: args.acompteAmount as number | undefined,
    customEcheancier: (args.customEcheancier as boolean | undefined) ?? false,
    externalId: args.externalId as string | undefined,
  };
  return {
    projectId: rel.projectId,
    leadId: rel.leadId,
    commercialId: rel.commercialId,
    outcome: args.outcome,
    ...fields,
  };
}

// Applique le statut lead dérivé du débrief — uniquement pour les débriefs
// DÉTACHÉS d'un RDV (avec rdvId, le flux rdv.update l'a déjà géré).
// Fidèle à DebriefsService.createForLead (`if (!dto.rdvId)`).
async function applyLeadEffect(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  outcome: DebriefOutcome,
  nonSaleReason: DebriefNonSaleReason | undefined,
  rdvId: Id<"rdv"> | undefined,
): Promise<void> {
  if (rdvId) return;
  const derived = deriveLeadStatusFromDebrief(outcome, nonSaleReason ?? null);
  const lead = await ctx.db.get(leadId);
  if (lead && lead.status !== derived) {
    await ctx.db.patch(leadId, { status: derived });
    await insertStageHistory(ctx, {
      leadId,
      ghlStageName: derived,
      saasStatus: derived,
      assignedToId: lead.assignedToId,
      changedAt: Date.now(),
      source: "manual",
    });
  }
}

// Bootstrap du dossier délivrabilité à la vente (écart assumé vs NestJS où
// c'est le modal frontend qui enchaîne : ici le débrief vente garantit le
// dossier côté serveur, idempotent via ensureDossier).
async function ensureDossierForVente(
  ctx: MutationCtx,
  args: {
    outcome: DebriefOutcome;
    leadId: Id<"leads">;
    projectId: Id<"projects"> | undefined;
    rdvId: Id<"rdv"> | undefined;
    montantTotal: number | undefined;
    financingType: Doc<"debriefs">["financingType"];
    kits: string | undefined;
    signedAt: number | undefined;
    actorId: Id<"users">;
  },
): Promise<void> {
  if (args.outcome !== "vente") return;
  await ensureDossier(ctx, {
    leadId: args.leadId,
    projectId: args.projectId,
    rdvId: args.rdvId,
    montantTotal: args.montantTotal,
    typeFinancement: args.financingType ?? undefined,
    kits: args.kits,
    signedAt: args.signedAt,
    actorId: args.actorId,
  });
}

// Miroir de DebriefsService.syncDelivery : propage l'état commercial du débrief
// vers le dossier délivrabilité EXISTANT du lead (annulation réversible +
// données dénormalisées). No-op sans dossier.
async function syncDeliveryFromDebrief(
  ctx: MutationCtx,
  args: {
    leadId: Id<"leads">;
    outcome: DebriefOutcome;
    nonSaleReason: DebriefNonSaleReason | null;
    montantTotal: number | null;
    financingType: Doc<"debriefs">["financingType"] | null;
    kits: string | null;
  },
): Promise<void> {
  const leadStatus = deriveLeadStatusFromDebrief(args.outcome, args.nonSaleReason);
  await syncFromCommercial(ctx, {
    leadId: args.leadId,
    active: commercialSaleActiveFromLeadStatus(leadStatus),
    montantTotal: args.montantTotal,
    financingType: args.financingType ?? null,
    kits: args.kits,
  });
}

export const createForLead = mutation({
  args: {
    leadId: v.id("leads"),
    outcome: debriefOutcomeValidator,
    commercialId: v.optional(v.id("users")),
    projectId: v.optional(v.id("projects")),
    ...DEBRIEF_FIELDS,
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...COMMERCIAL]);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    if (args.commercialId) await assertCommercialRole(ctx, args.commercialId);
    const commercialId = args.commercialId ?? user._id;

    let projectId = args.projectId;
    if (args.outcome === "vente" && !projectId) {
      projectId = await ensureProjectForLead(ctx, { leadId: args.leadId, commercialId });
    }

    const debriefId = await ctx.db.insert(
      "debriefs",
      buildDebriefDoc(args, { leadId: args.leadId, projectId, commercialId }) as any,
    );

    await applyLeadEffect(ctx, args.leadId, args.outcome, args.nonSaleReason, args.rdvId);
    await ensureDossierForVente(ctx, {
      outcome: args.outcome,
      leadId: args.leadId,
      projectId,
      rdvId: args.rdvId,
      montantTotal: args.montantTotal,
      financingType: args.financingType,
      kits: args.kits,
      signedAt: args.signedAt,
      actorId: user._id,
    });
    await syncDeliveryFromDebrief(ctx, {
      leadId: args.leadId,
      outcome: args.outcome,
      nonSaleReason: args.nonSaleReason ?? null,
      montantTotal: args.montantTotal ?? null,
      financingType: args.financingType ?? null,
      kits: args.kits ?? null,
    });
    return debriefId;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    outcome: debriefOutcomeValidator,
    commercialId: v.optional(v.id("users")),
    ...DEBRIEF_FIELDS,
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...COMMERCIAL]);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.deletedAt !== undefined) {
      throw new Error(`Projet ${args.projectId} introuvable`);
    }
    if (args.commercialId) await assertCommercialRole(ctx, args.commercialId);
    const commercialId = args.commercialId ?? user._id;

    const debriefId = await ctx.db.insert(
      "debriefs",
      buildDebriefDoc(args, {
        leadId: project.leadId,
        projectId: args.projectId,
        commercialId,
      }) as any,
    );

    await applyLeadEffect(ctx, project.leadId, args.outcome, args.nonSaleReason, args.rdvId);
    await ensureDossierForVente(ctx, {
      outcome: args.outcome,
      leadId: project.leadId,
      projectId: args.projectId,
      rdvId: args.rdvId,
      montantTotal: args.montantTotal,
      financingType: args.financingType,
      kits: args.kits,
      signedAt: args.signedAt,
      actorId: user._id,
    });
    await syncDeliveryFromDebrief(ctx, {
      leadId: project.leadId,
      outcome: args.outcome,
      nonSaleReason: args.nonSaleReason ?? null,
      montantTotal: args.montantTotal ?? null,
      financingType: args.financingType ?? null,
      kits: args.kits ?? null,
    });
    return debriefId;
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("debriefs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return rows
      .filter((d) => d.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("debriefs")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    return rows
      .filter((d) => d.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const get = query({
  args: { debriefId: v.id("debriefs") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await ctx.db.get(args.debriefId);
    if (!row || row.deletedAt !== undefined) return null;
    return row;
  },
});

export const update = mutation({
  args: {
    debriefId: v.id("debriefs"),
    outcome: v.optional(debriefOutcomeValidator),
    ...DEBRIEF_FIELDS,
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const existing = await ctx.db.get(args.debriefId);
    if (!existing || existing.deletedAt !== undefined) throw new Error("Débrief introuvable");

    const patch: Record<string, unknown> = {};
    const keys = [
      "outcome", "rdvId", "nonSaleReason", "reflexionReason", "suiviReason",
      "objection", "acceptanceFactors", "notes", "montantTotal", "financingType",
      "kits", "signedAt", "paymentSubMethod", "financingOrg", "acomptePercent",
      "acompteAmount", "customEcheancier", "externalId",
    ] as const;
    for (const k of keys) {
      if ((args as Record<string, unknown>)[k] !== undefined) {
        patch[k] = (args as Record<string, unknown>)[k];
      }
    }
    await ctx.db.patch(args.debriefId, patch);

    // Re-dérive le statut lead si outcome/nonSaleReason changent (détaché RDV).
    if (existing.leadId && (args.outcome !== undefined || args.nonSaleReason !== undefined)) {
      const effOutcome = args.outcome ?? existing.outcome;
      const effNonSale = args.nonSaleReason ?? existing.nonSaleReason ?? undefined;
      await applyLeadEffect(ctx, existing.leadId, effOutcome, effNonSale, existing.rdvId);
    }

    // Propage l'état commercial effectif vers le dossier délivrabilité.
    if (existing.leadId) {
      const updated = (await ctx.db.get(args.debriefId))!;
      await syncDeliveryFromDebrief(ctx, {
        leadId: existing.leadId,
        outcome: updated.outcome,
        nonSaleReason: updated.nonSaleReason ?? null,
        montantTotal: updated.montantTotal ?? null,
        financingType: updated.financingType ?? null,
        kits: updated.kits ?? null,
      });
    }
    return null;
  },
});

export const softDelete = mutation({
  args: { debriefId: v.id("debriefs") },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const existing = await ctx.db.get(args.debriefId);
    if (!existing || existing.deletedAt !== undefined) throw new Error("Débrief introuvable");
    await ctx.db.patch(args.debriefId, { deletedAt: Date.now() });
    return null;
  },
});
