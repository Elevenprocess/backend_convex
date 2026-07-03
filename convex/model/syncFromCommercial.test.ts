import { expect, test } from "vitest";
import { makeT } from "../test.kit";
import { ensureDossier } from "./ensureDossier";
import { syncFromCommercial, commercialSaleActiveFromLeadStatus } from "./syncFromCommercial";

async function seed(t: ReturnType<typeof makeT>) {
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "signe", firstName: "S" }),
  );
  const clientId = await t.run((ctx: any) =>
    ensureDossier(ctx, { leadId, montantTotal: 10000 }),
  );
  return { leadId, clientId };
}

test("commercialSaleActiveFromLeadStatus : signe→true, perdu→false, sinon null", () => {
  expect(commercialSaleActiveFromLeadStatus("signe")).toBe(true);
  expect(commercialSaleActiveFromLeadStatus("perdu")).toBe(false);
  expect(commercialSaleActiveFromLeadStatus("a_rappeler")).toBeNull();
  expect(commercialSaleActiveFromLeadStatus(null)).toBeNull();
});

test("no-op sans dossier existant (pas de création)", async () => {
  const t = makeT();
  const leadId = await t.run((ctx: any) =>
    ctx.db.insert("leads", { source: "manual", status: "perdu" }),
  );
  await t.run((ctx: any) => syncFromCommercial(ctx, { leadId, active: false }));
  expect(await t.run((ctx: any) => ctx.db.query("clients").collect())).toHaveLength(0);
});

test("active:false → steps actifs annulés + statusGlobal annule ; fait préservé", async () => {
  const t = makeT();
  const { leadId, clientId } = await seed(t);
  // Marquer la phase vt 'fait' à la main (statut step = saisie)
  await t.run(async (ctx: any) => {
    const vt = await ctx.db
      .query("workflowSteps")
      .withIndex("by_client_phase", (q: any) => q.eq("clientId", clientId).eq("phase", "vt"))
      .first();
    await ctx.db.patch(vt._id, { status: "fait" });
  });
  await t.run((ctx: any) => syncFromCommercial(ctx, { leadId, active: false }));
  const steps = await t.run((ctx: any) =>
    ctx.db.query("workflowSteps").withIndex("by_client", (q: any) => q.eq("clientId", clientId)).collect(),
  );
  expect(steps.find((s: any) => s.phase === "vt").status).toBe("fait"); // préservé
  expect(steps.filter((s: any) => s.status === "annule")).toHaveLength(5);
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("annule");
});

test("active:true réactive (annule → a_faire) ; idempotent", async () => {
  const t = makeT();
  const { leadId, clientId } = await seed(t);
  await t.run((ctx: any) => syncFromCommercial(ctx, { leadId, active: false }));
  await t.run((ctx: any) => syncFromCommercial(ctx, { leadId, active: true }));
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("vt_a_faire");
  // Rappels idempotents
  await t.run((ctx: any) => syncFromCommercial(ctx, { leadId, active: true }));
  expect((await t.run((ctx: any) => ctx.db.get(clientId))).statusGlobal).toBe("vt_a_faire");
});

test("active:null → annulation intacte, données patchées si différentes", async () => {
  const t = makeT();
  const { leadId, clientId } = await seed(t);
  await t.run((ctx: any) => syncFromCommercial(ctx, { leadId, active: false }));
  await t.run((ctx: any) =>
    syncFromCommercial(ctx, { leadId, active: null, montantTotal: 12000, kits: "Kit 9" }),
  );
  const client = await t.run((ctx: any) => ctx.db.get(clientId));
  expect(client.statusGlobal).toBe("annule"); // intact
  expect(client.montantTotal).toBe(12000);
  expect(client.kits).toBe("Kit 9");
});
