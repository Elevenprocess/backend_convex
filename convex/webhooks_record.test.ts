import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

describe("webhooks record/mark", () => {
  it("recordEvent insère en recorded, markProcessed passe en processed", async () => {
    const t = makeT();
    const eventId = await t.mutation(internal.webhooks.recordEvent, {
      provider: "ghl",
      eventType: "contact.created",
      payload: JSON.stringify({ contact_id: "c1" }),
      ipAddress: "1.2.3.4",
    });
    let row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row).toMatchObject({ status: "recorded", ipAddress: "1.2.3.4" });
    expect(row?.processedAt).toBeUndefined();

    await t.mutation(internal.webhooks.markProcessed, { eventId });
    row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row?.status).toBe("processed");
    expect(row?.processedAt).toBeTypeOf("number");
  });

  it("markFailed pose l'erreur (tronquée à 2000)", async () => {
    const t = makeT();
    const eventId = await t.mutation(internal.webhooks.recordEvent, {
      provider: "ghl", eventType: "opportunity.changed", payload: "{}",
    });
    await t.mutation(internal.webhooks.markFailed, { eventId, error: "x".repeat(3000) });
    const row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row?.status).toBe("failed");
    expect(row?.error).toHaveLength(2000);
  });
});
