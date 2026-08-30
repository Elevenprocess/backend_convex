import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

// Le retour aux setters planifie la lecture des notes GHL (runAfter 0) : on
// draine pour ne pas laisser fuir d'écriture planifiée après le test.
async function drain(t: { finishInProgressScheduledFunctions: () => Promise<void> }) {
  await new Promise((r) => setTimeout(r, 25));
  await t.finishInProgressScheduledFunctions();
}

describe("ghlRetourSetters", () => {
  it("sync / syncScheduled → no-op sans configuration GHL", async () => {
    const t = makeT();
    delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    delete process.env.GHL_API_KEY;
    delete process.env.GHL_LOCATION_ID;
    delete process.env.GHL_SYNC_ENABLED;
    expect(await t.action(internal.ghlRetourSetters.sync, {})).toBeNull();
    expect(await t.action(internal.ghlRetourSetters.syncScheduled, {})).toBeNull();
  });

  it("alreadyApplied : vrai après un passage par applyGhlStageChange, faux pour une autre date / contact inconnu", async () => {
    const t = makeT();
    const at = Date.parse("2026-08-27T08:00:00Z");
    await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", externalId: "c1", status: "rdv_pris" }));
    expect(await t.query(internal.ghlRetourSetters.alreadyApplied, { contactId: "c1", occurredAt: at })).toBe(false);
    await t.mutation(internal.webhooks.applyGhlStageChange, {
      externalId: "c1", ghlStageName: "(BIS) Retour aux Setters 🔙", occurredAt: at,
    });
    await drain(t);
    expect(await t.query(internal.ghlRetourSetters.alreadyApplied, { contactId: "c1", occurredAt: at })).toBe(true);
    expect(await t.query(internal.ghlRetourSetters.alreadyApplied, { contactId: "c1", occurredAt: at + 1 })).toBe(false);
    expect(await t.query(internal.ghlRetourSetters.alreadyApplied, { contactId: "zz", occurredAt: at })).toBe(false);
  });
});
