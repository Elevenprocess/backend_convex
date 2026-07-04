import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const T = Date.UTC(2026, 6, 2, 8, 0);

async function seed(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin" });
  const setterId = await insertUser(t, { role: "setter", email: "s@e.fr", name: "Setter Un" });
  const comId = await insertUser(t, { role: "commercial", email: "c@e.fr", name: "Com Un" });
  const ids = await t.run(async (ctx: any) => {
    const leadId = await ctx.db.insert("leads", {
      source: "manual",
      status: "qualifie",
      firstName: "S",
      setterId,
      lastContactAt: T,
    });
    await ctx.db.insert("callLogs", { leadId, setterId, calledAt: T, result: "joint" });
    const rdvId = await ctx.db.insert("rdv", {
      leadId,
      commercialId: comId,
      scheduledAt: T,
      locationType: "domicile",
      status: "honore",
      result: "signe",
      montantTotal: 12000,
    });
    return { leadId, rdvId };
  });
  return { adminId, setterId, comId, ...ids };
}

test("admin : vue admin remplie, setter/commercial null", async () => {
  const t = makeT();
  const { adminId } = await seed(t);
  // « Qualifiés » se base sur rdv._creationTime, que convex-test fixe à l'heure
  // réelle du run : la borne haute doit couvrir maintenant, pas une date figée.
  const res = await asUser(t, adminId).query(api.analytics.summary, {
    now: NOW,
    from: "2026-07-01T00:00:00.000Z",
    to: new Date(Date.now() + 86_400_000).toISOString(),
  });
  expect(res.role).toBe("admin");
  expect(res.engine).toBe("convex-reactive");
  expect(res.setter).toBeNull();
  expect(res.commercial).toBeNull();
  expect(res.admin!.qualified).toBe(1);
  expect(res.admin!.signed).toBe(1);
  expect(res.admin!.ca).toBe(12000);
  expect(res.admin!.setters).toHaveLength(1);
  expect(res.admin!.setters[0].name).toBe("Setter Un");
});

test("setter : vue setter scopée à ses leads", async () => {
  const t = makeT();
  const { setterId } = await seed(t);
  const res = await asUser(t, setterId).query(api.analytics.summary, {
    now: NOW,
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-03T23:59:59.999Z",
  });
  expect(res.admin).toBeNull();
  expect(res.commercial).toBeNull();
  expect(res.setter!.qualified).toBe(1);
  expect(res.setter!.loggedCalls).toBe(1);
});

test("commercial : fast-path rdv seuls + days défaut 30", async () => {
  const t = makeT();
  const { comId } = await seed(t);
  const res = await asUser(t, comId).query(api.analytics.summary, { now: NOW });
  expect(res.days).toBe(30);
  expect(res.admin).toBeNull();
  expect(res.setter).toBeNull();
  expect(res.commercial!.signed).toBe(1);
  expect(res.commercial!.ca).toBe(12000);
});

test("débrief détaché : compté comme ligne synthétique (une seule fois)", async () => {
  const t = makeT();
  const { adminId, comId } = await seed(t);
  const leadId2 = await asUser(t, comId).mutation(api.leads.create, { firstName: "B" });
  await asUser(t, comId).mutation(api.debriefs.createForLead, {
    leadId: leadId2,
    outcome: "vente",
    montantTotal: 8000,
    financingType: "comptant",
  });
  const res = await asUser(t, adminId).query(api.analytics.summary, {
    now: NOW,
    from: "2026-07-01T00:00:00.000Z",
    // Le débrief détaché est daté par _creationTime (heure réelle du run).
    to: new Date(Date.now() + 86_400_000).toISOString(),
  });
  // 12000 (rdv) + 8000 (débrief détaché synthétique) — pas de double comptage
  expect(res.admin!.ca).toBe(20000);
  expect(res.admin!.signed).toBe(2);
});

test("setter_lead / finances : garde passée, trois vues null (parité NestJS)", async () => {
  const t = makeT();
  await seed(t);
  const slId = await insertUser(t, { role: "setter_lead", email: "sl@e.fr" });
  const res = await asUser(t, slId).query(api.analytics.summary, { now: NOW });
  expect(res.admin).toBeNull();
  expect(res.setter).toBeNull();
  expect(res.commercial).toBeNull();
});

test("commercial_lead : vue admin ; rôle hors liste (technicien) → throw ; défauts par rôle", async () => {
  const t = makeT();
  await seed(t);
  const clId = await insertUser(t, { role: "commercial_lead", email: "cl@e.fr" });
  const resCl = await asUser(t, clId).query(api.analytics.summary, {
    now: NOW,
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-03T23:59:59.999Z",
  });
  expect(resCl.admin).not.toBeNull();

  const techId = await insertUser(t, { role: "technicien", email: "t@e.fr" });
  await expect(asUser(t, techId).query(api.analytics.summary, { now: NOW })).rejects.toThrow(/Accès refusé/);

  const setterId2 = await insertUser(t, { role: "setter", email: "s2@e.fr" });
  expect((await asUser(t, setterId2).query(api.analytics.summary, { now: NOW })).days).toBe(1);
  const adminId2 = await insertUser(t, { role: "admin", email: "a2@e.fr" });
  expect((await asUser(t, adminId2).query(api.analytics.summary, { now: NOW })).days).toBe(365);
});
