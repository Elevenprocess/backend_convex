import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { projectStatusValidator } from "./model/enums";
import { requireRole, requireUser, assertCommercialRole, roleOf } from "./model/access";
import { toResponse as devisToResponse } from "./devis";
import { READ_ROLES as ATTACHMENT_READ_ROLES, toSummary as attachmentToSummary } from "./projectAttachments";

const COMMERCIAL = ["admin", "commercial", "commercial_lead"] as const;

function leadFullName(lead: { firstName?: string; lastName?: string } | null): string {
  return [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim();
}

export const create = mutation({
  args: {
    leadId: v.id("leads"),
    name: v.optional(v.string()),
    commercialId: v.optional(v.id("users")),
    addressLine: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
    notes: v.optional(v.string()),
    externalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...COMMERCIAL]);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) throw new Error(`Lead ${args.leadId} introuvable`);
    if (args.commercialId) await assertCommercialRole(ctx, args.commercialId);

    const name = (args.name ?? `Projet ${leadFullName(lead)}`).trim() || "Dossier sans nom";
    return await ctx.db.insert("projects", {
      leadId: args.leadId,
      commercialId: args.commercialId ?? user._id,
      name,
      addressLine: args.addressLine ?? lead.addressLine,
      postalCode: args.postalCode ?? lead.postalCode,
      city: args.city ?? lead.city,
      status: "qualification",
      notes: args.notes,
      externalId: args.externalId,
    });
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await ctx.db.get(args.projectId);
    if (!row || row.deletedAt !== undefined) return null;
    return row;
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    return rows
      .filter((p) => p.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
    status: v.optional(projectStatusValidator),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const existing = await ctx.db.get(args.projectId);
    if (!existing || existing.deletedAt !== undefined) throw new Error("Projet introuvable");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.addressLine !== undefined) patch.addressLine = args.addressLine;
    if (args.postalCode !== undefined) patch.postalCode = args.postalCode;
    if (args.city !== undefined) patch.city = args.city;
    if (args.status !== undefined) patch.status = args.status;
    if (args.notes !== undefined) patch.notes = args.notes;
    await ctx.db.patch(args.projectId, patch);
    return null;
  },
});

/**
 * Fiche client : tous les projets actifs du lead avec leurs débriefs, devis et
 * pièces en UNE query. La page fiche payait une cascade de 3 vagues d'appels
 * (liste, puis 2 vagues de détail par projet), coûteuse loin du datacenter.
 * Shapes identiques aux queries unitaires (projects:get, debriefs:listByProject,
 * devis:listByLead, projectAttachments:listByProject).
 */
export const ficheByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // Parité avec projectAttachments:listByProject (rôles lecture) : un rôle
    // hors liste voit les projets sans leurs pièces plutôt qu'une erreur.
    const canReadAttachments = ATTACHMENT_READ_ROLES.includes(roleOf(user));

    const projects = (
      await ctx.db
        .query("projects")
        .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
        .collect()
    )
      .filter((p) => p.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);

    const devisRows = (
      await ctx.db
        .query("devis")
        .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
        .collect()
    )
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);

    return await Promise.all(
      projects.map(async (project) => {
        const debriefs = (
          await ctx.db
            .query("debriefs")
            .withIndex("by_project", (q) => q.eq("projectId", project._id))
            .collect()
        )
          .filter((d) => d.deletedAt === undefined)
          .sort((a, b) => b._creationTime - a._creationTime);

        const attachments = canReadAttachments
          ? await Promise.all(
              (
                await ctx.db
                  .query("projectAttachments")
                  .withIndex("by_project", (q) => q.eq("projectId", project._id))
                  .collect()
              )
                .filter((a) => a.deletedAt === undefined)
                .map(async (a) => {
                  const url = a.storageId ? ((await ctx.storage.getUrl(a.storageId)) ?? undefined) : undefined;
                  return attachmentToSummary(a, url);
                }),
            )
          : [];

        return {
          project,
          debriefs,
          devis: devisRows.filter((d) => d.projectId === project._id).map((d) => devisToResponse(d)),
          attachments,
        };
      }),
    );
  },
});

export const softDelete = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...COMMERCIAL]);
    const existing = await ctx.db.get(args.projectId);
    if (!existing || existing.deletedAt !== undefined) throw new Error("Projet introuvable");
    await ctx.db.patch(args.projectId, { deletedAt: Date.now() });
    return null;
  },
});
