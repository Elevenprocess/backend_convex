// Rattachement d'un lead à une promo par ses tags GHL. Appelé dans la même
// transaction que la création du lead (webhooks.createLeadFromWebhook) et
// par les mutations promotions.applyLeadTags / applyContactTags.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { leadLabel, logSystemActivity } from "./activity";
import { matchPromotion, normalizeTag } from "./promotions";

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
