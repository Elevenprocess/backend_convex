import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { callResultValidator } from "./model/enums";
import type { CallResult, LeadStatus } from "./model/enums";
import { requireUser, requireLeadWriteRole, roleOf } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";
import { refreshLeadAgg } from "./model/leadAgg";
import { logActivity, leadLabel, CALL_RESULT_LABEL, LEAD_STATUS_LABEL, label, fmtDateTime } from "./model/activity";

// Portage de CallLogsService : le résultat d'appel dérive le statut du lead
// (c'est ce qui fait « bouger » la classification côté leads).
const TERMINAL_LEAD_STATUSES: ReadonlySet<LeadStatus> = new Set([
  "rdv_pris", "rdv_honore", "signe", "perdu",
]);

// result d'appel → statut lead quand AUCUN nextCallbackAt n'est fourni.
// (rappel_planifie + nextCallbackAt est traité à part → a_rappeler.)
const CALL_RESULT_TO_LEAD_STATUS: Partial<Record<CallResult, LeadStatus>> = {
  non_joint: "pas_de_reponse",
  messagerie: "pas_de_reponse",
  injoignable: "pas_de_reponse",
  refus: "pas_qualifie",
  joint: "qualifie",
  rdv_pris: "qualifie",
};

const DOWNSTREAM_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "signe", "signature_en_cours", "devis_en_cours",
]);

// Un RDV PLANIFIÉ (créneau réel à venir) gouverne le statut du lead : c'est le
// cycle de vie du RDV (rdv.update → deriveLeadStatus) qui le fera bouger,
// pas un simple appel de confirmation tombé sur messagerie.
// Un RDV « reporté » sans date, lui, a rendu le lead aux setters (« À
// rappeler ») : leurs appels doivent pouvoir le reclasser (sans réponse…).
async function leadHasPlannedRdv(ctx: MutationCtx, leadId: Id<"leads">): Promise<boolean> {
  const rows = await ctx.db
    .query("rdv")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  return rows.some((r) => r.deletedAt === undefined && r.status === "planifie");
}

async function leadHasDownstreamProject(ctx: MutationCtx, leadId: Id<"leads">): Promise<boolean> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  return projects.some(
    (p) => p.deletedAt === undefined && DOWNSTREAM_PROJECT_STATUSES.has(p.status),
  );
}

// Un appel fait bouger le statut du lead : réservé aux rôles commerciaux/setter.
export const logCall = mutation({
  args: {
    leadId: v.id("leads"),
    result: callResultValidator,
    durationSec: v.optional(v.number()),
    notes: v.optional(v.string()),
    nextCallbackAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireLeadWriteRole(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    const calledAt = Date.now();
    const id = await ctx.db.insert("callLogs", {
      leadId: args.leadId,
      setterId: user._id,
      calledAt,
      result: args.result,
      durationSec: args.durationSec,
      notes: args.notes,
      nextCallbackAt: args.nextCallbackAt,
    });

    // Statut dérivé : nextCallbackAt → a_rappeler, sinon mapping par result.
    let derivedStatus: LeadStatus | null = args.nextCallbackAt
      ? "a_rappeler"
      : (CALL_RESULT_TO_LEAD_STATUS[args.result] ?? null);

    const patch: Record<string, unknown> = { lastContactAt: calledAt };
    // Attribution : les leads GHL natifs arrivent sans setterId — le premier
    // setter qui traite le lead devient son setter principal (les suivants
    // restent visibles via assignedSetterIds, dérivé des callLogs).
    if (lead.setterId === undefined && ["setter", "setter_lead"].includes(roleOf(user))) {
      patch.setterId = user._id;
    }
    // On ne régresse jamais un lead terminal, un lead avec un projet aval,
    // ni un lead qualifié avec un RDV encore planifié.
    // NB : plus d'auto-promotion « relance » après 11 jours d'appels — elle
    // renvoyait un lead « pas de réponse » dans l'onglet « À rappeler » (qui
    // affiche a_rappeler + relance). La relance long terme est dérivée côté
    // liste à partir de joursRelance, le statut reste pas_de_reponse.
    if (
      derivedStatus &&
      !TERMINAL_LEAD_STATUSES.has(lead.status) &&
      !(await leadHasDownstreamProject(ctx, args.leadId)) &&
      !(await leadHasPlannedRdv(ctx, args.leadId))
    ) {
      patch.status = derivedStatus;
      if (derivedStatus === "a_rappeler" && args.nextCallbackAt) {
        patch.datePassageRelance = args.nextCallbackAt;
      }
    } else {
      derivedStatus = null; // pas de mouvement effectif
    }

    await ctx.db.patch(args.leadId, patch);
    if (derivedStatus && derivedStatus !== lead.status) {
      await insertStageHistory(ctx, {
        leadId: args.leadId,
        ghlStageName: derivedStatus,
        saasStatus: derivedStatus,
        assignedToId: lead.assignedToId,
        changedAt: calledAt,
        source: "manual",
      });
    }
    {
      const bits = [`résultat : ${label(CALL_RESULT_LABEL, args.result)}`];
      if (args.durationSec) bits.push(`${Math.round(args.durationSec / 60)} min`);
      if (args.nextCallbackAt) bits.push(`rappel le ${fmtDateTime(args.nextCallbackAt)}`);
      if (derivedStatus && derivedStatus !== lead.status) {
        bits.push(`statut → « ${label(LEAD_STATUS_LABEL, derivedStatus)} »`);
      }
      await logActivity(ctx, {
        action: "call.logged", entityType: "call", entityId: id, leadId: args.leadId,
        subject: leadLabel(lead),
        summary: `a enregistré un appel avec ${leadLabel(lead)} (${bits.join(", ")})`,
        details: {
          result: args.result, durationSec: args.durationSec ?? null,
          nextCallbackAt: args.nextCallbackAt ?? null, notes: args.notes ?? null,
          statusBefore: lead.status, statusAfter: derivedStatus ?? lead.status,
        },
        at: calledAt,
      });
    }
    await refreshLeadAgg(ctx, args.leadId);
    return id;
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db
      .query("callLogs")
      .withIndex("by_lead_calledAt", (q) => q.eq("leadId", args.leadId))
      .order("desc")
      .collect();
  },
});

// Feed d'activité d'appels d'un setter (Overview « suivi »). Limité, ordre récent.
export const listBySetter = query({
  args: { setterId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("callLogs")
      .withIndex("by_setter_calledAt", (q) => q.eq("setterId", args.setterId))
      .order("desc")
      .take(args.limit ?? 500);
    return rows;
  },
});

export const upcomingCallbacks = query({
  args: {
    now: v.number(),
    setterId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("callLogs")
      .withIndex("by_callback", (q) => q.gt("nextCallbackAt", args.now))
      .collect();
    return args.setterId ? rows.filter((r) => r.setterId === args.setterId) : rows;
  },
});
