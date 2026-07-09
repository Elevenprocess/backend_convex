/**
 * Pièces jointes projet (photos/documents commercial & délivrabilité).
 * Portage de ProjectAttachmentsController/Service (NestJS) : upload via storage
 * Convex (pattern devis/documents), URL de lecture signée (remplace /raw+CORS),
 * soft-delete. La matérialisation croisée vers `documents` reste différée.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireRole } from "./model/access";
import type { Role } from "./model/enums";

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 Mo / fichier
const ALLOWED_KINDS = ["photo", "document"];

// Dépôt/suppression : admin + commerciaux + délivrabilité.
const MANAGE_ROLES: Role[] = ["admin", "commercial", "commercial_lead", "delivrabilite", "responsable_technique", "back_office"];
// Lecture : + setters + finances.
export const READ_ROLES: Role[] = ["admin", "setter", "setter_lead", "commercial", "commercial_lead", "delivrabilite", "responsable_technique", "back_office", "finances"];

export function toSummary(row: Doc<"projectAttachments">, url?: string) {
  return {
    id: row._id,
    projectId: row.projectId,
    uploadedById: row.uploadedById,
    kind: row.kind,
    label: row.label,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row._creationTime,
    // URL signée du storage (utilisable direct en <img src>, remplace /raw+CORS).
    // Absente si le blob migré a été perdu.
    url,
  };
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, MANAGE_ROLES);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    kind: v.string(),
    label: v.optional(v.string()),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, MANAGE_ROLES);
    if (!ALLOWED_KINDS.includes(args.kind)) {
      throw new Error(`kind doit être l'un de : ${ALLOWED_KINDS.join(", ")}`);
    }
    const project = await ctx.db.get(args.projectId);
    if (!project || project.deletedAt !== undefined) throw new Error("Projet introuvable");
    if (args.sizeBytes > MAX_ATTACHMENT_SIZE) throw new Error(`« ${args.filename} » dépasse 25 Mo.`);

    const label = args.label?.trim() || undefined;
    const id = await ctx.db.insert("projectAttachments", {
      projectId: args.projectId,
      uploadedById: user._id,
      kind: args.kind,
      ...(label !== undefined ? { label } : {}),
      filename: args.filename,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      storageId: args.storageId,
    });
    const row = (await ctx.db.get(id))!;
    const url = (await ctx.storage.getUrl(args.storageId)) ?? undefined;
    return toSummary(row, url);
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, READ_ROLES);
    const rows = await ctx.db
      .query("projectAttachments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const active = rows.filter((a) => a.deletedAt === undefined);
    return await Promise.all(
      active.map(async (a) => {
        const url = a.storageId ? ((await ctx.storage.getUrl(a.storageId)) ?? undefined) : undefined;
        return toSummary(a, url);
      }),
    );
  },
});

export const getUrl = query({
  args: { attachmentId: v.id("projectAttachments") },
  handler: async (ctx, args) => {
    await requireRole(ctx, READ_ROLES);
    const row = await ctx.db.get(args.attachmentId);
    if (!row || row.deletedAt !== undefined) return null;
    if (!row.storageId) return null; // blob migré perdu avant la bascule
    const url = await ctx.storage.getUrl(row.storageId);
    if (!url) return null;
    return { url, filename: row.filename, contentType: row.contentType };
  },
});

export const remove = mutation({
  args: { attachmentId: v.id("projectAttachments") },
  handler: async (ctx, args) => {
    await requireRole(ctx, MANAGE_ROLES);
    const row = await ctx.db.get(args.attachmentId);
    if (!row || row.deletedAt !== undefined) throw new Error("Pièce jointe introuvable");
    await ctx.db.patch(args.attachmentId, { deletedAt: Date.now() });
    if (row.storageId) await ctx.storage.delete(row.storageId);
    return { ok: true };
  },
});
