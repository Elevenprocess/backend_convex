import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const NOW = Date.UTC(2026, 6, 3, 12, 0);

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const c1 = await insertUser(t, { role: "commercial", email: "c1@e.fr", name: "Com Un" });
  const c2 = await insertUser(t, { role: "commercial", email: "c2@e.fr", name: "Com Deux" });
  await t.run(async (ctx: any) => {
    await ctx.db.insert("leads", {
      source: "ghl", status: "rdv_pris", firstName: "A", assignedToId: c1,
      ghlStageName: "RDV pris", monetaryValue: 5000,
    });
    await ctx.db.insert("leads", {
      source: "ghl", status: "signe", firstName: "B", assignedToId: c1,
      ghlStageName: "Gagné", monetaryValue: 12000,
    });
    await ctx.db.insert("leads", {
      source: "ghl", status: "perdu", firstName: "C", assignedToId: c1,
      ghlStageName: "Perdu",
    });
  });
  return { adminId, c1, c2 };
}

test("pipelineDistribution : groupes par stage GHL + totaux", async () => {
  const t = makeT();
  const { adminId } = await seed(t);
  const res = await asUser(t, adminId).query(api.analytics.pipelineDistribution, { now: NOW });
  expect(res.totalOpenLeads).toBe(3);
  expect(res.totalOpenValue).toBe(17000);
  const gagne = res.stages.find((s: any) => s.ghlStageName === "Gagné")!;
  expect(gagne.count).toBe(1);
  expect(gagne.totalValue).toBe(12000);
});

test("pipelineByCommercial : agrégats, commercial à 0 dossier inclus, closingRate", async () => {
  const t = makeT();
  const { adminId, c1, c2 } = await seed(t);
  const res = await asUser(t, adminId).query(api.analytics.pipelineByCommercial, { now: NOW });
  const r1 = res.commercials.find((r: any) => r.userId === c1)!;
  expect(r1.openLeads).toBe(3);
  expect(r1.rdvPlanned).toBe(1);
  expect(r1.signed).toBe(1);
  expect(r1.ca).toBe(12000);
  expect(r1.closingRate).toBe(0.5); // 1 signé / (1 signé + 1 perdu)
  const r2 = res.commercials.find((r: any) => r.userId === c2)!;
  expect(r2.openLeads).toBe(0);
});

test("pipelineStuck : lead ancien sans mouvement détecté, signe/perdu exclus", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const oldMove = Date.now() - 10 * 86_400_000;
  await t.run(async (ctx: any) => {
    // Lead bloqué : dernier mouvement il y a 10 jours
    const stuck = await ctx.db.insert("leads", {
      source: "ghl", status: "rdv_pris", firstName: "Stuck", ghlStageName: "RDV pris",
    });
    await ctx.db.insert("leadStageHistory", {
      leadId: stuck, ghlStageName: "RDV pris", saasStatus: "rdv_pris",
      changedAt: oldMove, source: "webhook",
    });
    // Lead actif : mouvement récent
    const fresh = await ctx.db.insert("leads", {
      source: "ghl", status: "qualifie", firstName: "Fresh", ghlStageName: "Qualifié",
    });
    await ctx.db.insert("leadStageHistory", {
      leadId: fresh, ghlStageName: "Qualifié", saasStatus: "qualifie",
      changedAt: Date.now(), source: "webhook",
    });
    // Lead signé ancien : exclu (état fini)
    const signed = await ctx.db.insert("leads", {
      source: "ghl", status: "signe", firstName: "Done", ghlStageName: "Gagné",
    });
    await ctx.db.insert("leadStageHistory", {
      leadId: signed, ghlStageName: "Gagné", saasStatus: "signe",
      changedAt: oldMove, source: "webhook",
    });
  });
  const res = await asUser(t, adminId).query(api.analytics.pipelineStuck, {
    days: 7,
    now: Date.now(),
  });
  expect(res.leads).toHaveLength(1);
  expect(res.leads[0].firstName).toBe("Stuck");
  expect(res.leads[0].stuckDays).toBeGreaterThanOrEqual(10);
});

test("pipeline : rôle refusé (commercial)", async () => {
  const t = makeT();
  const { c1 } = await seed(t);
  await expect(
    asUser(t, c1).query(api.analytics.pipelineDistribution, { now: NOW }),
  ).rejects.toThrow(/Accès refusé/);
});
