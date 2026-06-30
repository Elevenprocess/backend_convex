import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function makeLead(t: any, setterId: string) {
  return await asUser(t, setterId).mutation(api.leads.create, { firstName: "L" });
}

test("create pose le lead en qualifie et assigne le commercial", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const leadId = await makeLead(t, setterId);
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  const rdv = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(rdv.status).toBe("planifie");
  expect(rdv.locationType).toBe("domicile");
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  expect(lead.status).toBe("qualifie");
  expect(lead.assignedToId).toBe(comId);
});

test("create rejette un 2e RDV ouvert sur le même lead", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s2@ecoi.fr" });
  const leadId = await makeLead(t, setterId);
  await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  await expect(
    asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId }),
  ).rejects.toThrow(/ouvert|déjà/i);
});

test("create refuse un commercialId non commercial", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "s3@ecoi.fr" });
  const leadId = await makeLead(t, setterId);
  await expect(
    asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: setterId }),
  ).rejects.toThrow(/commercial/);
});

test("create refusé pour un setter (non gated)", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await makeLead(t, setterId);
  await expect(
    asUser(t, setterId).mutation(api.rdv.create, { leadId }),
  ).rejects.toThrow(/non autorisé/);
});

test("update result signe → lead signe + aucun projet créé", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "u1@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "S" });
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  await asUser(t, comId).mutation(api.rdv.update, { rdvId, status: "honore", result: "signe", montantTotal: 15000 });
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  expect(lead.status).toBe("signe");
  const rdv = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(rdv.result).toBe("signe");
  expect(rdv.debriefFilledAt).toBeGreaterThan(0); // auto-rempli
  // hors-scope : pas de table projects créée dans cette tranche
  const hist = await t.run((ctx: any) =>
    ctx.db.query("leadStageHistory").withIndex("by_lead_changedAt", (q: any) => q.eq("leadId", leadId)).collect());
  expect(hist.some((h: any) => h.saasStatus === "signe")).toBe(true);
});

test("update status honore sans result pose debriefDueAt", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "u2@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "H" });
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  await asUser(t, comId).mutation(api.rdv.update, { rdvId, status: "honore" });
  const rdv = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(rdv.debriefDueAt).toBeGreaterThan(0);
  expect(rdv.debriefFilledAt).toBeUndefined();
  const lead = await t.run((ctx: any) => ctx.db.get(leadId));
  expect(lead.status).toBe("rdv_honore");
});

test("update report→date future ré-arme le débrief", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "u3@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "R" });
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  await asUser(t, comId).mutation(api.rdv.update, { rdvId, status: "honore" }); // pose debriefDueAt
  await asUser(t, comId).mutation(api.rdv.update, {
    rdvId, result: "reporte", scheduledAt: Date.now() + 7 * 86400000,
  });
  const rdv = await t.run((ctx: any) => ctx.db.get(rdvId));
  expect(rdv.status).toBe("planifie");
  expect(rdv.result).toBeUndefined();
  expect(rdv.debriefFilledAt).toBeUndefined();
  expect(rdv.debriefDueAt).toBeUndefined();
});
