// ─── payments — queries + mutations finances tranche 5 ────────────────────────
// Expose l'échéancier finances via getAcompte et listAcomptes.
// Mutation updateFinancing : patch partiel des champs finance d'un débrief vente.
// L'échéancier est dérivé à la lecture (assembleEcheancier) : changer
// financingType/montantTotal/etc. recalcule les tranches au prochain getAcompte.
// S'appuie sur assembleEcheancier (Task 5) pour assembler un débrief.

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./model/access";
import {
  financingTypeValidator,
  paymentSubMethodValidator,
  financingOrgValidator,
} from "./model/enums";
import {
  assembleEcheancier,
  AcompteResponse,
} from "./model/assembleEcheancier";

// Rôles autorisés pour les queries finances.
const FINANCES_ROLES = [
  "admin",
  "finances",
  "delivrabilite",
  "responsable_technique",
  "back_office",
] as const;

// ─── listAcomptes ─────────────────────────────────────────────────────────────
// Retourne l'échéancier de tous les débriefs vente éligibles :
//   - outcome === "vente"
//   - non supprimés (deletedAt absent)
//   - montantTotal > 0 OU acompteAmount > 0
export const listAcomptes = query({
  args: { today: v.string() },
  handler: async (ctx, args): Promise<AcompteResponse[]> => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    const debriefs = await ctx.db
      .query("debriefs")
      .withIndex("by_outcome", (q) => q.eq("outcome", "vente"))
      .collect();

    const results: AcompteResponse[] = [];
    for (const debrief of debriefs) {
      // Exclure les soft-deleted
      if (debrief.deletedAt !== undefined) continue;

      // Exclure sans montant significatif
      const hasMontant =
        (debrief.montantTotal != null && debrief.montantTotal > 0) ||
        (debrief.acompteAmount != null && debrief.acompteAmount > 0);
      if (!hasMontant) continue;

      const assembled = await assembleEcheancier(ctx, debrief, {
        today: args.today,
      });
      if (assembled !== null) {
        results.push(assembled);
      }
    }
    return results;
  },
});

// ─── getAcompte ───────────────────────────────────────────────────────────────
// Assemble l'échéancier pour UN débrief donné.
// Lève une erreur si le débrief est introuvable ou soft-deleted.
export const getAcompte = query({
  args: {
    debriefId: v.id("debriefs"),
    today: v.string(),
  },
  handler: async (ctx, args): Promise<AcompteResponse | null> => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    return await assembleEcheancier(ctx, debrief, { today: args.today });
  },
});

// ─── updateFinancing ──────────────────────────────────────────────────────────
// Patch partiel des champs finance d'un débrief vente.
// L'échéancier étant dérivé à la LECTURE (assembleEcheancier), modifier
// financingType/montantTotal recalcule les tranches au prochain getAcompte —
// aucune réécriture des acompte_echeances n'est nécessaire.
//
// Décision null vs absent : les champs Convex (schema debrief) sont
// v.optional(v.number()/validator), non nullable. On ne supporte donc pas null
// dans ce patch — un champ absent du payload = « ne pas toucher ».
// Cohérent avec la sémantique Convex (pas de null en base pour ces colonnes).
export const updateFinancing = mutation({
  args: {
    debriefId: v.id("debriefs"),
    montantTotal: v.optional(v.number()),
    financingType: v.optional(financingTypeValidator),
    paymentSubMethod: v.optional(paymentSubMethodValidator),
    financingOrg: v.optional(financingOrgValidator),
    acomptePercent: v.optional(v.number()),
    acompteAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...FINANCES_ROLES]);

    // Construire le patch sans écraser les champs absents (undefined non inclus).
    const patch: Record<string, unknown> = {};
    if (args.montantTotal !== undefined) patch.montantTotal = args.montantTotal;
    if (args.financingType !== undefined) patch.financingType = args.financingType;
    if (args.paymentSubMethod !== undefined) patch.paymentSubMethod = args.paymentSubMethod;
    if (args.financingOrg !== undefined) patch.financingOrg = args.financingOrg;
    if (args.acomptePercent !== undefined) patch.acomptePercent = args.acomptePercent;
    if (args.acompteAmount !== undefined) patch.acompteAmount = args.acompteAmount;

    if (Object.keys(patch).length === 0) {
      throw new Error("Au moins un champ à mettre à jour est requis");
    }

    const debrief = await ctx.db.get(args.debriefId);
    if (!debrief || debrief.deletedAt !== undefined) {
      throw new Error("Débrief introuvable");
    }

    await ctx.db.patch(args.debriefId, patch as any);
    return null;
  },
});
