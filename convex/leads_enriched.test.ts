import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-06T12:00:00Z"); // Réunion : 06/07 16:00

describe("leads.getEnriched", () => {
  it("agrège appels, RDV, devis, débrief, dossier et compteurs dérivés", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const setterId = await insertUser(t, { role: "setter" });
    const comId = await insertUser(t, { role: "commercial" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "signe", externalId: "c1" }));

    await t.run(async (ctx) => {
      // 2 appels : un aujourd'hui (avec rappel programmé), un il y a 3 jours.
      await ctx.db.insert("callLogs", { leadId, setterId, calledAt: NOW - 2 * 3_600_000, result: "answered", notes: "RAS", nextCallbackAt: NOW + DAY });
      await ctx.db.insert("callLogs", { leadId, setterId, calledAt: NOW - 3 * DAY, result: "no_answer" });
      // RDV honoré avec commercial + débrief rempli.
      await ctx.db.insert("rdv", { leadId, commercialId: comId, locationType: "domicile", status: "honore", scheduledAt: NOW - DAY, debriefFilledAt: NOW - DAY });
      // Devis + dossier délivrabilité + historique de stage.
      await ctx.db.insert("devis", { leadId, commercialId: comId, status: "signe", ocrStatus: "done", filename: "d.pdf", sizeBytes: 1, lignes: [], echeancier: [], extracted: {} });
      await ctx.db.insert("clients", { leadId, statusGlobal: "en_cours", currentPhase: "visite_technique", blocked: false });
      await ctx.db.insert("leadStageHistory", { leadId, ghlStageName: "signe", saasStatus: "signe", changedAt: NOW - 5 * DAY, source: "manual" });
      await ctx.db.insert("leadStageHistory", { leadId, ghlStageName: "nouveau", saasStatus: "nouveau", changedAt: NOW - 10 * DAY, source: "manual" });
    });

    const e = await asUser(t, adminId).query(api.leads.getEnriched, { leadId, now: NOW });
    expect(e).toMatchObject({
      callCount: 2,
      callsToday: 1,
      latestCallSetterId: setterId,
      latestCallComment: "RAS",
      latestRdvStatus: "honore",
      latestRdvCommercialId: comId,
      hasDevis: true,
      hasDebrief: true,
      delivrabiliteStatus: "en_cours",
    });
    expect(e!.latestCallAt).toBe(NOW - 2 * 3_600_000);
    expect(e!.nextCallbackAt).toBe(NOW + DAY);
    expect(e!.joursSansContact).toBe(0);
    expect(e!.joursRelance).toBe(2); // 2 jours distincts d'appel
    expect(e!.daysSinceLastStageChange).toBe(5);
    expect(e!.arrivalAt).toBe(NOW - 10 * DAY); // 1er changement de stage
  });

  it("lead absent/supprimé → null", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const del = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", deletedAt: 1 }));
    expect(await asUser(t, adminId).query(api.leads.getEnriched, { leadId: del, now: NOW })).toBeNull();
  });
});

describe("leads.listEnriched", () => {
  it("enrichit la page (delivrabiliteStatus remplace l'affichage signé)", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "signe" }));
    await t.run((ctx) => ctx.db.insert("clients", { leadId, statusGlobal: "installation", currentPhase: "installation", blocked: false }));
    const page = await asUser(t, adminId).query(api.leads.listEnriched, { now: NOW, paginationOpts: { numItems: 10, cursor: null } });
    const row = page.page.find((l) => l._id === leadId);
    expect(row?.delivrabiliteStatus).toBe("installation");
    expect(row?.callCount).toBe(0);
  });
});
