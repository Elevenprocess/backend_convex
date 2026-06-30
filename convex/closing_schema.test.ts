import { expect, test } from "vitest";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";

test("la table projects accepte un insert valide et l'expose", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "qualifie", firstName: "P" }));
  const projectId = await t.run((ctx: any) =>
    ctx.db.insert("projects", {
      leadId, commercialId: comId, name: "Projet P", status: "qualification",
    }));
  const row = await t.run((ctx: any) => ctx.db.get(projectId));
  expect(row.status).toBe("qualification");
  expect(row.leadId).toBe(leadId);
});

test("la table debriefs accepte un insert riche", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "qualifie", firstName: "D" }));
  const debriefId = await t.run((ctx: any) =>
    ctx.db.insert("debriefs", {
      leadId, commercialId: comId, outcome: "vente",
      acceptanceFactors: ["aides", "financement"], customEcheancier: false,
      montantTotal: 15000, paymentSubMethod: "virement",
    }));
  const row = await t.run((ctx: any) => ctx.db.get(debriefId));
  expect(row.outcome).toBe("vente");
  expect(row.acceptanceFactors).toEqual(["aides", "financement"]);
  const found = await t.run((ctx: any) =>
    ctx.db.query("debriefs").withIndex("by_lead", (q: any) => q.eq("leadId", leadId)).collect());
  expect(found).toHaveLength(1);
});
