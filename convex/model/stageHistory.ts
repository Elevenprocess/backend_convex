import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { LeadStatus, StageHistorySource } from "./enums";

export async function insertStageHistory(
  ctx: MutationCtx,
  args: {
    leadId: Id<"leads">;
    ghlStageName: string;
    saasStatus: LeadStatus;
    assignedToId?: Id<"users">;
    monetaryValue?: number;
    changedAt: number;
    source: StageHistorySource;
  },
): Promise<Id<"leadStageHistory"> | null> {
  const existing = await ctx.db
    .query("leadStageHistory")
    .withIndex("by_lead_stage_changedAt", (q) =>
      q
        .eq("leadId", args.leadId)
        .eq("ghlStageName", args.ghlStageName)
        .eq("changedAt", args.changedAt),
    )
    .first();
  if (existing) return null;
  return await ctx.db.insert("leadStageHistory", {
    leadId: args.leadId,
    ghlStageName: args.ghlStageName,
    saasStatus: args.saasStatus,
    assignedToId: args.assignedToId,
    monetaryValue: args.monetaryValue,
    changedAt: args.changedAt,
    source: args.source,
  });
}
