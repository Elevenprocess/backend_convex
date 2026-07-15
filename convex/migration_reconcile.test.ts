import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import type { Id } from "./_generated/dataModel";

async function seed(t: ReturnType<typeof makeT>) {
  const commercialId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "c@e.fr", name: "Paul", role: "commercial", active: true }),
  );
  const leadId = await t.run((ctx) =>
    ctx.db.insert("leads", { source: "ghl", status: "qualifie", externalId: "l1" }),
  );
  const rdvId = await t.run((ctx) =>
    ctx.db.insert("rdv", { leadId, commercialId, locationType: "domicile", status: "planifie", scheduledAt: 1000 }),
  );
  return { commercialId, leadId, rdvId };
}

async function insertDebrief(
  t: ReturnType<typeof makeT>,
  fields: { rdvId: Id<"rdv">; commercialId: Id<"users"> } & Record<string, unknown>,
) {
  return await t.run((ctx) =>
    ctx.db.insert("debriefs", {
      outcome: "non_vente",
      acceptanceFactors: [],
      customEcheancier: false,
      ...fields,
    } as any),
  );
}

describe("reconcileRdvDebriefs", () => {
  it("patche le RDV d'un débrief importé : result, status, debriefFilledAt = date métier", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    await insertDebrief(t, {
      rdvId, commercialId,
      outcome: "non_vente", nonSaleReason: "suivi_prevu",
      objection: "prix", notes: "à relancer",
      createdAt: 42_000,
    });
    const r = await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    expect(r).toMatchObject({ count: 1, applied: true });
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow!.result).toBe("reflexion");
    expect(rdvRow!.status).toBe("honore");
    expect(rdvRow!.debriefFilledAt).toBe(42_000);
    expect(rdvRow!.nonSaleReason).toBe("suivi_prevu");
    expect(rdvRow!.objections).toBe("prix");
    expect(rdvRow!.notes).toBe("à relancer");
  });

  it("dry-run par défaut : compte les diffs sans patcher", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    await insertDebrief(t, { rdvId, commercialId, outcome: "non_vente", nonSaleReason: "no_show" });
    const r = await t.mutation(internal.migration.reconcileRdvDebriefs, {});
    expect(r).toMatchObject({ count: 1, applied: false });
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow!.result).toBeUndefined();
    expect(rdvRow!.status).toBe("planifie");
    expect(rdvRow!.debriefFilledAt).toBeUndefined();
  });

  it("no_show → status no_show ; contact_annule → status annule", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    const rdvId2 = await t.run(async (ctx) => {
      const d = await ctx.db.get(rdvId);
      return ctx.db.insert("rdv", {
        leadId: d!.leadId, commercialId, locationType: "domicile", status: "planifie", scheduledAt: 2000,
      });
    });
    await insertDebrief(t, { rdvId, commercialId, outcome: "non_vente", nonSaleReason: "no_show" });
    await insertDebrief(t, { rdvId: rdvId2, commercialId, outcome: "non_vente", nonSaleReason: "contact_annule" });
    await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    const [r1, r2] = await t.run(async (ctx) => [await ctx.db.get(rdvId), await ctx.db.get(rdvId2)]);
    expect(r1!.status).toBe("no_show");
    expect(r1!.result).toBe("no_show");
    expect(r2!.status).toBe("annule");
    expect(r2!.result).toBe("perdu");
  });

  it("vente : copie montant/kits/financement/signature sur le RDV", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    await insertDebrief(t, {
      rdvId, commercialId,
      outcome: "vente", montantTotal: 15000, kits: "kit A", financingType: "comptant", signedAt: 5000,
    });
    await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow!.result).toBe("signe");
    expect(rdvRow!.status).toBe("honore");
    expect(rdvRow!.montantTotal).toBe(15000);
    expect(rdvRow!.kits).toBe("kit A");
    expect(rdvRow!.financingType).toBe("comptant");
    expect(rdvRow!.signatureAt).toBe(5000);
  });

  it("ne touche jamais un RDV déjà débriefé dans VELORA (debriefFilledAt ou result posé)", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(rdvId, { result: "signe", debriefFilledAt: 99_000, status: "honore" }));
    await insertDebrief(t, { rdvId, commercialId, outcome: "non_vente", nonSaleReason: "pas_interesse" });
    const r = await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    expect(r.count).toBe(0);
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow!.result).toBe("signe");
    expect(rdvRow!.debriefFilledAt).toBe(99_000);
  });

  it("plusieurs débriefs sur le même RDV : le plus récent (date métier) fait foi ; supprimés ignorés", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    await insertDebrief(t, { rdvId, commercialId, outcome: "non_vente", nonSaleReason: "pas_interesse", createdAt: 10_000 });
    await insertDebrief(t, { rdvId, commercialId, outcome: "vente", montantTotal: 8000, createdAt: 20_000 });
    await insertDebrief(t, {
      rdvId, commercialId, outcome: "non_vente", nonSaleReason: "no_show", createdAt: 30_000, deletedAt: 31_000,
    });
    const r = await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    expect(r.count).toBe(1);
    const rdvRow = await t.run((ctx) => ctx.db.get(rdvId));
    expect(rdvRow!.result).toBe("signe");
    expect(rdvRow!.debriefFilledAt).toBe(20_000);
  });

  it("idempotent : une seconde passe ne trouve plus rien", async () => {
    const t = makeT();
    const { commercialId, rdvId } = await seed(t);
    await insertDebrief(t, { rdvId, commercialId, outcome: "non_vente", nonSaleReason: "suivi_prevu" });
    await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    const r2 = await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    expect(r2.count).toBe(0);
  });

  it("ignore les débriefs sans rdvId (détachés) et les RDV supprimés", async () => {
    const t = makeT();
    const { commercialId, leadId, rdvId } = await seed(t);
    await t.run((ctx) => ctx.db.patch(rdvId, { deletedAt: 1 }));
    await insertDebrief(t, { rdvId, commercialId, outcome: "vente" });
    await t.run((ctx) =>
      ctx.db.insert("debriefs", {
        leadId, commercialId, outcome: "vente", acceptanceFactors: [], customEcheancier: false,
      } as any),
    );
    const r = await t.mutation(internal.migration.reconcileRdvDebriefs, { apply: true });
    expect(r.count).toBe(0);
  });
});
