/**
 * Import ponctuel de pièces (PDF Drive) vers les sous-étapes workflow.
 * Compagnon de deliverySheetImport : le driver local télécharge les fichiers
 * (Drive → zip), les pousse dans le storage via generateImportUploadUrl, puis
 * appelle attachImported qui crée la ligne `documents` sur la sous-étape du
 * dossier et, si la pièce le prouve (markDone — ex. arrêté de non-opposition
 * → dp_validee), coche le jalon en upgrade-only.
 *
 * Usage :
 *   npx convex run documentsImport:generateImportUploadUrl '{}'
 *   → POST <url> (Content-Type: application/pdf, body = bytes) → {storageId}
 *   npx convex run documentsImport:attachImported '{...}'
 *
 * Idempotent : même (dossier, sous-étape, filename) déjà présent → skip et
 * le blob fraîchement uploadé est supprimé (pas d'orphelin storage).
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  documentTypeValidator,
  workflowSubstepKeyValidator,
} from "./model/enums";
import { recomputePhase, recomputeClientStatus } from "./model/ensureDossier";

export const generateImportUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const attachImported = internalMutation({
  args: {
    clientId: v.id("clients"),
    substepKey: workflowSubstepKeyValidator,
    type: documentTypeValidator,
    storageId: v.id("_storage"),
    filename: v.string(),
    sizeBytes: v.number(),
    mimeType: v.string(),
    // Cocher le jalon si la pièce le prouve (upgrade-only, jamais depuis
    // probleme/annule ; recompute phase + dossier derrière).
    markDone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.deletedAt !== undefined) {
      await ctx.storage.delete(args.storageId);
      return { ok: false as const, reason: "dossier introuvable" };
    }

    const substep = await ctx.db
      .query("workflowSubsteps")
      .withIndex("by_client_key", (q) =>
        q.eq("clientId", args.clientId).eq("key", args.substepKey),
      )
      .first();
    if (!substep) {
      await ctx.storage.delete(args.storageId);
      return { ok: false as const, reason: `sous-étape ${args.substepKey} absente` };
    }

    // Doublon (même sous-étape + même nom de fichier, non supprimé) → skip.
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_substep", (q) => q.eq("workflowSubstepId", substep._id))
      .collect();
    if (existing.some((d) => d.deletedAt === undefined && d.filename === args.filename)) {
      await ctx.storage.delete(args.storageId);
      return { ok: true as const, skipped: true as const };
    }

    await ctx.db.insert("documents", {
      clientId: args.clientId,
      workflowStepId: substep.stepId,
      workflowSubstepId: substep._id,
      type: args.type,
      storageId: args.storageId,
      filename: args.filename,
      sizeBytes: args.sizeBytes,
      mimeType: args.mimeType,
    });

    let statusUpgraded = false;
    if (
      args.markDone === true &&
      ["a_faire", "planifie", "en_cours", "en_attente"].includes(substep.status)
    ) {
      await ctx.db.patch(substep._id, { status: "fait" });
      await recomputePhase(ctx, substep.stepId);
      await recomputeClientStatus(ctx, args.clientId);
      statusUpgraded = true;
    }

    return { ok: true as const, skipped: false as const, statusUpgraded };
  },
});
