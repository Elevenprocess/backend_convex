import { describe, test, expect } from "vitest";
import { makeT } from "../test.kit";
import { assembleEcheancier } from "./assembleEcheancier";

// Seed helpers ----------------------------------------------------------------

async function insertCommercial(ctx: any): Promise<any> {
  return ctx.db.insert("users", {
    email: "commercial@test.fr",
    name: "Jean Dupont",
    role: "commercial",
    active: true,
  } as any);
}

async function insertLead(ctx: any, source = "manual"): Promise<any> {
  return ctx.db.insert("leads", {
    source,
    status: "signe",
    firstName: "Alice",
    lastName: "Martin",
  } as any);
}

async function insertDebrief(
  ctx: any,
  comId: any,
  leadId: any,
  extra: Record<string, any> = {},
): Promise<any> {
  return ctx.db.insert("debriefs", {
    commercialId: comId,
    leadId,
    outcome: "vente",
    acceptanceFactors: [],
    customEcheancier: false,
    ...extra,
  } as any);
}

// Tests -----------------------------------------------------------------------

describe("assembleEcheancier", () => {
  test("statut en_attente hors signature (seam stub)", async () => {
    // Débrief comptant 10 000 €, aucune ligne persistée.
    // isJalonReached retourne false pour tout jalon sauf 'signature' (seam stub).
    // Le template comptant a 4 tranches sur vt_validee/dp_envoyee_mairie/install_a_faire/install_effectuee.
    // → 4 tranches en_attente.
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx);
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "comptant",
        montantTotal: 10000,
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-02" });
      expect(result).not.toBeNull();
      expect(result!.echeances).toHaveLength(4);
      expect(result!.echeances.every((e: any) => e.statut === "en_attente")).toBe(true);
      expect(result!.totalEncaisse).toBeNull();
    });
  });

  test("ligne encaissée persistée reflétée + totalEncaisse/resteAPayer", async () => {
    // Débrief comptant 10 000 €. Une ligne persistée ordre=1 statut=encaisse
    // montantReel=4000. → echeances[0].statut === "encaisse", totalEncaisse === 4000,
    // resteAPayer === 6000.
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx);
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "comptant",
        montantTotal: 10000,
      });
      await ctx.db.insert("acompteEcheances", {
        debriefId,
        leadId,
        ordre: 1,
        statut: "encaisse",
        montantReel: 4000,
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-02" });
      expect(result).not.toBeNull();
      expect(result!.echeances[0].statut).toBe("encaisse");
      expect(result!.echeances[0].montantReel).toBe(4000);
      expect(result!.totalEncaisse).toBe(4000);
      expect(result!.resteAPayer).toBe(6000);
    });
  });

  test("orphan guard : ordre hors template en lecture seule", async () => {
    // Débrief financement (1 tranche template : ordre=1). Ligne persistée ordre=3
    // encaissée. → 2 lignes en sortie : ordre 1 (template) + ordre 3 (orphelin),
    // l'orphelin est lu en statut forcé en_attente car readonly.
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx);
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "financement",
        montantTotal: 20000,
      });
      // Ligne orpheline (ordre 3 hors du template financement = 1 seule tranche)
      await ctx.db.insert("acompteEcheances", {
        debriefId,
        leadId,
        ordre: 3,
        statut: "encaisse",
        montantReel: 5000,
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-02" });
      expect(result).not.toBeNull();
      expect(result!.echeances).toHaveLength(2);
      // Template tranche d'abord
      expect(result!.echeances[0].ordre).toBe(1);
      // Orphelin en dernier
      expect(result!.echeances[1].ordre).toBe(3);
      expect(result!.echeances[1].statut).toBe("encaisse");
    });
  });

  test("retard : dateEcheance < today et due → en_retard", async () => {
    // Débrief importé (airtable_migration) = IMPORTED_TEMPLATE (premier jalon :
    // 'signature'). Ligne persistée ordre=1, dateEcheance='2020-01-01', statut
    // 'a_encaisser' (non encaissé). today='2026-07-01' → en_retard.
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx, "airtable_migration");
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "comptant",
        montantTotal: 15000,
      });
      await ctx.db.insert("acompteEcheances", {
        debriefId,
        leadId,
        ordre: 1,
        statut: "a_encaisser",
        dateEcheance: "2020-01-01",
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-01" });
      expect(result).not.toBeNull();
      expect(result!.echeances[0].statut).toBe("en_retard");
      expect(result!.echeances[0].dateEcheance).toBe("2020-01-01");
    });
  });

  test("commercialName résolu depuis users", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx);
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "comptant",
        montantTotal: 10000,
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-02" });
      expect(result!.commercialName).toBe("Jean Dupont");
    });
  });

  test("edfRecepisse false (seam stub : racco_validee non atteint)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx);
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "financement",
        montantTotal: 20000,
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-02" });
      expect(result!.edfRecepisse).toBe(false);
    });
  });

  test("templates vides = null (10x sans acompte)", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      const comId = await insertCommercial(ctx);
      const leadId = await insertLead(ctx);
      const debriefId = await insertDebrief(ctx, comId, leadId, {
        financingType: "paiement_10x",
        montantTotal: 10000,
      });
      const debrief = await ctx.db.get(debriefId);
      const result = await assembleEcheancier(ctx, debrief!, { today: "2026-07-02" });
      expect(result).toBeNull();
    });
  });
});
