import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const NOW = Date.now();
const fromMs = NOW - 3_600_000;
const toMs = NOW + 3_600_000;

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const s1 = await insertUser(t, { role: "setter", email: "s1@e.fr", name: "Setter Un" });
  const s2 = await insertUser(t, { role: "setter", email: "s2@e.fr", name: "Setter Deux" });
  await insertUser(t, { role: "setter", email: "s3@e.fr", name: "Setter Inactif" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com" });
  await t.run(async (ctx: any) => {
    const lead = (setterId: unknown, status: string) =>
      ctx.db.insert("leads", { source: "ghl", status, firstName: "L", setterId, lastContactAt: NOW });
    const l1 = await lead(s1, "rdv_pris");
    const l2 = await lead(s1, "pas_de_reponse"); // rappelé par S2 : ne compte pas pour S1
    await lead(s1, "pas_qualifie"); // classé sans appel : ne compte pour personne
    await ctx.db.insert("callLogs", { leadId: l1, setterId: s1, calledAt: NOW, result: "joint" });
    await ctx.db.insert("callLogs", { leadId: l1, setterId: s1, calledAt: NOW - 60_000, result: "non_joint" });
    await ctx.db.insert("callLogs", { leadId: l2, setterId: s2, calledAt: NOW, result: "non_joint" });
    await ctx.db.insert("callLogs", { leadId: l2, setterId: s2, calledAt: NOW - 2 * 3_600_000, result: "joint" }); // hors plage
    await ctx.db.insert("rdv", { leadId: l1, commercialId: comId, scheduledAt: NOW + 86_400_000, locationType: "domicile", status: "planifie" });
  });
  return { adminId, s1, s2 };
}

test("setterLiveDay : mêmes chiffres par setter que la vue admin, sans setter inactif", async () => {
  const t = makeT();
  const { adminId, s1, s2 } = await seed(t);
  const live = await asUser(t, s1).query(api.analytics.setterLiveDay, { fromMs, toMs });
  const byId = Object.fromEntries(live.map((r: any) => [r.id, r]));
  expect(live).toHaveLength(2);
  expect(byId[s1]).toMatchObject({ name: "Setter Un", calls: 2, connected: 1, qualified: 1, rdvPris: 1 });
  expect(byId[s2]).toMatchObject({ calls: 1, connected: 0, qualified: 0 });

  const res = await asUser(t, adminId).query(api.analytics.summary, {
    now: NOW,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  });
  for (const id of [s1, s2]) {
    const row = res.admin!.setters.find((r: any) => r.id === id)!;
    expect(byId[id].calls).toBe(row.calls);
    expect(byId[id].connected).toBe(row.connected);
    expect(byId[id].qualified).toBe(row.qualified);
  }
});

test("setterLiveDay : un RDV déjà pris avant la plage n'est pas une qualification du jour", async () => {
  const t = makeT();
  const { s1 } = await seed(t);
  const later = await asUser(t, s1).query(api.analytics.setterLiveDay, { fromMs: toMs + 1, toMs: toMs + 2 });
  expect(later).toEqual([]);
});
