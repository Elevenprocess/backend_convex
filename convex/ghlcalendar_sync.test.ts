import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("gardes de rôle sync", () => {
  it("commercial → refus de syncEvents (SETTER_VIEW) avant tout fetch", async () => {
    const t = makeT();
    const uid = await insertUser(t, { role: "commercial" });
    await expect(
      asUser(t, uid).action(api.ghlCalendar.syncEvents, { from: 0, to: 1 }),
    ).rejects.toThrow();
  });

  it("setter + GHL non configuré → {configured:false} sans erreur", async () => {
    const t = makeT();
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    const uid = await insertUser(t, { role: "setter" });
    const r = await asUser(t, uid).action(api.ghlCalendar.syncEvents, {
      from: Date.parse("2026-07-01T00:00:00Z"), to: Date.parse("2026-07-02T00:00:00Z"),
    });
    expect(r).toEqual({ configured: false, created: 0, updated: 0, skipped: 0, events: [] });
  });
});
