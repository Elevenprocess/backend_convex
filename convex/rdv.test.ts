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
