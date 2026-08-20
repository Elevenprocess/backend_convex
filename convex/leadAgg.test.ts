import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { refreshLeadAgg, AGG_VERSION } from "./model/leadAgg";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-06T12:00:00Z"); // Réunion : 06/07 16:00

describe("leads.agg — agrégats dénormalisés", () => {
  it("getEnriched rend exactement le même résultat via agg stocké et via calcul live", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const setterId = await insertUser(t, { role: "setter" });
    const comId = await insertUser(t, { role: "commercial" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "signe", externalId: "c1" }));

    await t.run(async (ctx) => {
      await ctx.db.insert("callLogs", { leadId, setterId, calledAt: NOW - 2 * 3_600_000, result: "joint", notes: "RAS", nextCallbackAt: NOW + DAY });
      await ctx.db.insert("callLogs", { leadId, setterId, calledAt: NOW - 3 * DAY, result: "non_joint" });
      await ctx.db.insert("rdv", { leadId, commercialId: comId, locationType: "domicile", status: "honore", scheduledAt: NOW - DAY, debriefFilledAt: NOW - DAY });
      await ctx.db.insert("devis", { leadId, commercialId: comId, status: "signe", ocrStatus: "done", filename: "d.pdf", sizeBytes: 1, lignes: [], echeancier: [], extracted: {} });
      await ctx.db.insert("clients", { leadId, statusGlobal: "administratif_en_cours", currentPhase: "vt", blocked: false });
      await ctx.db.insert("leadStageHistory", { leadId, ghlStageName: "signe", saasStatus: "signe", changedAt: NOW - 5 * DAY, source: "manual" });
      await ctx.db.insert("leadStageHistory", { leadId, ghlStageName: "nouveau", saasStatus: "nouveau", changedAt: NOW - 10 * DAY, source: "manual" });
    });

    // Sans agg stocké → chemin de repli (calcul live).
    const live = await asUser(t, adminId).query(api.leads.getEnriched, { leadId, now: NOW });
    expect(live).not.toBeNull();

    // Avec agg stocké → chemin dénormalisé. Même résultat champ pour champ
    // (l'agg lui-même est retiré de la réponse).
    await t.run((ctx) => refreshLeadAgg(ctx, leadId));
    const viaAgg = await asUser(t, adminId).query(api.leads.getEnriched, { leadId, now: NOW });
    expect(viaAgg).toEqual(live);
  });

  it("un agg d'une version périmée est ignoré (repli live)", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const setterId = await insertUser(t, { role: "setter" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau" }));
    await t.run((ctx) => ctx.db.insert("callLogs", { leadId, setterId, calledAt: NOW - DAY, result: "joint" }));
    // Agg volontairement faux, marqué d'une version antérieure.
    await t.run(async (ctx) => {
      const lead = await ctx.db.get(leadId);
      await ctx.db.patch(leadId, {
        agg: {
          v: AGG_VERSION - 1, updatedAt: NOW, callSetterIds: [], callCount: 99,
          distinctCallDays: 99, callsOnLastCallDay: 99, hasDevis: true,
        },
      });
      void lead;
    });
    const e = await asUser(t, adminId).query(api.leads.getEnriched, { leadId, now: NOW });
    expect(e!.callCount).toBe(1);
    expect(e!.hasDevis).toBe(false);
  });

  it("logCall entretient l'agg du lead", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau" }));
    await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId, result: "joint", notes: "premier appel" });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead!.agg?.v).toBe(AGG_VERSION);
    expect(lead!.agg?.callCount).toBe(1);
    expect(lead!.agg?.latestCallComment).toBe("premier appel");
  });

  it("rdv.create et devis.create entretiennent l'agg", async () => {
    const t = makeT();
    const comId = await insertUser(t, { role: "commercial" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau" }));
    await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId, scheduledAt: NOW + DAY });
    let lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead!.agg?.latestRdvAt).toBe(NOW + DAY);
    expect(lead!.agg?.latestRdvStatus).toBe("planifie");

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["pdf"])));
    await asUser(t, comId).mutation(api.devis.create, { leadId, storageId, filename: "d.pdf", sizeBytes: 3 });
    lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead!.agg?.hasDevis).toBe(true);
  });
});
