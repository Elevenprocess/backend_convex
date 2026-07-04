import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { TableNames } from "./_generated/dataModel";

// ─── Outillage de migration NestJS/Postgres → Convex ────────────────────────
// Fonctions INTERNES uniquement (lancées via `npx convex run` avec la deploy
// key). Aucune n'est exposée aux clients.

/** Tables migrées porteuses d'un externalId (id Postgres) → mapping _id. */
const MAPPABLE_TABLES = [
  "users", "referrers", "leads", "rdv", "projects", "debriefs", "devis",
  "clients", "workflowSteps", "workflowSubsteps", "documents",
  "projectAttachments",
] as const;

/** Renvoie les paires [externalId, _id] d'une table pour résoudre les FK. */
export const idMap = internalQuery({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    if (!(MAPPABLE_TABLES as readonly string[]).includes(args.table)) {
      throw new Error(`Table non mappable : ${args.table}`);
    }
    const rows = await ctx.db.query(args.table as TableNames).collect();
    return rows
      .filter((r) => "externalId" in r && r.externalId)
      .map((r) => [(r as { externalId: string }).externalId, r._id] as const);
  },
});

/** Génère `count` URLs d'upload storage (une par fichier à migrer). */
export const uploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, args) => {
    const n = Math.min(Math.max(1, Math.floor(args.count)), 50);
    const urls: string[] = [];
    for (let i = 0; i < n; i++) urls.push(await ctx.storage.generateUploadUrl());
    return urls;
  },
});

/** Seconde passe users : câble createdById (auto-référence impossible à l'import). */
export const patchUserCreatedBy = internalMutation({
  args: { pairs: v.array(v.object({ externalId: v.string(), createdByExternalId: v.string() })) },
  handler: async (ctx, args) => {
    let patched = 0;
    for (const { externalId, createdByExternalId } of args.pairs) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_externalId", (q) => q.eq("externalId", externalId))
        .unique();
      const createdBy = await ctx.db
        .query("users")
        .withIndex("by_externalId", (q) => q.eq("externalId", createdByExternalId))
        .unique();
      if (user && createdBy) {
        await ctx.db.patch(user._id, { createdById: createdBy._id });
        patched++;
      }
    }
    return { patched };
  },
});

/** Comptage paginé (vérification post-import, robuste aux grosses tables). */
export const countRows = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query(args.table as TableNames)
      .paginate({ numItems: 500, cursor: args.cursor });
    return { count: page.page.length, cursor: page.isDone ? null : page.continueCursor };
  },
});

/** Échantillon d'une table (vérification manuelle : dates, refs). */
export const sample = internalQuery({
  args: { table: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query(args.table as TableNames).take(args.limit ?? 3);
  },
});
