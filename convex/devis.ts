import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { customerPatch, dropUndefined, DevisExtraction } from "./model/devisExtraction";
import { requireRole, requireUser } from "./model/access";
import { extractFromPdf } from "./model/ocr";

const COMMERCIAL = ["admin", "commercial", "commercial_lead"] as const;
const UPLOAD = [
  "admin", "commercial", "commercial_lead",
  "delivrabilite", "responsable_technique", "back_office",
] as const;

function toResponse(row: Record<string, unknown>) {
  const { markedSignedById, deletedAt, ...rest } = row as Record<string, unknown>;
  void markedSignedById; void deletedAt;
  return rest;
}

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

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, [...UPLOAD]);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    leadId: v.id("leads"),
    storageId: v.id("_storage"),
    filename: v.string(),
    sizeBytes: v.number(),
    rdvId: v.optional(v.id("rdv")),
    projectId: v.optional(v.id("projects")),
    commercialId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...UPLOAD]);
    const devisId = await ctx.db.insert("devis", {
      leadId: args.leadId,
      projectId: args.projectId,
      rdvId: args.rdvId,
      commercialId: args.commercialId ?? user._id,
      status: "brouillon",
      storageId: args.storageId,
      filename: args.filename,
      sizeBytes: args.sizeBytes,
      ocrStatus: "pending",
      lignes: [],
      echeancier: [],
      extracted: {},
    });
    await ctx.scheduler.runAfter(0, internal.devis.runOcr, { devisId });
    return devisId;
  },
});

export const getById = query({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await ctx.db.get(args.devisId);
    if (!row || row.deletedAt !== undefined) return null;
    return toResponse(row);
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("devis")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    return rows
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime)
      .map(toResponse);
  },
});

export const getPdfUrl = query({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await ctx.db.get(args.devisId);
    if (!row || !row.storageId) return null;
    return await ctx.storage.getUrl(row.storageId);
  },
});

// Lecture minimale pour l'action OCR (qui n'a pas d'accès `ctx.db` direct).
export const getRowForOcr = internalQuery({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.devisId);
    if (!row) return null;
    return { storageId: row.storageId ?? null, filename: row.filename };
  },
});

// Action OCR (OpenRouter Vision) — câblée, non testée offline. Toujours résolue
// (les erreurs sont capturées → markOcrFailed) pour ne jamais casser le scheduler.
export const runOcr = action({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.devis.setOcrProcessing, { devisId: args.devisId });
    try {
      const row = await ctx.runQuery(internal.devis.getRowForOcr, { devisId: args.devisId });
      if (!row || !row.storageId) throw new Error("PDF introuvable");
      const blob = await ctx.storage.get(row.storageId);
      if (!blob) throw new Error("PDF introuvable en storage");
      const buf = Buffer.from(await blob.arrayBuffer());
      const extracted = await extractFromPdf(buf.toString("base64"), row.filename);
      await ctx.runMutation(internal.devis.applyExtraction, { devisId: args.devisId, extracted });
    } catch (err) {
      await ctx.runMutation(internal.devis.markOcrFailed, {
        devisId: args.devisId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
