import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-06T12:00:00Z");

describe("leads.stats", () => {
  it("compte total + byStatus + bySource + imported (admin voit tout)", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    await t.run(async (ctx) => {
      await ctx.db.insert("leads", { source: "ghl", status: "nouveau" });
      await ctx.db.insert("leads", { source: "ghl", status: "signe" });
      await ctx.db.insert("leads", { source: "airtable_migration", status: "signe" });
      await ctx.db.insert("leads", { source: "manual", status: "perdu" });
      await ctx.db.insert("leads", { source: "manual", status: "nouveau", deletedAt: 1 }); // exclu
    });
    const s = await asUser(t, adminId).query(api.leads.stats, {});
    expect(s.total).toBe(4);
    expect(s.byStatus).toMatchObject({ nouveau: 1, signe: 2, perdu: 1 });
    expect(s.bySource).toMatchObject({ ghl: 2, airtable_migration: 1, manual: 1 });
    expect(s.imported).toBe(3);
    expect(s.directGhl).toBe(2);
  });

  it("commercial ne compte que ses leads assignés", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    await t.run(async (ctx) => {
      await ctx.db.insert("leads", { source: "ghl", status: "signe", assignedToId: comId });
      await ctx.db.insert("leads", { source: "ghl", status: "signe" }); // pas à lui
    });
    const s = await asUser(t, comId).query(api.leads.stats, {});
    expect(s.total).toBe(1);
  });
});

describe("leads.pendingQuotes", () => {
  it("devis en attente du commercial (rdv_honore) + drapeau stale", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    const fresh = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_honore", assignedToId: comId, firstName: "F" }));
    const old = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_honore", assignedToId: comId, firstName: "O" }));
    await t.run((ctx) => ctx.db.insert("leadStageHistory", { leadId: fresh, ghlStageName: "rdv_honore", saasStatus: "rdv_honore", changedAt: NOW - 2 * DAY, source: "manual" }));
    await t.run((ctx) => ctx.db.insert("leadStageHistory", { leadId: old, ghlStageName: "rdv_honore", saasStatus: "rdv_honore", changedAt: NOW - 20 * DAY, source: "manual" }));

    const r = await asUser(t, comId).query(api.leads.pendingQuotes, { now: NOW });
    expect(r.total).toBe(2);
    expect(r.stale).toBe(1);
    expect(r.leads[0].id).toBe(old); // trié par ancienneté desc
    expect(r.leads[0].isStale).toBe(true);
    expect(r.leads[1].isStale).toBe(false);
  });
});

describe("leads.dashboard", () => {
  it("compteurs + totaux CA/closing + alertes", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    const signe = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "signe", assignedToId: comId, monetaryValue: 15000 }));
    await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "perdu", assignedToId: comId }));
    const honore = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "rdv_honore", assignedToId: comId }));
    await t.run((ctx) => ctx.db.insert("leadStageHistory", { leadId: honore, ghlStageName: "rdv_honore", saasStatus: "rdv_honore", changedAt: NOW - 30 * DAY, source: "manual" }));
    await t.run((ctx) => ctx.db.insert("leadStageHistory", { leadId: signe, ghlStageName: "signe", saasStatus: "signe", changedAt: NOW - 1 * DAY, source: "manual" }));

    const d = await asUser(t, comId).query(api.leads.dashboard, { now: NOW });
    expect(d.counters.signe).toBe(1);
    expect(d.counters.rdv_honore).toBe(1);
    expect(d.totals).toMatchObject({ signed: 1, lost: 1, ca: 15000, openLeads: 1 });
    expect(d.totals.closingRate).toBeCloseTo(0.5);
    expect(d.alerts.staleQuotes).toBe(1); // rdv_honore depuis 30j >= 14
    expect(d.alerts.stuckLeads).toBe(1);  // open honore >= 30j
  });

  it("compte TOUS les statuts (signature_en_cours / pas_qualifie / pas_de_reponse)", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    await t.run(async (ctx) => {
      await ctx.db.insert("leads", { source: "ghl", status: "signature_en_cours", assignedToId: comId });
      await ctx.db.insert("leads", { source: "ghl", status: "pas_qualifie", assignedToId: comId });
      await ctx.db.insert("leads", { source: "ghl", status: "pas_de_reponse", assignedToId: comId });
    });
    const d = await asUser(t, comId).query(api.leads.dashboard, { now: NOW });
    expect(d.counters.signature_en_cours).toBe(1);
    expect(d.counters.pas_qualifie).toBe(1);
    expect(d.counters.pas_de_reponse).toBe(1);
    // ces 3 statuts sont "ouverts" (ni signe ni perdu) → cohérence compteurs/openLeads.
    const counted = Object.values(d.counters).reduce((a, b) => a + b, 0);
    expect(counted).toBe(3);
    expect(d.totals.openLeads).toBe(3);
  });
});
