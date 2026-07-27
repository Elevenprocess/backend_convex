import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { mergeAdsRows, buildAdsSeries } from "./model/adsReport";

// ─── mergeAdsRows (pur — parité ads-roas.service NestJS) ──────────────────────

describe("mergeAdsRows", () => {
  it("match par id prioritaire : campagne renommée absorbée", () => {
    const { rows, totals } = mergeAdsRows(
      [{ campaignId: "c1", campaign: "Nouveau nom", spend: 100, impressions: 1000, clicks: 50 }],
      [{ campaignId: "c1", campaign: "Ancien nom", leads: 4, devisSignes: 1, ca: 900 }],
      "campaign",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spend: 100, leads: 4, ca: 900, unmatched: null });
    expect(rows[0].cpl).toBe(25);
    expect(rows[0].roas).toBe(9);
    expect(totals.roas).toBe(9);
  });

  it("fallback par nom normalisé quand l'id manque d'un côté", () => {
    const { rows } = mergeAdsRows(
      [{ campaignId: "c1", campaign: " Solaire Été ", spend: 50, impressions: 10, clicks: 5 }],
      [{ campaignId: null, campaign: "solaire été", leads: 2, devisSignes: 0, ca: 0 }],
      "campaign",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spend: 50, leads: 2 });
  });

  it("flags unmatched : dépense sans lead / lead sans dépense", () => {
    const { rows } = mergeAdsRows(
      [{ campaignId: "c1", campaign: "A", spend: 10, impressions: 1, clicks: 1 }],
      [{ campaignId: "c2", campaign: "B", leads: 3, devisSignes: 0, ca: 0 }],
      "campaign",
    );
    const byName = Object.fromEntries(rows.map((r) => [r.campaign, r.unmatched]));
    expect(byName.A).toBe("spend_no_leads");
    expect(byName.B).toBe("leads_no_spend");
  });
});

describe("buildAdsSeries", () => {
  it("axe continu : jours sans données à zéro, agrégation par jour", () => {
    const series = buildAdsSeries(
      ["2026-07-01", "2026-07-02", "2026-07-03"],
      [
        { date: "2026-07-01", spend: 10, impressions: 100, clicks: 5 },
        { date: "2026-07-01", spend: 5, impressions: 50, clicks: 2 },
        { date: "2026-07-03", spend: 20, impressions: 10, clicks: 1 },
      ],
      [{ day: "2026-07-03", devisSignes: 1, ca: 5000 }],
    );
    expect(series.map((p) => p.spend)).toEqual([15, 0, 20]);
    expect(series[2]).toMatchObject({ leads: 1, devisSignes: 1, ca: 5000 });
  });
});

// ─── Query ads.report (intégration) ───────────────────────────────────────────

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin", email: "a@ecoi.fr" });
  const commercialId = await insertUser(t, { role: "commercial", email: "c@ecoi.fr" });
  const day = Date.parse("2026-07-10T08:00:00.000Z");
  const leadId = await t.run(async (ctx) =>
    ctx.db.insert("leads", {
      source: "meta_ads",
      status: "nouveau",
      acquisitionChannel: "meta",
      campaign: "Campagne Solaire",
      campaignId: "cmp_1",
      adset: "Adset Réunion",
      adsetId: "as_1",
      createdAt: day,
    } as never),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("devis", {
      leadId,
      commercialId,
      status: "signe",
      filename: "devis.pdf",
      sizeBytes: 1,
      ocrStatus: "done",
      montantTtc: 8000,
      lignes: [],
      echeancier: [],
      extracted: {},
    } as never);
    await ctx.db.insert("adSpendDaily", {
      date: "2026-07-10",
      channel: "meta",
      campaign: "Campagne Solaire",
      campaignId: "cmp_1",
      adset: "Adset Réunion",
      adsetId: "as_1",
      spend: 400,
      impressions: 20000,
      clicks: 300,
    });
  });
  return { admin: asUser(t, adminId) };
}

// Bornes telles qu'envoyées par le DateRangePicker : minuit/fin de jour LOCAL
// Réunion (UTC+4) sérialisés en ISO.
const RANGE = {
  from: "2026-06-30T20:00:00.000Z",
  to: "2026-07-31T19:59:59.999Z",
  channel: "meta",
} as const;

describe("ads.report", () => {
  it("réservé admin/commercial_lead (setter → refus)", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    await expect(
      asUser(t, setterId).query(api.ads.report, { ...RANGE, level: "campaign" }),
    ).rejects.toThrow();
  });

  it("cohorte : dépense + leads + CA signé fusionnés, ROAS calculé", async () => {
    const t = makeT();
    const { admin } = await seed(t);
    const report = await admin.query(api.ads.report, { ...RANGE, level: "campaign" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      campaignId: "cmp_1", spend: 400, leads: 1, devisSignes: 1, ca: 8000, unmatched: null,
    });
    expect(report.totals.roas).toBe(20);
    // Série continue sur tout juillet, avec le 10 porteur des données.
    expect(report.series.length).toBe(31);
    const d10 = report.series.find((p) => p.date === "2026-07-10");
    expect(d10).toMatchObject({ spend: 400, leads: 1, ca: 8000 });
  });

  it("drill-down adset : clés adset présentes", async () => {
    const t = makeT();
    const { admin } = await seed(t);
    const report = await admin.query(api.ads.report, { ...RANGE, level: "adset" });
    expect(report.rows[0]).toMatchObject({ adsetId: "as_1", adset: "Adset Réunion", leads: 1 });
  });
});
