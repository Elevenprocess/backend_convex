import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";
import { scopeForRole } from "./activityLog";

async function insertLead(t: ReturnType<typeof makeT>, fields: Record<string, unknown> = {}) {
  return await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual", status: "nouveau", firstName: "Sophie", lastName: "Martin",
      createdAt: Date.now(), ...fields,
    }),
  );
}

const allRows = (t: ReturnType<typeof makeT>) =>
  t.run((ctx: any) => ctx.db.query("activityLog").collect());

describe("journal d'activité — écriture", () => {
  it("un changement de statut lead écrit une ligne lisible avec acteur/rôle/domaine", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter", name: "Alice Setter" });
    const leadId = await insertLead(t);
    await asUser(t, setterId).mutation(api.leads.updateStatus, { leadId, status: "a_rappeler" });
    const rows = await allRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: setterId, actorName: "Alice Setter", actorRole: "setter", domain: "setting",
      action: "lead.status_changed", entityType: "lead", entityId: leadId, leadId,
      subject: "Sophie Martin",
    });
    expect(rows[0].summary).toBe("a passé le prospect Sophie Martin de « Nouveau » à « À rappeler »");
    expect(rows[0].details).toEqual({ before: { status: "nouveau" }, after: { status: "a_rappeler" } });
    expect(typeof rows[0].at).toBe("number");
  });

  it("statut identique → aucune ligne (pas d'action réelle)", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    const leadId = await insertLead(t, { status: "a_rappeler" });
    await asUser(t, setterId).mutation(api.leads.updateStatus, { leadId, status: "a_rappeler" });
    expect(await allRows(t)).toHaveLength(0);
  });

  it("un appel journalise résultat + rappel + statut dérivé", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter", name: "Alice" });
    const leadId = await insertLead(t);
    const cb = Date.now() + 3_600_000;
    await asUser(t, setterId).mutation(api.callLogs.logCall, {
      leadId, result: "joint", durationSec: 180, nextCallbackAt: cb,
    });
    const rows = await allRows(t);
    const call = rows.find((r: any) => r.action === "call.logged");
    expect(call).toBeDefined();
    expect(call.summary).toContain("a enregistré un appel avec Sophie Martin");
    expect(call.summary).toContain("résultat : joint");
    expect(call.summary).toContain("3 min");
    expect(call.summary).toContain("statut → « À rappeler »");
    expect(call.domain).toBe("setting");
    expect(call.entityType).toBe("call");
  });

  it("le webhook GHL journalise en tant que système (domain system, sans actorId)", async () => {
    const t = makeT();
    await t.mutation(internal.webhooks.createLeadFromWebhook, {
      externalId: "c1", data: { firstName: "Jean", lastName: "Dupont" }, signals: { utmSource: "fb" },
    });
    const rows = await allRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: "system", actorName: "GHL", action: "lead.created", entityType: "lead", subject: "Jean Dupont",
    });
    expect(rows[0].actorId).toBeUndefined();
    expect(rows[0].details).toMatchObject({ source: "GHL", channel: "meta" });
  });

  it("modification admin d'un compte : diff des champs changés uniquement", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin", name: "Root" });
    const targetId = await insertUser(t, { role: "setter", name: "Bob", email: "bob@ecoi.fr" });
    await asUser(t, adminId).mutation(api.users.adminUpdate, { userId: targetId, role: "commercial", name: "Bob" });
    const rows = await allRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("user.role_changed");
    expect(rows[0].domain).toBe("admin");
    expect(rows[0].details).toEqual({ before: { role: "setter" }, after: { role: "commercial" } });
    expect(rows[0].summary).toContain("rôle « Setter » → « Commercial »");
  });
});

