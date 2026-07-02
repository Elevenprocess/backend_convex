// ─── payments — queries finances tranche 5 ────────────────────────────────────
// Expose l'échéancier finances via getAcompte et listAcomptes.
// S'appuie sur assembleEcheancier (Task 5) pour assembler un débrief.

import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./model/access";
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
