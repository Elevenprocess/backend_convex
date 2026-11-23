// Rattachement d'un lead à une promo par ses tags GHL. Appelé dans la même
// transaction que la création du lead (webhooks.createLeadFromWebhook) et
// par les mutations promotions.applyLeadTags / applyContactTags.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { LEAD_STATUS_LABEL, label, leadLabel, logSystemActivity } from "./activity";
import { matchPromotion, normalizeTag } from "./promotions";
import { insertStageHistory } from "./stageHistory";

// Statuts jamais remis à zéro : client réel en cours (ou déjà « nouveau »).
const KEEP_STATUSES: ReadonlySet<string> = new Set(["nouveau", "signature_en_cours", "signe"]);
const KEEP_PROJECT_STATUSES: ReadonlySet<string> = new Set(["signe", "signature_en_cours", "devis_en_cours"]);

/**
 * Une promo commence par une page blanche (Mario 23/11) : un lead qui y entre
 * (re-simulation, ancien lead ciblé…) repart de « nouveau », même s'il avait été
 * qualifié il y a longtemps. Son ancien statut est gardé dans
 * promotionStatusBefore et l'historique d'appels reste intact. Exceptions :
 * client en cours (signé, signature, devis) ou RDV à venir.
 * Renvoie le patch à fusionner dans celui du rattachement ({} = rien à changer).
 */
export async function blankSlateForPromotion(
  ctx: MutationCtx,
  lead: Doc<"leads">,
  at: number,
  promoName: string,
): Promise<Record<string, unknown>> {
  if (KEEP_STATUSES.has(lead.status)) return {};
  const rdvs = await ctx.db.query("rdv").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect();
  if (rdvs.some((r) => r.deletedAt === undefined && (r.status === "planifie" || r.status === "reporte") && (r.scheduledAt ?? 0) > at)) {
    return {};
  }
  const projects = await ctx.db.query("projects").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect();
  if (projects.some((p) => p.deletedAt === undefined && KEEP_PROJECT_STATUSES.has(p.status))) return {};

  await insertStageHistory(ctx, {
    leadId: lead._id, ghlStageName: "nouveau", saasStatus: "nouveau",
    assignedToId: lead.assignedToId, changedAt: at, source: "manual",
  });
  await logSystemActivity(ctx, {
    at, source: "Promotions", action: "lead.promotion.blank_slate", entityType: "lead", entityId: lead._id, leadId: lead._id,
    subject: leadLabel(lead),
    summary: `${leadLabel(lead)} repart de « Nouveau » pour la promotion « ${promoName} » (était « ${label(LEAD_STATUS_LABEL, lead.status)} »)`,
    details: { statusBefore: lead.status },
  });
  return { status: "nouveau", promotionStatusBefore: lead.status };
}

function sameTags(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((tag, i) => normalizeTag(tag) === normalizeTag(b[i]));
}

/**
 * Écrit ghlTags (si fourni et différent) puis rattache le lead à la promo en
 * cours qui porte l'un de ses tags, s'il n'en a pas déjà une. Ne retire
 * jamais un rattachement. tags vide = rien à faire (payload sans tags).
 */
export async function applyTagsToLead(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  tags: string[],
  at: number,
): Promise<{ attached: boolean; promotionId?: Id<"promotions"> }> {
  if (tags.length === 0) return { attached: false };
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.deletedAt !== undefined) return { attached: false };

  const patch: Record<string, unknown> = {};
  if (!sameTags(lead.ghlTags, tags)) patch.ghlTags = tags;

  let promotionId: Id<"promotions"> | undefined;
  if (lead.promotionId === undefined) {
    const candidates = await ctx.db.query("promotions").withIndex("by_endAt", (q) => q.gte("endAt", at)).collect();
    const match = matchPromotion(tags, candidates, at);
    if (match) {
      promotionId = match._id;
      patch.promotionId = match._id;
      patch.promotionJoinedAt = at;
      patch.promotionSource = "tag";
      Object.assign(patch, await blankSlateForPromotion(ctx, lead, at, match.name));
    }
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
  if (promotionId) {
    const promo = await ctx.db.get(promotionId);
    await logSystemActivity(ctx, {
      source: "GHL", action: "lead.promotion.joined", entityType: "lead", entityId: leadId, leadId,
      subject: leadLabel(lead),
      summary: `${leadLabel(lead)} rattaché à la promotion « ${promo?.name ?? "?"} » (tag GHL)`,
      details: { promotionId, tags },
    });
  }
  return promotionId ? { attached: true, promotionId } : { attached: false };
}
