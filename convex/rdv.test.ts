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

test("awaitingDebrief liste les honorés non débriefés puis les retire", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "a1@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "A" });
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  await asUser(t, comId).mutation(api.rdv.update, { rdvId, status: "honore" }); // débrief dû
  let due = await asUser(t, comId).query(api.rdv.awaitingDebrief, {});
  expect(due).toHaveLength(1);
  await asUser(t, comId).mutation(api.rdv.update, { rdvId, result: "signe" }); // débrief rempli
  due = await asUser(t, comId).query(api.rdv.awaitingDebrief, {});
  expect(due).toHaveLength(0);
});

test("list filtre par commercial et pagine", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "a2@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "B" });
  await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  const page = await asUser(t, comId).query(api.rdv.list, {
    commercialId: comId, paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toHaveLength(1);
});

test("get renvoie le rdv", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "a3@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "C" });
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  const got = await asUser(t, comId).query(api.rdv.get, { rdvId });
  expect(got?._id).toBe(rdvId);
});

test("listByLead ne renvoie que les RDV du lead, sans les supprimés", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "lbl@ecoi.fr" });
  const leadId = await makeLead(t, setterId);
  const otherLeadId = await makeLead(t, setterId);
  const rdvId = await asUser(t, comId).mutation(api.rdv.create, { leadId, commercialId: comId });
  await asUser(t, comId).mutation(api.rdv.create, { leadId: otherLeadId, commercialId: comId });
  const deletedId = await t.run(async (ctx: any) => {
    const id = await ctx.db.insert("rdv", {
      leadId, commercialId: comId, locationType: "domicile", status: "annule", deletedAt: Date.now(),
    });
    return id;
  });
  const rows = await asUser(t, comId).query(api.rdv.listByLead, { leadId });
  expect(rows.map((r: any) => r._id)).toEqual([rdvId]);
  expect(rows.map((r: any) => r._id)).not.toContain(deletedId);
});

test("listSignatures ne renvoie que les RDV signés (signatureAt), sans les supprimés", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "sig@ecoi.fr" });
  const leadId = await makeLead(t, setterId);
  const signedId = await t.run(async (ctx: any) =>
    ctx.db.insert("rdv", {
      leadId, commercialId: comId, locationType: "domicile", status: "honore",
      result: "signe", signatureAt: Date.parse("2026-01-10"),
    }),
  );
  // Non signé : exclu.
  await t.run(async (ctx: any) =>
    ctx.db.insert("rdv", { leadId, commercialId: comId, locationType: "domicile", status: "planifie" }),
  );
  // Signé mais supprimé : exclu.
  await t.run(async (ctx: any) =>
    ctx.db.insert("rdv", {
      leadId, commercialId: comId, locationType: "domicile", status: "honore",
      result: "signe", signatureAt: Date.parse("2026-01-12"), deletedAt: Date.now(),
    }),
  );
  const rows = await asUser(t, comId).query(api.rdv.listSignatures, {});
  expect(rows.map((r: any) => r._id)).toEqual([signedId]);
});

test("list : from/to via l'index (sans commercial et avec commercial)", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const setterId = await insertUser(t, { role: "setter", email: "win1@ecoi.fr" });
  const leadA = await makeLead(t, setterId);
  const leadB = await makeLead(t, setterId);
  const day = 86_400_000;
  const now = Date.UTC(2026, 7, 24, 12);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("rdv", { leadId: leadA, commercialId: comId, locationType: "domicile", status: "planifie", scheduledAt: now + day });
    await ctx.db.insert("rdv", { leadId: leadB, commercialId: comId, locationType: "domicile", status: "honore", scheduledAt: now - 200 * day });
  });
  const all = await asUser(t, comId).query(api.rdv.list, { paginationOpts: { numItems: 10, cursor: null } });
  expect(all.page).toHaveLength(2);
  const recent = await asUser(t, comId).query(api.rdv.list, {
    from: now - 90 * day, to: now + 30 * day, paginationOpts: { numItems: 10, cursor: null },
  });
  expect(recent.page).toHaveLength(1);
  expect(recent.page[0].leadId).toBe(leadA);
  const byCom = await asUser(t, comId).query(api.rdv.list, {
    commercialId: comId, from: now - 90 * day, to: now + 30 * day, paginationOpts: { numItems: 10, cursor: null },
  });
  expect(byCom.page).toHaveLength(1);
});

test("listWindow : fenêtre bornée, résumé lead embarqué, supprimés exclus", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const other = await insertUser(t, { role: "commercial", email: "win2b@ecoi.fr" });
  const setterId = await insertUser(t, { role: "setter", email: "win2@ecoi.fr" });
  const leadA = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Ana", lastName: "Win" });
  const leadB = await makeLead(t, setterId);
  const day = 86_400_000;
  const now = Date.UTC(2026, 7, 24, 12);
  await t.run(async (ctx: any) => {
    await ctx.db.insert("rdv", { leadId: leadA, commercialId: comId, locationType: "domicile", status: "planifie", scheduledAt: now + day });
    await ctx.db.insert("rdv", { leadId: leadB, commercialId: other, locationType: "domicile", status: "planifie", scheduledAt: now + 2 * day });
    await ctx.db.insert("rdv", { leadId: leadB, commercialId: comId, locationType: "domicile", status: "honore", scheduledAt: now - 200 * day });
    await ctx.db.insert("rdv", { leadId: leadB, commercialId: comId, locationType: "domicile", status: "annule", scheduledAt: now, deletedAt: now });
  });
  const win = await asUser(t, comId).query(api.rdv.listWindow, { from: now - 90 * day, to: now + 30 * day });
  expect(win.map((r: any) => r.leadId).sort()).toEqual([leadA, leadB].sort());
  expect(win.find((r: any) => r.leadId === leadA)?.lead?.firstName).toBe("Ana");
  const mine = await asUser(t, comId).query(api.rdv.listWindow, { commercialId: comId, from: now - 90 * day, to: now + 30 * day });
  expect(mine).toHaveLength(1);
  const capped = await asUser(t, comId).query(api.rdv.listWindow, { from: now - 90 * day, to: now + 30 * day, limit: 1 });
  expect(capped).toHaveLength(1);
});
