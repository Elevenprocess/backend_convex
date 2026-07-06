import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

test("logCall() insère l'appel ET met à jour lead.lastContactAt", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Tel" });
  const before = (await t.run((ctx) => ctx.db.get(leadId)))?.lastContactAt;
  expect(before).toBeUndefined();
  await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId, result: "joint", durationSec: 120 });
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.lastContactAt).toBeGreaterThan(0);
  const logs = await asUser(t, setterId).query(api.callLogs.listByLead, { leadId });
  expect(logs).toHaveLength(1);
  expect(logs[0].result).toBe("joint");
  expect(logs[0].setterId).toBe(setterId);
});

test("logCall() dérive le statut lead (classification setter)", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Cl" });

  // refus → pas_qualifie
  await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId, result: "refus" });
  expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("pas_qualifie");

  // joint → qualifie
  await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId, result: "joint" });
  expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("qualifie");

  // non_joint → pas_de_reponse
  const lead2 = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Nj" });
  await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId: lead2, result: "non_joint" });
  expect((await t.run((ctx) => ctx.db.get(lead2)))?.status).toBe("pas_de_reponse");

  // nextCallbackAt → a_rappeler + datePassageRelance + historique de stage
  const cb = Date.now() + 86_400_000;
  await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId: lead2, result: "rappel_planifie", nextCallbackAt: cb });
  const relance = await t.run((ctx) => ctx.db.get(lead2));
  expect(relance?.status).toBe("a_rappeler");
  expect(relance?.datePassageRelance).toBe(cb);
  const hist = await t.run((ctx) =>
    ctx.db.query("leadStageHistory").withIndex("by_lead_changedAt", (q) => q.eq("leadId", lead2)).collect());
  expect(hist.some((h) => h.saasStatus === "a_rappeler")).toBe(true);
});

test("logCall() ne régresse pas un lead terminal (rdv_pris/signe)", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Term" });
  await t.run((ctx) => ctx.db.patch(leadId, { status: "signe" }));
  await asUser(t, setterId).mutation(api.callLogs.logCall, { leadId, result: "non_joint" });
  expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("signe");
});

test("upcomingCallbacks() renvoie les rappels planifiés", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Cb" });
  await asUser(t, setterId).mutation(api.callLogs.logCall, {
    leadId,
    result: "rappel_planifie",
    nextCallbackAt: Date.now() + 86400000,
  });
  const cbs = await asUser(t, setterId).query(api.callLogs.upcomingCallbacks, { now: Date.now() });
  expect(cbs).toHaveLength(1);
});
