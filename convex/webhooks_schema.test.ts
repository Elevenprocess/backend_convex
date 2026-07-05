import { describe, expect, it } from "vitest";
import { makeT } from "./test.kit";

describe("schéma webhookEvents / acquisitionSourceMap", () => {
  it("insère un event webhook et le retrouve par statut", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("webhookEvents", {
        provider: "ghl",
        eventType: "contact.created",
        payload: JSON.stringify({ contact_id: "c1" }),
        status: "recorded",
      });
      const row = await ctx.db.get(id);
      expect(row?.provider).toBe("ghl");
      const recorded = await ctx.db
        .query("webhookEvents")
        .withIndex("by_status", (q) => q.eq("status", "recorded"))
        .collect();
      expect(recorded).toHaveLength(1);
    });
  });

  it("insère un mapping de source et le retrouve par rawSource", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("acquisitionSourceMap", {
        rawSource: "parrainage", channel: "referral", label: "Parrainage",
      });
      const row = await ctx.db
        .query("acquisitionSourceMap")
        .withIndex("by_rawSource", (q) => q.eq("rawSource", "parrainage"))
        .unique();
      expect(row?.channel).toBe("referral");
    });
  });

  it("leads.createdAt optionnel accepté", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("leads", {
        source: "ghl", status: "nouveau", createdAt: 1_700_000_000_000,
      });
      expect((await ctx.db.get(id))?.createdAt).toBe(1_700_000_000_000);
    });
  });
});
