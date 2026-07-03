import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
// Les leads/rdv sont créés au fil du test (_creationTime = maintenant réel) :
// la période doit contenir « maintenant ».
const PERIOD = {
  now: NOW,
  from: new Date(Date.now() - 86_400_000).toISOString(),
  to: new Date(Date.now() + 86_400_000).toISOString(),
};

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const s1 = await insertUser(t, { role: "setter", email: "s1@e.fr", name: "Setter Un" });
  const s2 = await insertUser(t, { role: "setter", email: "s2@e.fr", name: "Setter Deux" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com Un" });
  const ids = await t.run(async (ctx: any) => {
    const l1 = await ctx.db.insert("leads", {
      source: "manual", status: "qualifie", firstName: "A", setterId: s1, city: "Saint-Denis",
    });
    const l2 = await ctx.db.insert("leads", {
      source: "manual", status: "nouveau", firstName: "B", setterId: s2, city: "Lyon",
    });
    await ctx.db.insert("callLogs", { leadId: l1, setterId: s1, calledAt: Date.now(), result: "joint" });
    await ctx.db.insert("rdv", {
      leadId: l1, commercialId: comId, scheduledAt: Date.now(), locationType: "domicile",
      status: "honore", result: "signe", montantTotal: 9000,
    });
    return { l1, l2 };
  });
  return { adminId, s1, s2, comId, ...ids };
}

test("funnel : totaux monotones, stages, comparaisons, sectors", async () => {
  const t = makeT();
  const { adminId } = await seed(t);
  const res = await asUser(t, adminId).query(api.analytics.funnel, PERIOD);
  expect(res.engine).toBe("convex-funnel");
  const tt = res.totals;
  expect(tt.newLeads).toBe(2);
  expect(tt.newLeads).toBeGreaterThanOrEqual(tt.calls);
  expect(tt.calls).toBeGreaterThanOrEqual(tt.answered);
  expect(tt.answered).toBeGreaterThanOrEqual(tt.qualified);
  expect(tt.qualified).toBeGreaterThanOrEqual(tt.rdv);
  expect(tt.rdv).toBeGreaterThanOrEqual(tt.signed);
  expect(tt.rdv).toBe(1);
  expect(res.stages).toHaveLength(5);
  expect(res.stages[0]).toMatchObject({ id: "new", label: "Nouveaux leads", value: 2, percent: 100 });
  expect(res.setterComparison.length).toBeGreaterThan(0);
  expect(res.commercialComparison).toHaveLength(1);
  expect(res.sectors).toContain("Saint-Denis");
});

test("funnel : filtre setterId et filtre sector", async () => {
  const t = makeT();
  const { adminId, s1 } = await seed(t);
  const bySetter = await asUser(t, adminId).query(api.analytics.funnel, { ...PERIOD, setterId: s1 });
  expect(bySetter.totals.newLeads).toBe(1);
  expect(bySetter.filters.setterId).toBe(s1);
  const bySector = await asUser(t, adminId).query(api.analytics.funnel, { ...PERIOD, sector: "lyon" });
  expect(bySector.totals.newLeads).toBe(1);
  expect(bySector.totals.qualified).toBe(0);
});

test("funnel : rôle refusé (setter)", async () => {
  const t = makeT();
  const { s1 } = await seed(t);
  await expect(asUser(t, s1).query(api.analytics.funnel, PERIOD)).rejects.toThrow(/Accès refusé/);
});
