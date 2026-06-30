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
