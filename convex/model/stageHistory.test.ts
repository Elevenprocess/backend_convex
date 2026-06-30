import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import { makeT } from "../test.kit";

test("insertStageHistory est idempotent sur (lead, stage, changedAt)", async () => {
  const t = makeT();
  const leadId = await t.run((ctx) =>
    ctx.db.insert("leads", { source: "manual", status: "nouveau" }),
  );
  const args = {
    leadId,
    ghlStageName: "nouveau",
    saasStatus: "nouveau" as const,
    changedAt: 1000,
    source: "manual" as const,
  };
  const first = await t.mutation(internal.model["stageHistory.testfns"].insert, args);
  const second = await t.mutation(internal.model["stageHistory.testfns"].insert, args);
  expect(first).not.toBeNull();
  expect(second).toBeNull();
  const rows = await t.run((ctx) =>
    ctx.db
      .query("leadStageHistory")
      .withIndex("by_lead_changedAt", (q) => q.eq("leadId", leadId))
      .collect(),
  );
  expect(rows).toHaveLength(1);
});
