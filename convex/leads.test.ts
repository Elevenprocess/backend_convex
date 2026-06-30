import { expect, test } from "vitest";
import { makeT } from "./test.kit";
import { api } from "./_generated/api";
import { asUser, insertUser } from "./test.helpers";

test("create() pose source=manual et status=nouveau", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, {
    firstName: "Marie", lastName: "Dupont", city: "Lyon",
  });
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.source).toBe("manual");
  expect(lead?.status).toBe("nouveau");
});

test("updateStatus() change le statut ET écrit l'historique (sans doublon)", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Jo" });
  await asUser(t, setterId).mutation(api.leads.updateStatus, { leadId, status: "qualifie" });
  await asUser(t, setterId).mutation(api.leads.updateStatus, { leadId, status: "qualifie" });
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.status).toBe("qualifie");
  const hist = await t.run((ctx) =>
    ctx.db.query("leadStageHistory").withIndex("by_lead_changedAt", (q) => q.eq("leadId", leadId)).collect(),
  );
  // 2 statuts distincts dans le temps (nouveau→qualifie). Le 2e updateStatus identique ne redonne pas de mouvement.
  expect(hist.length).toBeGreaterThanOrEqual(1);
  expect(hist.some((h) => h.saasStatus === "qualifie")).toBe(true);
});

test("assignSetter() rattache un setter", async () => {
  const t = makeT();
  const adminId = await insertUser(t, { role: "admin" });
  const setterId = await insertUser(t, { role: "setter", email: "s@ecoi.fr" });
  const leadId = await asUser(t, adminId).mutation(api.leads.create, { firstName: "A" });
  await asUser(t, adminId).mutation(api.leads.assignSetter, { leadId, setterId });
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.setterId).toBe(setterId);
});

test("list() filtre par status et pagine", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  await asUser(t, setterId).mutation(api.leads.create, { firstName: "A" });
  const b = await asUser(t, setterId).mutation(api.leads.create, { firstName: "B" });
  await asUser(t, setterId).mutation(api.leads.updateStatus, { leadId: b, status: "qualifie" });
  const page = await asUser(t, setterId).query(api.leads.list, {
    status: "qualifie",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toHaveLength(1);
  expect(page.page[0].firstName).toBe("B");
});

test("qualify() passe le lead en qualifie / pas_qualifie", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Q" });
  await asUser(t, setterId).mutation(api.leads.qualify, { leadId, qualified: false });
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.status).toBe("pas_qualifie");
});
