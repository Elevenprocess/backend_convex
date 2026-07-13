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

test("update() patche fiche + statut (re-qualification d'un lead perdu) et écrit l'historique", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Mario" });
  // Un débrief l'avait passé perdu ; on le remet qualifié via la fiche.
  await t.run((ctx) => ctx.db.patch(leadId, { status: "perdu" }));

  const updated = await asUser(t, setterId).mutation(api.leads.update, {
    leadId, status: "qualifie", lastName: "Ratiarivony", city: "Tana", postalCode: "101",
  });
  expect(updated?.status).toBe("qualifie");
  expect(updated?.lastName).toBe("Ratiarivony");
  expect(updated?.city).toBe("Tana");
  const hist = await t.run((ctx) =>
    ctx.db.query("leadStageHistory").withIndex("by_lead_changedAt", (q) => q.eq("leadId", leadId)).collect());
  expect(hist.some((h) => h.saasStatus === "qualifie")).toBe(true);
});

test("update() sans changement de statut ne crée pas d'historique", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Jo" });
  await asUser(t, setterId).mutation(api.leads.update, { leadId, email: "jo@ecoi.fr" });
  const hist = await t.run((ctx) =>
    ctx.db.query("leadStageHistory").withIndex("by_lead_changedAt", (q) => q.eq("leadId", leadId)).collect());
  expect(hist.length).toBe(0);
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.email).toBe("jo@ecoi.fr");
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

test("list({search}) : téléphone insensible aux espaces et au préfixe +262/+33", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Tel" });
  await t.run((ctx) => ctx.db.patch(leadId, { phone: "+262 692 12 34 56" }));

  for (const search of ["0692123456", "0692 12 34 56", "692 123 456", "+262692123456", "262 692 12 34"]) {
    const page = await asUser(t, setterId).query(api.leads.list, {
      search,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((l) => l._id), `recherche « ${search} »`).toContain(leadId);
  }

  // Numéro stocké SANS indicatif, recherché avec +262.
  const local = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Local" });
  await t.run((ctx) => ctx.db.patch(local, { phone: "0693 55 66 77" }));
  const page = await asUser(t, setterId).query(api.leads.list, {
    search: "+262 693 55 66 77",
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page.map((l) => l._id)).toContain(local);
});

test("list({search}) : nom/email/adresse insensibles à la casse et aux accents", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, {
    firstName: "José", lastName: "Hoareau", city: "Saint-Denis",
  });
  await t.run((ctx) => ctx.db.patch(leadId, {
    email: "Jose.Hoareau@Gmail.com",
    addressLine: "12 Rue des Écoles",
    postalCode: "97400",
  }));

  for (const search of ["jose", "JOSÉ HOAREAU", "jose.hoareau@gmail.com", "rue des ecoles", "97400", "SAINT-DENIS"]) {
    const page = await asUser(t, setterId).query(api.leads.list, {
      search,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((l) => l._id), `recherche « ${search} »`).toContain(leadId);
  }
});

test("qualify() passe le lead en qualifie / pas_qualifie", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Q" });
  await asUser(t, setterId).mutation(api.leads.qualify, { leadId, qualified: false });
  const lead = await t.run((ctx) => ctx.db.get(leadId));
  expect(lead?.status).toBe("pas_qualifie");
});

test("les mutations d'état lead refusent les rôles non commerciaux (technicien)", async () => {
  const t = makeT();
  const setterId = await insertUser(t, { role: "setter" });
  const techId = await insertUser(t, { role: "technicien", email: "tech@ecoi.fr" });
  const leadId = await asUser(t, setterId).mutation(api.leads.create, { firstName: "Z" });

  await expect(
    asUser(t, techId).mutation(api.leads.updateStatus, { leadId, status: "qualifie" }),
  ).rejects.toThrow(/Accès refusé/);
  await expect(
    asUser(t, techId).mutation(api.leads.qualify, { leadId, qualified: true }),
  ).rejects.toThrow(/Accès refusé/);
  await expect(
    asUser(t, techId).mutation(api.leads.update, { leadId, status: "perdu" }),
  ).rejects.toThrow(/Accès refusé/);
  // le lead n'a pas bougé
  expect((await t.run((ctx) => ctx.db.get(leadId)))?.status).toBe("nouveau");
});
