/**
 * Propagation de l'état commercial vers le dossier délivrabilité.
 * Portage de ClientsService.syncFromCommercial/setSaleCancelled +
 * debrief-effects.commercialSaleActiveFromLeadStatus (NestJS).
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { FinancingType } from "./enums";
import { recomputeClientStatus } from "./ensureDossier";

// État commercial de la vente déduit du statut lead :
//   true  → vente active     : dossier à (ré)activer + données à jour
//   false → vente perdue     : dossier à annuler (réversible)
//   null  → état intermédiaire (a_rappeler…) : on ne touche pas à l'annulation
export function commercialSaleActiveFromLeadStatus(leadStatus: string | null): boolean | null {
  if (leadStatus === "signe") return true;
  if (leadStatus === "perdu") return false;
  return null;
}

export type CommercialSyncInput = {
  leadId: Id<"leads">;
  active: boolean | null;
  montantTotal?: number | null;
  financingType?: FinancingType | null;
  kits?: string | null;
};

/**
 * Propage l'état commercial (statut + données dénormalisées) vers le dossier
 * délivrabilité EXISTANT du lead. No-op s'il n'existe aucun dossier : la
 * création reste réservée aux déclencheurs de signature (débrief vente /
 * devis signé / bootstrap). Idempotent — sûr à rappeler à chaque mutation
 * commerciale.
 */
export async function syncFromCommercial(
  ctx: MutationCtx,
  input: CommercialSyncInput,
): Promise<void> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_lead", (q) => q.eq("leadId", input.leadId))
    .collect();
  const existing = rows.find((c) => c.deletedAt === undefined);
  if (!existing) return;

  // 1. Annulation (réversible) / réactivation du dossier.
  if (input.active === false) {
    await setSaleCancelled(ctx, existing, true);
  } else if (input.active === true) {
    await setSaleCancelled(ctx, existing, false);
  }

  // 2. Données dénormalisées : seules les valeurs fournies ET réellement
  //    différentes sont écrites (évite les updates inutiles).
  const patch: Record<string, unknown> = {};
  if (input.montantTotal != null && input.montantTotal !== existing.montantTotal)
    patch.montantTotal = input.montantTotal;
  if (input.financingType != null && input.financingType !== existing.typeFinancement)
    patch.typeFinancement = input.financingType;
  if (input.kits != null && input.kits !== existing.kits) patch.kits = input.kits;
  if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
}

/**
 * Annule (réversible) ou réactive un dossier en basculant ses étapes workflow.
 * statusGlobal n'est jamais saisi à la main : on agit sur les steps puis
 * recomputeClientStatus dérive 'annule' (cf. deriveClientStatus).
 *  - cancel=true  : toute étape active (≠ fait/annule) → 'annule'
 *  - cancel=false : toute étape 'annule' → 'a_faire' (réactivation ; le détail
 *    granulaire n'est pas restauré, on repart de zéro)
 * Idempotent : no-op si l'état cible est déjà atteint. Un dossier clôturé
 * (toutes étapes 'fait') n'est volontairement pas annulable ici.
 */
async function setSaleCancelled(
  ctx: MutationCtx,
  client: Doc<"clients">,
  cancel: boolean,
): Promise<void> {
  if (cancel ? client.statusGlobal === "annule" : client.statusGlobal !== "annule") return;
  const steps = await ctx.db
    .query("workflowSteps")
    .withIndex("by_client", (q) => q.eq("clientId", client._id))
    .collect();
  for (const s of steps) {
    if (cancel && s.status !== "fait" && s.status !== "annule") {
      await ctx.db.patch(s._id, { status: "annule" });
    } else if (!cancel && s.status === "annule") {
      await ctx.db.patch(s._id, { status: "a_faire" });
    }
  }
  await recomputeClientStatus(ctx, client._id);
}
