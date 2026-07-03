import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const T = Date.UTC(2026, 6, 2, 8, 0);
const PERIOD = { now: NOW, from: "2026-07-01T00:00:00.000Z", to: "2026-07-03T23:59:59.999Z" };

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const s1 = await insertUser(t, { role: "setter", email: "s1@e.fr", name: "Setter Un" });
  const s2 = await insertUser(t, { role: "setter", email: "s2@e.fr", name: "Setter Deux" });
  const slId = await insertUser(t, { role: "setter_lead", email: "sl@e.fr" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com Un" });
  await t.run(async (ctx: any) => {
    // Lead qualifié par S2 (dernier appelant), appartenant à S1
    const leadId = await ctx.db.insert("leads", {
      source: "manual",
      status: "qualifie",
      firstName: "S",
      setterId: s1,
      lastContactAt: T,
    });
    await ctx.db.insert("callLogs", { leadId, setterId: s1, calledAt: T, result: "joint" });
    await ctx.db.insert("callLogs", { leadId, setterId: s2, calledAt: T + 1000, result: "rdv_pris" });
    await ctx.db.insert("rdv", {
      leadId,
      commercialId: comId,
      scheduledAt: T,
      locationType: "domicile",
      status: "honore",
      result: "signe",
      montantTotal: 12000,
    });
  });
  return { adminId, s1, s2, slId, comId };
}

test("setterStats : setter_lead consulte S2 → qualification créditée (dernier appelant)", async () => {
  const t = makeT();
  const { slId, s2 } = await seed(t);
  const res = await asUser(t, slId).query(api.analytics.setterStats, { setterId: s2, ...PERIOD });
  expect(res.qualified).toBe(1);
  expect(res.loggedCalls).toBe(1);
});

test("setterStats : S1 (propriétaire mais pas dernier appelant) → pas crédité", async () => {
  const t = makeT();
  const { slId, s1 } = await seed(t);
  const res = await asUser(t, slId).query(api.analytics.setterStats, { setterId: s1, ...PERIOD });
  expect(res.qualified).toBe(0);
  expect(res.answered).toBeGreaterThanOrEqual(1);
});

test("setterStats : setter simple forcé sur SES stats", async () => {
  const t = makeT();
  const { s1, s2 } = await seed(t);
  // s1 demande les stats de s2 → reçoit les SIENNES
  const res = await asUser(t, s1).query(api.analytics.setterStats, { setterId: s2, ...PERIOD });
  expect(res.qualified).toBe(0);
  expect(res.loggedCalls).toBe(1);
});

test("setterStats : rôle refusé (finances)", async () => {
  const t = makeT();
  const { s1 } = await seed(t);
  const finId = await insertUser(t, { role: "finances", email: "f@e.fr" });
  await expect(
    asUser(t, finId).query(api.analytics.setterStats, { setterId: s1, ...PERIOD }),
  ).rejects.toThrow(/Accès refusé/);
});

test("commercialStats : admin consulte un commercial ; PAS de débrief détaché", async () => {
  const t = makeT();
  const { adminId, comId } = await seed(t);
  // Débrief détaché du commercial (vente sans RDV) — NE DOIT PAS compter ici
  const leadId2 = await asUser(t, comId).mutation(api.leads.create, { firstName: "B" });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId: leadId2,
    outcome: "vente",
    montantTotal: 8000,
    financingType: "comptant",
  });
  const res = await asUser(t, adminId).query(api.analytics.commercialStats, {
    commercialId: comId,
    now: NOW,
    from: "2026-07-01T00:00:00.000Z",
    to: new Date(NOW + 86_400_000).toISOString(),
  });
  expect(res.signed).toBe(1); // le RDV signé seul, pas le débrief détaché
  expect(res.ca).toBe(12000);
});

test("commercialStats : commercial forcé sur SES stats ; setter refusé", async () => {
  const t = makeT();
  const { comId } = await seed(t);
  const com2 = await insertUser(t, { role: "commercial", email: "c2@e.fr" });
  // com2 demande les stats de comId → reçoit les SIENNES (0 rdv)
  const res = await asUser(t, com2).query(api.analytics.commercialStats, {
    commercialId: comId,
    ...PERIOD,
  });
  expect(res.total).toBe(0);
  const setterId = await insertUser(t, { role: "setter", email: "s9@e.fr" });
  await expect(
    asUser(t, setterId).query(api.analytics.commercialStats, { commercialId: comId, ...PERIOD }),
  ).rejects.toThrow(/Accès refusé/);
});
