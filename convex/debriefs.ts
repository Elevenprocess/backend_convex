import { mutation, query, internalMutation, internalQuery, MutationCtx } from "./_generated/server";
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
import { ensureProjectForLead, markProjectSigned } from "./model/ensureProject";
import { internal } from "./_generated/api";
import { ensureDossier } from "./model/ensureDossier";
import {
  syncFromCommercial,
  commercialSaleActiveFromLeadStatus,
} from "./model/syncFromCommercial";
import { notifyDebriefCreated } from "./model/notify";

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
  // Le débrief peut arriver avec un projectId déjà créé (front) : ensureProjectForLead
  // n'a alors PAS tourné, donc le projet est encore en "qualification". On le signe
  // ici pour qu'il bascule en délivrabilité (ensureDossier ci-dessous crée le dossier).
  if (args.projectId !== undefined) await markProjectSigned(ctx, args.projectId);
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
    await notifyDebriefCreated(ctx, {
      leadId: args.leadId, commercialId, outcome: args.outcome,
      montantTotal: args.montantTotal, rdvId: args.rdvId,
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
    await notifyDebriefCreated(ctx, {
      leadId: project.leadId, commercialId, outcome: args.outcome,
      montantTotal: args.montantTotal, rdvId: args.rdvId,
    });
    return debriefId;
  },
});

// Mappe l'outcome du débrief vers le champ `result` du RDV (RDV_RESULTS).
// en_reflexion / suivi_prevu → "reflexion" pour que le RDV reflète l'état de
// suivi (sinon le RDV restait sans result et le lead ne bougeait pas).
export function outcomeToResult(
  outcome: string,
  reason: string | undefined,
): "signe" | "reflexion" | "perdu" | "no_show" | undefined {
  if (outcome === "vente") return "signe";
  if (outcome === "en_reflexion" || outcome === "suivi_prevu") return "reflexion";
  if (outcome === "non_vente") {
    if (reason === "no_show") return "no_show";
    if (reason === "suivi_prevu") return "reflexion";
    return "perdu";
  }
  return undefined;
}

// Mappe l'outcome du débrief vers le champ `status` du RDV (RDV_STATUSES).
// Un débrief implique que le RDV a eu lieu (honore), sauf no_show et
// annulations où le contact n'est jamais venu. Utilisé par la réconciliation
// des débriefs importés (migration.reconcileRdvDebriefs) : les KPI « RDV
// honorés » filtrent sur status, pas sur result.
export function outcomeToStatus(
  outcome: string,
  reason: string | undefined,
): "honore" | "no_show" | "annule" {
  if (outcome === "non_vente") {
    if (reason === "no_show") return "no_show";
    if (reason === "contact_annule" || reason === "annulation_administrative") return "annule";
  }
  return "honore";
}

// Données du formulaire de débrief via lien magique (public, lu par l'httpAction
// après vérif du token). null si RDV introuvable ou supprimé.
export const linkReadData = internalQuery({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    const rdvRow = await ctx.db.get(args.rdvId);
    if (!rdvRow || rdvRow.deletedAt !== undefined) return null;
    const lead = rdvRow.leadId ? await ctx.db.get(rdvRow.leadId) : null;
    const commercial = rdvRow.commercialId ? await ctx.db.get(rdvRow.commercialId) : null;
    const existing = await ctx.db
      .query("debriefs")
      .withIndex("by_rdv", (q) => q.eq("rdvId", args.rdvId))
      .order("desc")
      .first();
    return {
      client: lead
        ? { firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone }
        : null,
      commercialName: commercial?.name ?? null,
      rdv: {
        id: rdvRow._id,
        scheduledAt: rdvRow.scheduledAt,
        status: rdvRow.status,
        alreadyDebriefed: rdvRow.debriefFilledAt !== undefined,
      },
      debrief: existing
        ? {
            outcome: existing.outcome,
            nonSaleReason: existing.nonSaleReason,
            reflexionReason: existing.reflexionReason,
            suiviReason: existing.suiviReason,
            objection: existing.objection,
            acceptanceFactors: existing.acceptanceFactors ?? [],
            notes: existing.notes,
            montantTotal: existing.montantTotal,
            financingType: existing.financingType,
            signedAt: existing.signedAt,
            kits: existing.kits,
            paymentSubMethod: existing.paymentSubMethod,
            financingOrg: existing.financingOrg,
            acomptePercent: existing.acomptePercent,
            acompteAmount: existing.acompteAmount,
            customEcheancier: existing.customEcheancier ?? false,
          }
        : null,
    };
  },
});

