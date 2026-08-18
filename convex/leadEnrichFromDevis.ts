/**
 * Enrichissement des leads depuis les devis Solteo.
 *
 * Deux sources :
 *  1. Lignes `devis` déjà OCRisées (extracted.customer) → remplissage direct.
 *  2. Pièces `documents` de type devis_signe importées depuis le Drive
 *     (jamais OCRisées) → OCR (même pipeline que devis.runOcr) puis remplissage.
 *
 * Règle : on ne remplit QUE les champs vides du lead (email, téléphone,
 * adresse, code postal, ville). Aucun écrasement d'une donnée existante.
 *
 * Usage :
 *   npx convex run leadEnrichFromDevis:audit '{}'
 *   npx convex run leadEnrichFromDevis:backfillFromDevisRows '{"dryRun":true}'
 *   npx convex run leadEnrichFromDevis:enrichFromDocuments '{"limit":10,"dryRun":true}'
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { customerPatch, dropUndefined } from "./model/devisExtraction";
import { extractFromPdf } from "./model/ocr";

const FIELDS = ["email", "phone", "addressLine", "postalCode", "city"] as const;
type Field = (typeof FIELDS)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function missingFields(lead: Record<string, unknown>): Field[] {
  return FIELDS.filter((f) => {
    const val = lead[f];
    return typeof val !== "string" || val.trim() === "";
  });
}

/** Ne garde que les champs du customer qui comblent un vide du lead. */
function fillPatch(lead: Record<string, unknown>, customer: ReturnType<typeof customerPatch>) {
  const missing = missingFields(lead);
  const patch: Partial<Record<Field, string>> = {};
  for (const f of missing) {
    const val = customer[f];
    if (!val) continue;
    if (f === "email" && !EMAIL_RE.test(val)) continue;
    patch[f] = val;
  }
  return patch;
}

/** État des lieux : combien de leads « à devis » ont des coordonnées manquantes. */
export const audit = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = (await ctx.db.query("documents").collect())
      .filter((d) => d.deletedAt === undefined && d.type === "devis_signe" && d.storageId);
    const seenLead = new Set<string>();
    let docsLeadsMissing = 0;
    const missingCount: Record<Field, number> = { email: 0, phone: 0, addressLine: 0, postalCode: 0, city: 0 };
    for (const d of docs) {
      const client = await ctx.db.get(d.clientId);
      if (!client || seenLead.has(client.leadId)) continue;
      seenLead.add(client.leadId);
      const lead = await ctx.db.get(client.leadId);
      if (!lead) continue;
      const m = missingFields(lead as Record<string, unknown>);
      if (m.length) docsLeadsMissing++;
      for (const f of m) missingCount[f]++;
    }

    const rows = (await ctx.db.query("devis").collect()).filter((r) => r.extracted && (r.extracted as { customer?: unknown }).customer);
    let rowsFillable = 0;
    for (const r of rows) {
      const lead = await ctx.db.get(r.leadId);
      if (!lead) continue;
      const patch = fillPatch(lead as Record<string, unknown>, customerPatch((r.extracted as { customer?: never }).customer));
      if (Object.keys(patch).length) rowsFillable++;
    }
    return {
      importedDevisDocs: docs.length,
      leadsWithImportedDevis: seenLead.size,
      leadsWithMissingFields: docsLeadsMissing,
      missingByField: missingCount,
      devisRowsWithCustomer: rows.length,
      devisRowsFillable: rowsFillable,
    };
  },
});

/** Source 1 : lignes devis déjà OCRisées → comble les vides du lead. */
export const backfillFromDevisRows = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const rows = (await ctx.db.query("devis").collect())
      .filter((r) => r.extracted && (r.extracted as { customer?: unknown }).customer)
      .sort((a, b) => b._creationTime - a._creationTime); // plus récent d'abord
    const out: { leadId: string; name: string; patch: Record<string, string> }[] = [];
    const done = new Set<string>();
    for (const r of rows) {
      const lead = await ctx.db.get(r.leadId);
      if (!lead) continue;
      const patch = fillPatch(lead as Record<string, unknown>, customerPatch((r.extracted as { customer?: never }).customer));
      if (!Object.keys(patch).length) continue;
      if (!args.dryRun) await ctx.db.patch(lead._id, patch);
      done.add(lead._id);
      out.push({ leadId: lead._id, name: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim(), patch });
    }
    return { dryRun: !!args.dryRun, leadsUpdated: out.length, details: out };
  },
});

/** Pièces devis importées dont le lead a encore des vides (candidats OCR). */
export const listCandidateDocuments = internalQuery({
  args: { limit: v.number(), skipLeadIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const skip = new Set(args.skipLeadIds ?? []);
    const docs = (await ctx.db.query("documents").collect())
      .filter((d) => d.deletedAt === undefined && d.type === "devis_signe" && d.storageId);
    const out: { documentId: string; storageId: string; filename: string; leadId: string; leadName: string; missing: Field[] }[] = [];
    const seenLead = new Set<string>();
    for (const d of docs) {
      if (out.length >= args.limit) break;
      const client = await ctx.db.get(d.clientId);
      if (!client || seenLead.has(client.leadId) || skip.has(client.leadId)) continue;
      const lead = await ctx.db.get(client.leadId);
      if (!lead) continue;
      const missing = missingFields(lead as Record<string, unknown>);
      if (!missing.length) continue;
      seenLead.add(client.leadId);
      out.push({
        documentId: d._id, storageId: d.storageId!, filename: d.filename, leadId: client.leadId,
        leadName: `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim(), missing,
      });
    }
    return out;
  },
});

export const applyCustomerToLead = internalMutation({
  args: { leadId: v.id("leads"), customer: v.any(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return { patch: {}, reason: "lead introuvable" };
    const patch = fillPatch(lead as Record<string, unknown>, customerPatch(args.customer));
    if (Object.keys(patch).length && !args.dryRun) await ctx.db.patch(lead._id, patch);
    return { patch };
  },
});

/**
 * Source 2 : OCR des devis importés (Drive) → comble les vides du lead.
 * Séquentiel, `limit` docs par appel (≈ 5-10 s/doc) ; relancer jusqu'à épuisement.
 * `skipLeadIds` : leads déjà traités sans succès (OCR sans email, etc.) à ignorer.
 */
export const enrichFromDocuments = internalAction({
  args: { limit: v.optional(v.number()), dryRun: v.optional(v.boolean()), skipLeadIds: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const candidates = await ctx.runQuery(internal.leadEnrichFromDevis.listCandidateDocuments, {
      limit, skipLeadIds: args.skipLeadIds,
    });
    const results: { leadId: string; leadName: string; filename: string; missing: Field[]; customer?: unknown; patch?: Record<string, string>; error?: string }[] = [];
    for (const c of candidates) {
      try {
        const blob = await ctx.storage.get(c.storageId as never);
        if (!blob) throw new Error("PDF introuvable en storage");
        const extracted = await extractFromPdf(toBase64(new Uint8Array(await blob.arrayBuffer())), c.filename);
        const customer = (extracted as { customer?: unknown }).customer;
        const r = await ctx.runMutation(internal.leadEnrichFromDevis.applyCustomerToLead, {
          leadId: c.leadId as never, customer: customer ?? {}, dryRun: args.dryRun,
        });
        results.push({ leadId: c.leadId, leadName: c.leadName, filename: c.filename, missing: c.missing, customer, patch: r.patch });
      } catch (err) {
        results.push({ leadId: c.leadId, leadName: c.leadName, filename: c.filename, missing: c.missing, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { dryRun: !!args.dryRun, processed: results.length, results };
  },
});

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
