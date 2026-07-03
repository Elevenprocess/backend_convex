import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { customerPatch, dropUndefined, DevisExtraction } from "./model/devisExtraction";
import { requireRole, requireUser } from "./model/access";
import { extractFromPdf } from "./model/ocr";
import { syncStatusToLeadAndProject } from "./model/devisStatusSync";
import { ensureDossier } from "./model/ensureDossier";
import { devisStatusValidator, financingTypeValidator } from "./model/enums";

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

export const update = mutation({
  args: {
    devisId: v.id("devis"),
    status: v.optional(devisStatusValidator),
    devisNumber: v.optional(v.union(v.string(), v.null())),
    devisDate: v.optional(v.union(v.string(), v.null())),
    dateExpiration: v.optional(v.union(v.string(), v.null())),
    delaiExecution: v.optional(v.union(v.string(), v.null())),
    puissanceKwc: v.optional(v.union(v.number(), v.null())),
    nbPanneaux: v.optional(v.union(v.number(), v.null())),
    kits: v.optional(v.union(v.string(), v.null())),
    montantHt: v.optional(v.union(v.number(), v.null())),
    montantTva: v.optional(v.union(v.number(), v.null())),
    montantTtc: v.optional(v.union(v.number(), v.null())),
    montantNet: v.optional(v.union(v.number(), v.null())),
    financingType: v.optional(v.union(financingTypeValidator, v.null())),
    primeAutoconsommation: v.optional(v.union(v.number(), v.null())),
    primeTarifKwc: v.optional(v.union(v.number(), v.null())),
    primeZone: v.optional(v.union(v.string(), v.null())),
    lignes: v.optional(v.array(v.any())),
    echeancier: v.optional(v.array(v.any())),
    vendor: v.optional(v.any()),
    customer: v.optional(v.any()),
    prime: v.optional(v.any()),
    conditionsReglement: v.optional(v.union(v.string(), v.null())),
    financingDetails: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const row = await ctx.db.get(args.devisId);
    if (!row) throw new Error("Devis introuvable");
    if (row.status === "signe") throw new Error("Devis signé : modification interdite.");

    const patch: Record<string, unknown> = {};
    const scalarKeys = [
      "status", "devisNumber", "devisDate", "dateExpiration", "delaiExecution",
      "puissanceKwc", "nbPanneaux", "kits", "montantHt", "montantTva", "montantTtc",
      "montantNet", "financingType", "primeAutoconsommation", "primeTarifKwc",
      "primeZone", "lignes", "echeancier",
    ] as const;
    for (const k of scalarKeys) {
      const val = (args as Record<string, unknown>)[k];
      if (val !== undefined) patch[k] = val === null ? undefined : val;
    }

    // Merge extracted superficiel (vendor/customer/prime/conditionsReglement/
    // financingDetails) + recopie lignes/echeancier dans extracted (fidèle backend).
    const extractedKeys = ["vendor", "customer", "prime", "conditionsReglement", "financingDetails"] as const;
    const touchesExtracted = extractedKeys.some((k) => (args as Record<string, unknown>)[k] !== undefined);
    if (touchesExtracted || args.lignes !== undefined || args.echeancier !== undefined) {
      const current = (row.extracted ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...current };
      for (const k of extractedKeys) {
        if ((args as Record<string, unknown>)[k] !== undefined) next[k] = (args as Record<string, unknown>)[k];
      }
      if (args.lignes !== undefined) next.lignes = args.lignes;
      if (args.echeancier !== undefined) next.echeancier = args.echeancier;
      patch.extracted = next;
    }

    if (Object.keys(patch).length > 0) await ctx.db.patch(args.devisId, patch);

    if (args.status !== undefined && args.status !== row.status) {
      const updated = await ctx.db.get(args.devisId);
      if (updated) await syncStatusToLeadAndProject(ctx, updated);
    }
    const final = await ctx.db.get(args.devisId);
    return toResponse(final!);
  },
});

export const markAsSigned = mutation({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...COMMERCIAL]);
    const row = await ctx.db.get(args.devisId);
    if (!row) throw new Error("Devis introuvable");
    if (row.status === "signe") {
      await syncStatusToLeadAndProject(ctx, row);
      return toResponse(row);
    }

    const now = Date.now();
    await ctx.db.patch(args.devisId, { status: "signe", signedAt: now, markedSignedById: user._id });

    // Sync rdv inline (hors-scope : propagation échéancier → payments).
    if (row.rdvId) {
      const montantPourRdv = row.montantNet ?? row.montantTtc;
      await ctx.db.patch(row.rdvId, {
        result: "signe",
        signatureAt: now,
        montantTotal: montantPourRdv,
        financingType: row.financingType,
        kits: row.kits,
      });
    }

    // Garantit le dossier délivrabilité à la signature (fidèle à NestJS :
    // montantNet prioritaire = ce que le client paie réellement, hors prime EDF).
    await ensureDossier(ctx, {
      leadId: row.leadId,
      projectId: row.projectId,
      rdvId: row.rdvId,
      montantTotal: row.montantNet ?? row.montantTtc,
      typeFinancement: row.financingType,
      kits: row.kits,
      signedAt: now,
      actorId: user._id,
    });

    const updated = await ctx.db.get(args.devisId);
    if (updated) await syncStatusToLeadAndProject(ctx, updated);
    return toResponse(updated!);
  },
});

export const remove = mutation({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...UPLOAD]);
    const row = await ctx.db.get(args.devisId);
    if (!row) throw new Error("Devis introuvable");
    if (row.status === "signe") throw new Error("Devis signé : suppression interdite.");
    if (row.storageId) await ctx.storage.delete(row.storageId);
    await ctx.db.delete(args.devisId);
    return { id: args.devisId, deleted: true as const };
  },
});

export const retryOcr = mutation({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const row = await ctx.db.get(args.devisId);
    if (!row) throw new Error("Devis introuvable");
    if (row.ocrStatus !== "failed") {
      throw new Error(`OCR retry interdit : statut actuel = ${row.ocrStatus}`);
    }
    await ctx.db.patch(args.devisId, { ocrStatus: "pending", ocrError: undefined });
    await ctx.scheduler.runAfter(0, internal.devis.runOcr, { devisId: args.devisId });
    return null;
  },
});

// Encodage base64 sans Buffer : le runtime Convex par défaut n'expose que btoa.
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Action OCR (OpenRouter Vision) — câblée, non testée offline. Toujours résolue
// (les erreurs sont capturées → markOcrFailed) pour ne jamais casser le scheduler.
export const runOcr = internalAction({
  args: { devisId: v.id("devis") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.devis.setOcrProcessing, { devisId: args.devisId });
    try {
      const row = await ctx.runQuery(internal.devis.getRowForOcr, { devisId: args.devisId });
      if (!row || !row.storageId) throw new Error("PDF introuvable");
      const blob = await ctx.storage.get(row.storageId);
      if (!blob) throw new Error("PDF introuvable en storage");
      const extracted = await extractFromPdf(toBase64(new Uint8Array(await blob.arrayBuffer())), row.filename);
      await ctx.runMutation(internal.devis.applyExtraction, { devisId: args.devisId, extracted });
    } catch (err) {
      await ctx.runMutation(internal.devis.markOcrFailed, {
        devisId: args.devisId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