describe("journal d'activité — lecture et périmètre", () => {
  async function seedMixed(t: ReturnType<typeof makeT>) {
    const admin = await insertUser(t, { role: "admin", name: "Root", email: "a@x.fr" });
    const setter = await insertUser(t, { role: "setter", name: "Alice", email: "s@x.fr" });
    const setterLead = await insertUser(t, { role: "setter_lead", name: "Lead S", email: "sl@x.fr" });
    const commercial = await insertUser(t, { role: "commercial", name: "Carl", email: "c@x.fr" });
    const commercialLead = await insertUser(t, { role: "commercial_lead", name: "Lead C", email: "cl@x.fr" });
    const backOffice = await insertUser(t, { role: "back_office", name: "Bo", email: "bo@x.fr" });
    const lead1 = await insertLead(t, { firstName: "Un", lastName: "Prospect" });
    const lead2 = await insertLead(t, { firstName: "Deux", lastName: "Prospect" });
    // setting
    await asUser(t, setter).mutation(api.leads.updateStatus, { leadId: lead1, status: "a_rappeler" });
    // closing
    await asUser(t, commercial).mutation(api.rdv.create, { leadId: lead2, commercialId: commercial, scheduledAt: Date.now() + 86_400_000 });
    // admin
    await asUser(t, admin).mutation(api.leads.assignSetter, { leadId: lead1, setterId: setter });
    // system
    await t.mutation(internal.webhooks.createLeadFromWebhook, { externalId: "g1", data: { firstName: "Ghl" }, signals: {} });
    return { admin, setter, setterLead, commercial, commercialLead, backOffice, lead1, lead2 };
  }

  const domainsOf = (page: any[]) => [...new Set(page.map((r) => r.domain))].sort();

  it("scopeForRole : matrice des rôles", () => {
    expect(scopeForRole("admin")).toEqual({ kind: "all" });
    expect(scopeForRole("commercial_lead")).toEqual({ kind: "all" });
    expect(scopeForRole("setter_lead")).toEqual({ kind: "domains", domains: ["setting", "system"] });
    expect(scopeForRole("back_office")).toEqual({ kind: "domains", domains: ["delivrabilite"] });
    expect(scopeForRole("finances")).toEqual({ kind: "domains", domains: ["finances", "delivrabilite"] });
    expect(scopeForRole("setter")).toEqual({ kind: "own" });
    expect(scopeForRole("technicien")).toEqual({ kind: "own" });
  });

  it("admin voit tout, ordre anté-chronologique", async () => {
    const t = makeT();
    const s = await seedMixed(t);
    const res = await asUser(t, s.admin).query(api.activityLog.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(res.page).toHaveLength(4);
    expect(domainsOf(res.page)).toEqual(["admin", "closing", "setting", "system"]);
    for (let i = 1; i < res.page.length; i++) expect(res.page[i - 1].at).toBeGreaterThanOrEqual(res.page[i].at);
  });

  it("setter_lead ne voit que setting + system ; setter ne voit que ses actions", async () => {
    const t = makeT();
    const s = await seedMixed(t);
    const lead = await asUser(t, s.setterLead).query(api.activityLog.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(domainsOf(lead.page)).toEqual(["setting", "system"]);
    // domaine hors périmètre demandé explicitement → vide
    const closing = await asUser(t, s.setterLead).query(api.activityLog.list, { paginationOpts: { numItems: 50, cursor: null }, domain: "closing" });
    expect(closing.page).toHaveLength(0);
    const own = await asUser(t, s.setter).query(api.activityLog.list, { paginationOpts: { numItems: 50, cursor: null } });
    expect(own.page).toHaveLength(1);
    expect(own.page[0].actorId).toBe(s.setter);
    // un setter qui demande un autre acteur est ramené à lui-même
    const forced = await asUser(t, s.setter).query(api.activityLog.list, { paginationOpts: { numItems: 50, cursor: null }, actorId: s.commercial });
    expect(forced.page.every((r: any) => r.actorId === s.setter)).toBe(true);
  });

  it("filtres : domaine, acteur, entité, lead, période", async () => {
    const t = makeT();
    const s = await seedMixed(t);
    const q = (extra: Record<string, unknown>) =>
      asUser(t, s.admin).query(api.activityLog.list, { paginationOpts: { numItems: 50, cursor: null }, ...extra });
    expect((await q({ domain: "closing" })).page.map((r: any) => r.action)).toEqual(["rdv.created"]);
    expect((await q({ actorId: s.setter })).page).toHaveLength(1);
    expect((await q({ entityType: "rdv" })).page).toHaveLength(1);
    expect((await q({ leadId: s.lead1 })).page.map((r: any) => r.action).sort()).toEqual(["lead.setter_assigned", "lead.status_changed"]);
    expect((await q({ from: Date.now() + 60_000 })).page).toHaveLength(0);
    expect((await q({ to: Date.now() - 60_000 })).page).toHaveLength(0);
  });

  it("recherche plein texte sur la phrase", async () => {
    const t = makeT();
    const s = await seedMixed(t);
    const res = await asUser(t, s.admin).query(api.activityLog.list, {
      paginationOpts: { numItems: 50, cursor: null }, search: "RDV",
    });
    expect(res.page.length).toBeGreaterThanOrEqual(1);
    expect(res.page.every((r: any) => /rdv/i.test(r.summary))).toBe(true);
  });

  it("forLead : historique d'un prospect, filtré par périmètre", async () => {
    const t = makeT();
    const s = await seedMixed(t);
    const admin = await asUser(t, s.admin).query(api.activityLog.forLead, { leadId: s.lead1 });
    expect(admin).toHaveLength(2);
    const bo = await asUser(t, s.backOffice).query(api.activityLog.forLead, { leadId: s.lead1 });
    expect(bo).toHaveLength(0);
    const own = await asUser(t, s.setter).query(api.activityLog.forLead, { leadId: s.lead1 });
    expect(own).toHaveLength(1);
  });

  it("myScope renvoie le périmètre du user", async () => {
    const t = makeT();
    const s = await seedMixed(t);
    expect(await asUser(t, s.admin).query(api.activityLog.myScope, {})).toMatchObject({ kind: "all" });
    expect(await asUser(t, s.setterLead).query(api.activityLog.myScope, {})).toMatchObject({ kind: "domains", domains: ["setting", "system"] });
    expect(await asUser(t, s.setter).query(api.activityLog.myScope, {})).toMatchObject({ kind: "own", userId: s.setter });
  });
});