// Première ouverture du lien débrief par le commercial (GET /debrief-link/ après
// vérif du token). Idempotent : la première ouverture fait foi. Alimente le badge
// « Ouvert / Non ouvert » de l'Overview admin à côté de « Débrief envoyé ».
export const markLinkOpened = internalMutation({
  args: { rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.rdvId);
    if (!r || r.deletedAt !== undefined || r.debriefOpenedAt !== undefined) return null;
    await ctx.db.patch(args.rdvId, { debriefOpenedAt: Date.now() });
    return null;
  },
});

// Enregistre un débrief via lien magique (public, autorisé par le token vérifié
// dans l'httpAction). Miroir de createForLead(rdvId) + du patch RDV in-app, avec
// dérivation du statut lead (que le contrôleur NestJS oubliait).
export const submitViaLink = internalMutation({
  args: { outcome: debriefOutcomeValidator, ...DEBRIEF_FIELDS, rdvId: v.id("rdv") },
  handler: async (ctx, args) => {
    const rdvRow = await ctx.db.get(args.rdvId);
    if (!rdvRow || rdvRow.deletedAt !== undefined) throw new Error("Rendez-vous introuvable.");
    if (!rdvRow.leadId) throw new Error("Rendez-vous sans lead associé.");
    const leadId = rdvRow.leadId;

    // Les RDV synchronisés depuis GHL peuvent arriver SANS commercial (user GHL
    // non mappé côté Velora) : plutôt que de bloquer la soumission du débrief,
    // on retombe sur le commercial assigné au lead, sinon le compte générique
    // « Commercial ECOI » — et on répare le RDV au passage pour les flux aval
    // (échéancier, analytics, notifications).
    let commercialId = rdvRow.commercialId;
    if (!commercialId) {
      const lead = await ctx.db.get(leadId);
      commercialId = lead?.assignedToId ?? undefined;
      if (!commercialId) {
        const generic = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", "commercial@electroconceptoi.com"))
          .unique();
        commercialId = generic?._id;
      }
      if (!commercialId) throw new Error("Rendez-vous sans commercial associé.");
      await ctx.db.patch(args.rdvId, { commercialId });
    }

    // Idempotence : un lien magique peut être POSTé deux fois. Si un débrief
    // existe déjà pour ce RDV, on ne réinsère pas (sinon double débrief + double
    // notif). Le front doit basculer en édition (linkReadData.alreadyDebriefed).
    const existingDebrief = await ctx.db
      .query("debriefs")
      .withIndex("by_rdv", (q) => q.eq("rdvId", args.rdvId))
      .order("desc")
      .first();
    if (existingDebrief && existingDebrief.deletedAt === undefined) {
      return { ok: true, alreadyDebriefed: true };
    }

    // Un débrief via lien magique ne porte jamais de projectId pré-créé : on
    // bootstrappe (crée/réutilise + signe) le projet pour une vente.
    let projectId: Id<"projects"> | undefined;
    if (args.outcome === "vente") {
      projectId = await ensureProjectForLead(ctx, { leadId, commercialId });
    }

    await ctx.db.insert(
      "debriefs",
      buildDebriefDoc({ ...args, rdvId: args.rdvId }, { leadId, projectId, commercialId }) as any,
    );
    await ensureDossierForVente(ctx, {
      outcome: args.outcome, leadId, projectId, rdvId: args.rdvId,
      montantTotal: args.montantTotal, financingType: args.financingType,
      kits: args.kits, signedAt: args.signedAt, actorId: commercialId,
    });
    await syncDeliveryFromDebrief(ctx, {
      leadId, outcome: args.outcome, nonSaleReason: args.nonSaleReason ?? null,
      montantTotal: args.montantTotal ?? null, financingType: args.financingType ?? null, kits: args.kits ?? null,
    });
    await notifyDebriefCreated(ctx, {
      leadId, commercialId, outcome: args.outcome,
      montantTotal: args.montantTotal, rdvId: args.rdvId,
    });

    const now = Date.now();
    const result = outcomeToResult(args.outcome, args.nonSaleReason);
    const isVente = args.outcome === "vente";
    const rdvPatch: Record<string, unknown> = {
      result,
      debriefFilledAt: now,
      objections: args.objection,
      notes: args.notes,
      ...(args.outcome === "non_vente" ? { nonSaleReason: args.nonSaleReason } : {}),
      ...(isVente ? { montantTotal: args.montantTotal, kits: args.kits, financingType: args.financingType, signatureAt: args.signedAt } : {}),
    };
    await ctx.db.patch(args.rdvId, rdvPatch);

    // Statut lead dérivé du DÉBRIEF (autoritatif), identique au flux in-app
    // createForLead : en_reflexion / suivi_prevu → a_rappeler (deriveLeadStatus
    // via le RDV ne l'atteignait jamais).
    const derived = deriveLeadStatusFromDebrief(args.outcome, args.nonSaleReason ?? null);
    if (derived) {
      const lead = await ctx.db.get(leadId);
      if (lead && lead.status !== derived) {
        await ctx.db.patch(leadId, { status: derived });
        await insertStageHistory(ctx, {
          leadId, ghlStageName: derived, saasStatus: derived,
          assignedToId: lead.assignedToId, changedAt: now, source: "manual",
        });
      }
    }

    await ctx.scheduler.runAfter(0, internal.ghlDebriefLink.pushRdvDebriefScheduled, { rdvId: args.rdvId });
    return { ok: true };
  },
});

