/**
 * Documents (pièces) des sous-étapes workflow.
 * Portage de DocumentsController/DocumentsService (NestJS) : upload via
 * storage Convex (pattern devis), URL de lecture signée (remplace /raw+CORS),
 * soft-delete. Matérialisation des pièces importées différée (migration finale).
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireRole } from "./model/access";
import { WORKFLOW_ROLES } from "./clients";
import { canEditSubstep } from "./model/delivrabilitePermissions";
import { catalogByKey } from "./model/substepCatalog";
import type { DocumentType, Role } from "./model/enums";

const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024; // 25 Mo / fichier
// Upload/suppression : qui gère le workflow (technicien scopé par canEditSubstep).
const MANAGE_ROLES = WORKFLOW_ROLES;
const READ_ROLES: Role[] = [...WORKFLOW_ROLES, "finances"];
void READ_ROLES; // consommé par getUrl (Task 2)

export function toDocumentSummary(row: Doc<"documents">) {
  return {
    id: row._id,
    type: row.type,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row._creationTime,
  };
}

/** Documents actifs d'une sous-étape. */
export async function activeDocsOfSubstep(
  ctx: QueryCtx,
  substepId: Id<"workflowSubsteps">,
): Promise<Doc<"documents">[]> {
  const rows = await ctx.db
    .query("documents")
    .withIndex("by_substep", (q) => q.eq("workflowSubstepId", substepId))
    .collect();
  return rows.filter((d) => d.deletedAt === undefined);
}

// Mêmes droits que l'édition de la sous-étape porteuse.
async function assertCanManage(
  ctx: QueryCtx,
  user: Doc<"users">,
  substep: Doc<"workflowSubsteps">,
): Promise<void> {
  const client = await ctx.db.get(substep.clientId);
  const phase = catalogByKey(substep.key)?.phase ?? "vt";
  if (!canEditSubstep(user, { phase, clientTechnicienVtId: client?.technicienVtId ?? null })) {
    throw new Error(`Rôle ${user.role} non autorisé sur les documents de cette sous-étape`);
  }
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, MANAGE_ROLES);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attachToSubstep = mutation({
  args: {
    substepId: v.id("workflowSubsteps"),
    files: v.array(
      v.object({
        storageId: v.id("_storage"),
        filename: v.string(),
        mimeType: v.string(),
        sizeBytes: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, MANAGE_ROLES);
    const substep = await ctx.db.get(args.substepId);
    if (!substep) throw new Error(`Sous-étape ${args.substepId} introuvable`);
    await assertCanManage(ctx, user, substep);

    if (args.files.length === 0) throw new Error("Aucun fichier reçu.");
    const tooBig = args.files.find((f) => f.sizeBytes > MAX_DOCUMENT_SIZE);
    if (tooBig) throw new Error(`« ${tooBig.filename} » dépasse 25 Mo.`);

    // Type auto-déduit du catalogue : permet au badge « pièce manquante » de
    // disparaître. Sous-étape multi-docs → 1er type attendu.
    const def = catalogByKey(substep.key);
    const type: DocumentType = def?.expectedDocs[0] ?? "autre";

    const created = [];
    for (const file of args.files) {
      const id = await ctx.db.insert("documents", {
        clientId: substep.clientId,
        workflowStepId: substep.stepId,
        workflowSubstepId: substep._id,
        type,
        storageId: file.storageId,
        filename: file.filename,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        uploadedById: user._id,
      });
      created.push(toDocumentSummary((await ctx.db.get(id))!));
    }

    // Module « dépôt seul » : la date de réalisation se cale sur le jour du dépôt.
    if (def?.depositOnly && created.length > 0) {
      const today = new Date(Date.now()).toISOString().slice(0, 10);
      await ctx.db.patch(substep._id, { dateRealisee: today });
    }

    return created;
  },
});
