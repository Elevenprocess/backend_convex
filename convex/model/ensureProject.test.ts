import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { insertUser } from "../test.helpers";
import { ensureProjectForLead } from "./ensureProject";

async function seedLead(t: any) {
  return await t.run((ctx: any) =>
    ctx.db.insert("leads", {
      source: "manual", status: "qualifie",
      firstName: "Jean", lastName: "Dupont",
      addressLine: "1 rue X", postalCode: "75001", city: "Paris",
    }));
}

test("crée un projet signe quand le lead n'en a aucun", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  const projectId = await t.run((ctx: any) =>
    ensureProjectForLead(ctx, { leadId, commercialId: comId }));
  const p = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(p.status).toBe("signe");
  expect(p.name).toBe("Jean Dupont");
  expect(p.city).toBe("Paris");
  expect(p.commercialId).toBe(comId);
});

test("réutilise le projet ouvert le plus récent et le passe en signe", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  const openId = await t.run((ctx: any) =>
    ctx.db.insert("projects", {
      leadId, commercialId: comId, name: "Projet ouvert", status: "qualification",
    }));
  const projectId = await t.run((ctx: any) =>
    ensureProjectForLead(ctx, { leadId, commercialId: comId }));
  expect(projectId).toBe(openId);
  const p = await t.run((ctx: any) => ctx.db.get(openId));
  expect(p.status).toBe("signe");
  const all = await t.run((ctx: any) =>
    ctx.db.query("projects").withIndex("by_lead", (q: any) => q.eq("leadId", leadId)).collect());
  expect(all).toHaveLength(1);
});

test("ignore les projets perdus/supprimés et en crée un neuf", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  await t.run((ctx: any) =>
    ctx.db.insert("projects", { leadId, commercialId: comId, name: "Perdu", status: "perdu" }));
  await t.run((ctx: any) =>
    ctx.db.insert("projects", { leadId, commercialId: comId, name: "Suppr", status: "qualification", deletedAt: 1 }));
  const projectId = await t.run((ctx: any) =>
    ensureProjectForLead(ctx, { leadId, commercialId: comId }));
  const p = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(p.status).toBe("signe");
  expect(p.name).toBe("Jean Dupont");
});

test("deux ventes successives réutilisent le même projet (idempotent)", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await seedLead(t);
  const a = await t.run((ctx: any) => ensureProjectForLead(ctx, { leadId, commercialId: comId }));
  const b = await t.run((ctx: any) => ensureProjectForLead(ctx, { leadId, commercialId: comId }));
  expect(b).toBe(a);
});