// Reporte le RDV vers une date future (déclenché depuis le débrief non-vente).
export const rescheduleViaLink = internalMutation({
  args: { rdvId: v.id("rdv"), scheduledAt: v.number() },
  handler: async (ctx, args) => {
    const rdvRow = await ctx.db.get(args.rdvId);
    if (!rdvRow || rdvRow.deletedAt !== undefined) throw new Error("Rendez-vous introuvable.");
    await ctx.db.patch(args.rdvId, {
      scheduledAt: args.scheduledAt,
      status: "reporte",
      result: "reporte",
      debriefFilledAt: undefined,
      debriefDueAt: undefined,
    });
    return { ok: true };
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
    const user = await requireRole(ctx, [...COMMERCIAL]);
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

    if (existing.leadId) {
      let updated = (await ctx.db.get(args.debriefId))!;

      // Transition vers vente via édition : provisionne projet + dossier + notif,
      // à parité avec createForLead (une vente saisie en édition doit exister en
      // délivrabilité — sinon le dossier n'était jamais créé).
      if (updated.outcome === "vente" && existing.outcome !== "vente") {
        let projectId = updated.projectId;
        if (!projectId) {
          projectId = await ensureProjectForLead(ctx, {
            leadId: existing.leadId, commercialId: existing.commercialId,
          });
          await ctx.db.patch(args.debriefId, { projectId });
          updated = (await ctx.db.get(args.debriefId))!;
        }
        await ensureDossierForVente(ctx, {
          outcome: "vente", leadId: existing.leadId, projectId,
          rdvId: updated.rdvId, montantTotal: updated.montantTotal,
          financingType: updated.financingType, kits: updated.kits,
          signedAt: updated.signedAt, actorId: user._id,
        });
        await notifyDebriefCreated(ctx, {
          leadId: existing.leadId, commercialId: existing.commercialId,
          outcome: "vente", montantTotal: updated.montantTotal, rdvId: updated.rdvId,
        });
      }

      // Propage l'état commercial effectif vers le dossier délivrabilité.
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
