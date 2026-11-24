// RDV à domicile choisi pour un lead qui avait un créneau au bureau (pris sur
// le site d'inscription ou donné par un setter) : le RDV bureau est annulé
// automatiquement et la place rendue au funnel (Mario 24/11).
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export async function cancelOfficeSlotIfDomicile(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  locationType: string | undefined,
): Promise<void> {
  if ((locationType ?? "domicile") !== "domicile") return;
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.promotionSlotDay === undefined) return;
  await ctx.scheduler.runAfter(0, internal.promotions.cancelOfficeSlotForDomicile, { leadId });
}
