import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { callResultValidator } from "./model/enums";
import type { CallResult, LeadStatus } from "./model/enums";
import { requireUser, requireLeadWriteRole, roleOf } from "./model/access";
import { insertStageHistory } from "./model/stageHistory";

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

const LONG_TERM_RELANCE_CALL_DAYS = 11;
const LONG_TERM_RELANCE_ELIGIBLE: ReadonlySet<LeadStatus> = new Set([
  "a_rappeler", "pas_de_reponse", "relance",
]);
const DOWNSTREAM_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "signe", "signature_en_cours", "devis_en_cours",
]);

async function leadHasDownstreamProject(ctx: MutationCtx, leadId: Id<"leads">): Promise<boolean> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  return projects.some(
    (p) => p.deletedAt === undefined && DOWNSTREAM_PROJECT_STATUSES.has(p.status),
  );
}

// Nombre de jours calendaires distincts (UTC) où le lead a été appelé.
async function countDistinctCallDays(ctx: MutationCtx, leadId: Id<"leads">): Promise<number> {
  const rows = await ctx.db
    .query("callLogs")
    .withIndex("by_lead_calledAt", (q) => q.eq("leadId", leadId))
    .collect();
  const days = new Set(rows.map((r) => Math.floor(r.calledAt / 86_400_000)));
  return days.size;
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
    // On ne régresse jamais un lead terminal, ni un lead avec un projet aval.
    if (
      derivedStatus &&
      !TERMINAL_LEAD_STATUSES.has(lead.status) &&
      !(await leadHasDownstreamProject(ctx, args.leadId))
    ) {
      // Auto-promotion « relance » : ≥11 jours d'appels distincts, mais seulement
      // pour une action de relance (jamais sur une décision explicite refus/joint).
      if (
        LONG_TERM_RELANCE_ELIGIBLE.has(derivedStatus) &&
        (await countDistinctCallDays(ctx, args.leadId)) >= LONG_TERM_RELANCE_CALL_DAYS
      ) {
        derivedStatus = "relance";
      }
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
