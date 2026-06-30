import { expect, test } from "vitest";
import { makeT } from "./test.kit";
import { insertUser } from "./test.helpers";

test("la table devis accepte un insert et expose by_lead", async () => {
  const t = makeT();
  const comId = await insertUser(t, { role: "commercial" });
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "qualifie", firstName: "D" }));
  const storageId = await t.run((ctx: any) => ctx.storage.store(new Blob(["%PDF-1.4"])));
  const devisId = await t.run((ctx: any) =>
    ctx.db.insert("devis", {
      leadId, commercialId: comId, status: "brouillon", ocrStatus: "pending",
      storageId, filename: "devis.pdf", sizeBytes: 8, lignes: [], echeancier: [], extracted: {},
    }));
  const row = await t.run((ctx: any) => ctx.db.get(devisId));
  expect(row.status).toBe("brouillon");
  const found = await t.run((ctx: any) =>
    ctx.db.query("devis").withIndex("by_lead", (q: any) => q.eq("leadId", leadId)).collect());
  expect(found).toHaveLength(1);
});
