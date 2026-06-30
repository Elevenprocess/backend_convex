import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { leadStatusValidator, stageHistorySourceValidator } from "./enums";
import { insertStageHistory } from "./stageHistory";

export const insert = internalMutation({
  args: {
    leadId: v.id("leads"),
    ghlStageName: v.string(),
    saasStatus: leadStatusValidator,
    changedAt: v.number(),
    source: stageHistorySourceValidator,
  },
  handler: async (ctx, args) => insertStageHistory(ctx, args),
});
