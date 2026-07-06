import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";

async function seed(t: ReturnType<typeof makeT>, overrides = {}) {
  const commercialId = await t.run((ctx) => ctx.db.insert("users", { email: "c@e.fr", name: "Paul", role: "commercial", active: true }));
  const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", externalId: "c1" }));
  const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, commercialId, locationType: "domicile", status: "honore", scheduledAt: 1000, ...overrides }));
  return { commercialId, leadId, rdvId };
}

function clearGhl() {
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_LOCATION_ID;
}

// submitViaLink planifie pushRdvDebriefScheduled (runAfter 0). On laisse le timer
// démarrer puis on draine pour ne pas laisser d'écriture planifiée fuir.
async function drain(t: ReturnType<typeof makeT>) {
  await new Promise((r) => setTimeout(r, 25));
  await t.finishInProgressScheduledFunctions();
}

describe("submitViaLink", () => {
  it("non_vente perdu : result mappé, debriefFilledAt posé, statut lead dérivé", async () => {
    const t = makeT();
    const { leadId, rdvId } = await seed(t);
    clearGhl();
    const r = await t.mutation(internal.debriefs.submitViaLink, { rdvId, outcome: "non_vente", nonSaleReason: "trop_cher", objection: "prix", notes: "à relancer" });
    await drain(t);
    expect(r).toEqual({ ok: true });
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow).toMatchObject({ result: "perdu", objections: "prix", notes: "à relancer", nonSaleReason: "trop_cher" });
    expect(rdvRow?.debriefFilledAt).toBeGreaterThan(0);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("perdu");
    expect(await t.run((ctx) => ctx.db.query("debriefs").collect())).toHaveLength(1);
  });

  it("vente : dossier créé, champs financiers sur le RDV, lead signe", async () => {
    const t = makeT();
    const { leadId, rdvId } = await seed(t);
    clearGhl();
    await t.mutation(internal.debriefs.submitViaLink, { rdvId, outcome: "vente", montantTotal: 15000, kits: "kit A", financingType: "comptant", signedAt: 5000 });
    await drain(t);
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow).toMatchObject({ result: "signe", montantTotal: 15000, kits: "kit A", financingType: "comptant", signatureAt: 5000 });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("signe");
    expect((await t.run((ctx) => ctx.db.query("projects").collect())).length).toBeGreaterThan(0);
  });

  it("RDV sans lead ou sans commercial → throw", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie" }));
    const noCommercial = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "honore" }));
    await expect(t.mutation(internal.debriefs.submitViaLink, { rdvId: noCommercial, outcome: "non_vente" })).rejects.toThrow();
  });
});

describe("rescheduleViaLink", () => {
  it("report → reporte + débrief ré-armé", async () => {
    const t = makeT();
    const { rdvId } = await seed(t, { result: "perdu", debriefFilledAt: 3000, debriefDueAt: 3000 });
    const r = await t.mutation(internal.debriefs.rescheduleViaLink, { rdvId, scheduledAt: Date.parse("2026-08-01T09:00:00Z") });
    expect(r).toEqual({ ok: true });
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow).toMatchObject({ status: "reporte", result: "reporte", scheduledAt: Date.parse("2026-08-01T09:00:00Z") });
    expect(rdvRow?.debriefFilledAt).toBeUndefined();
    expect(rdvRow?.debriefDueAt).toBeUndefined();
  });
});
