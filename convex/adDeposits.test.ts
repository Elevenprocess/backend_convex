import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seedSpend(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    // Avant le dépôt (2026-07-09) — ne doit PAS compter.
    await ctx.db.insert("adSpendDaily", {
      date: "2026-07-09", channel: "meta", campaign: "A", spend: 999, impressions: 5000, clicks: 100,
    });
    // Le jour du dépôt et après — comptent.
    await ctx.db.insert("adSpendDaily", {
      date: "2026-07-10", channel: "meta", campaign: "A", spend: 150, impressions: 8000, clicks: 120,
    });
    await ctx.db.insert("adSpendDaily", {
      date: "2026-07-12", channel: "meta", campaign: "A", spend: 50, impressions: 2000, clicks: 30,
    });
    // Autre canal — ignoré.
    await ctx.db.insert("adSpendDaily", {
      date: "2026-07-12", channel: "google", campaign: "G", spend: 77, impressions: 1, clicks: 1,
    });
  });
}

async function insertLead(t: ReturnType<typeof makeT>, createdAt: number, channel = "meta") {
  await t.run(async (ctx) =>
    ctx.db.insert("leads", {
      source: "meta_ads",
      status: "nouveau",
      acquisitionChannel: channel,
      createdAt,
    } as never),
  );
}

describe("adDeposits", () => {
  it("add réservé admin ; budget/list réservés admin+commercial_lead", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    const leadRoleId = await insertUser(t, { role: "commercial_lead", email: "cl@ecoi.fr" });
    await expect(
      asUser(t, setterId).mutation(api.adDeposits.add, { date: "2026-07-10", amount: 500, channel: "meta" }),
    ).rejects.toThrow();
    await expect(
      asUser(t, leadRoleId).mutation(api.adDeposits.add, { date: "2026-07-10", amount: 500, channel: "meta" }),
    ).rejects.toThrow();
    await expect(
      asUser(t, setterId).query(api.adDeposits.budget, { channel: "meta" }),
    ).rejects.toThrow();
    // commercial_lead lit le budget.
    await expect(
      asUser(t, leadRoleId).query(api.adDeposits.budget, { channel: "meta" }),
    ).resolves.toMatchObject({ deposit: null });
  });

  it("add valide date et montant", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const admin = asUser(t, adminId);
    await expect(admin.mutation(api.adDeposits.add, { date: "10/07/2026", amount: 500, channel: "meta" })).rejects.toThrow();
    await expect(admin.mutation(api.adDeposits.add, { date: "2026-07-10", amount: 0, channel: "meta" })).rejects.toThrow();
  });

  it("budget : KPI depuis le DERNIER dépôt (jour du dépôt inclus, avant exclu)", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const admin = asUser(t, adminId);
    await seedSpend(t);

    // Leads : un avant le dépôt (09/07 Réunion), deux après, un supprimé, un autre canal.
    const day10Reunion = Date.parse("2026-07-10T05:00:00+04:00");
    await insertLead(t, Date.parse("2026-07-09T23:00:00+04:00"));
    await insertLead(t, day10Reunion);
    await insertLead(t, Date.parse("2026-07-12T10:00:00+04:00"));
    await insertLead(t, day10Reunion, "google");
    await t.run(async (ctx) =>
      ctx.db.insert("leads", {
        source: "meta_ads", status: "nouveau", acquisitionChannel: "meta",
        createdAt: day10Reunion, deletedAt: Date.now(),
      } as never),
    );

    // Vieux dépôt puis dépôt courant : seul le plus récent borne les KPI.
    await admin.mutation(api.adDeposits.add, { date: "2026-06-01", amount: 300, channel: "meta" });
    await admin.mutation(api.adDeposits.add, { date: "2026-07-10", amount: 500, channel: "meta", note: "Recharge CB" });

    const budget = await admin.query(api.adDeposits.budget, { channel: "meta" });
    expect(budget.deposit).toMatchObject({ date: "2026-07-10", amount: 500, note: "Recharge CB" });
    expect(budget.spend).toBe(200); // 150 + 50, la ligne du 09/07 exclue
    expect(budget.impressions).toBe(10000);
    expect(budget.clicks).toBe(150);
    expect(budget.leads).toBe(2); // 10/07 + 12/07 ; 09/07, supprimé et google exclus
    expect(budget.cpl).toBe(100);
    expect(budget.remaining).toBe(300);
  });

  it("list trie du plus récent au plus ancien ; remove supprime", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const admin = asUser(t, adminId);
    await admin.mutation(api.adDeposits.add, { date: "2026-06-01", amount: 300, channel: "meta" });
    const id = await admin.mutation(api.adDeposits.add, { date: "2026-07-10", amount: 500, channel: "meta" });
    let rows = await admin.query(api.adDeposits.list, { channel: "meta" });
    expect(rows.map((r) => r.date)).toEqual(["2026-07-10", "2026-06-01"]);
    await admin.mutation(api.adDeposits.remove, { id });
    rows = await admin.query(api.adDeposits.list, { channel: "meta" });
    expect(rows.map((r) => r.date)).toEqual(["2026-06-01"]);
  });
});
