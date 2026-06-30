import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { customerPatch, dropUndefined, DevisExtraction } from "./model/devisExtraction";

export const setOcrProcessing = internalMutation({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.devisId, { ocrStatus: "processing" });
    return null;
  },
});

export const markOcrFailed = internalMutation({
  args: { devisId: v.id("devis"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.devisId, { ocrStatus: "failed", ocrError: args.error });
    return null;
  },
});

export const applyExtraction = internalMutation({
  args: { devisId: v.id("devis"), extracted: v.any() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.devisId);
    if (!row) return null;
    const ex = args.extracted as DevisExtraction;

    await ctx.db.patch(args.devisId, {
      ocrStatus: "done",
      ocrCompletedAt: Date.now(),
      extracted: ex,
      devisNumber: ex.devisNumber,
      devisDate: ex.devisDate,
      dateExpiration: ex.dateExpiration,
      delaiExecution: ex.delaiExecution,
      puissanceKwc: ex.puissanceKwc,
      nbPanneaux: ex.nbPanneaux,
      kits: ex.kits,
      montantHt: ex.montantHt,
      montantTva: ex.montantTva,
      montantTtc: ex.montantTtc,
      montantNet: ex.montantNet,
      financingType: ex.financingType as never,
      primeAutoconsommation: ex.prime?.montant,
      primeTarifKwc: ex.prime?.tarifEuroParKwc,
      primeZone: ex.prime?.zone,
      lignes: ex.lignes ?? [],
      echeancier: ex.echeancier ?? [],
    });

    // Patch lead depuis le customer nettoyé (≥1 champ non vide).
    const customer = customerPatch(ex.customer);
    const leadPatch = dropUndefined({ ...customer });
    if (Object.keys(leadPatch).length > 0) {
      await ctx.db.patch(row.leadId, leadPatch);
    }
    // Patch projet (adresse) si rattaché.
    if (row.projectId) {
      const projectPatch = dropUndefined({
        addressLine: customer.addressLine,
        postalCode: customer.postalCode,
        city: customer.city,
      });
      if (Object.keys(projectPatch).length > 0) {
        await ctx.db.patch(row.projectId, projectPatch);
      }
    }
    return null;
  },
});
