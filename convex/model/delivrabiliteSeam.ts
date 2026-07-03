import { QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { EcheanceJalon, WorkflowSubstepKey } from "./enums";

// SEAM DÉLIVRABILITÉ — câblé en 6a : lit clients/workflowSubsteps.
// Point de contact UNIQUE entre paiements et délivrabilité.

/**
 * Résout le dossier délivrabilité actif : by_project prioritaire, fallback
 * by_lead (dossiers legacy sans projet, fidèle au tracé leadId du NestJS).
 */
async function resolveDossier(
  ctx: QueryCtx,
  args: { projectId?: Id<"projects">; leadId?: Id<"leads"> },
): Promise<Doc<"clients"> | null> {
  if (args.projectId !== undefined) {
    const rows = await ctx.db
      .query("clients")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
      .collect();
    const active = rows.find((c) => c.deletedAt === undefined);
    if (active) return active;
  }
  if (args.leadId !== undefined) {
    const rows = await ctx.db
      .query("clients")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId!))
      .collect();
    return rows.find((c) => c.deletedAt === undefined) ?? null;
  }
  return null;
}

/**
 * Jalon franchi ? 'signature' = toujours vrai (vente signée, pas un substep).
 * Les autres jalons correspondent à une clé de sous-étape workflow : atteint
 * quand le substep du dossier actif est `fait`.
 */
export async function isJalonReached(
  ctx: QueryCtx,
  args: { projectId?: Id<"projects">; leadId?: Id<"leads">; jalonKey: EcheanceJalon | null },
): Promise<boolean> {
  if (args.jalonKey === null) return false;
  if (args.jalonKey === "signature") return true;

  const dossier = await resolveDossier(ctx, args);
  if (!dossier) return false;

  const substep = await ctx.db
    .query("workflowSubsteps")
    .withIndex("by_client_key", (q) =>
      q.eq("clientId", dossier._id).eq("key", args.jalonKey as WorkflowSubstepKey),
    )
    .first();
  return substep?.status === "fait";
}

/** Statut global du dossier actif (null si aucun dossier). */
export async function clientStatusGlobal(
  ctx: QueryCtx,
  args: { projectId?: Id<"projects">; leadId?: Id<"leads"> },
): Promise<string | null> {
  const dossier = await resolveDossier(ctx, args);
  return dossier?.statusGlobal ?? null;
}
