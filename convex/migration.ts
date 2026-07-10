import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, TableNames } from "./_generated/dataModel";
import { LEAD_STATUSES } from "./model/enums";

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

/**
 * Nettoyage des doublons créés par les webhooks GHL avant le fix de dédup
 * bi-famille : un contact.created sur un client MIGRÉ (id GHL dans
 * ghlContactId, externalId = uuid Postgres) recréait un lead « nouveau ».
 * Repère les leads ghl récents dont l'externalId (id GHL) correspond au
 * ghlContactId d'un autre lead, et les soft-delete si apply=true.
 */
export const dedupeGhlWebhookLeads = internalMutation({
  args: { sinceMs: v.number(), apply: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("leads")
      .withIndex("by_createdAt", (ix) => ix.gte("createdAt", args.sinceMs))
      .collect();
    const dupes: Array<Record<string, unknown>> = [];
    for (const l of recent) {
      if (l.source !== "ghl" || l.externalId === undefined || l.deletedAt !== undefined) continue;
      const original = await ctx.db
        .query("leads")
        .withIndex("by_ghlContactId", (q) => q.eq("ghlContactId", l.externalId!))
        .first();
      if (!original || original._id === l._id || original.deletedAt !== undefined) continue;
      dupes.push({
        dupeId: l._id,
        name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
        dupeStatus: l.status,
        keptId: original._id,
        keptStatus: original.status,
      });
      if (args.apply) await ctx.db.patch(l._id, { deletedAt: Date.now() });
    }
    return { count: dupes.length, applied: args.apply === true, dupes };
  },
});

/** Leads migrés (externalId présent) encore en statut "nouveau" — support de
 * migrationPg:syncLeadStatuses. */
export const listNouveauMigratedLeads = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("leads")
      .withIndex("by_status_createdAt", (ix) => ix.eq("status", "nouveau"))
      .collect();
    return rows
      .filter((l) => l.externalId !== undefined && l.deletedAt === undefined)
      .map((l) => ({
        _id: l._id,
        externalId: l.externalId,
        name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      }));
  },
});

/** Patch de statuts en lot (resync migration) — statut validé contre l'enum. */
export const patchLeadStatuses = internalMutation({
  args: { pairs: v.array(v.object({ leadId: v.id("leads"), status: v.string() })) },
  handler: async (ctx, args) => {
    let patched = 0;
    for (const p of args.pairs) {
      if (!(LEAD_STATUSES as readonly string[]).includes(p.status)) continue;
      const lead = await ctx.db.get(p.leadId);
      // Garde anti-course : ne patcher que si toujours "nouveau".
      if (!lead || lead.status !== "nouveau") continue;
      await ctx.db.patch(p.leadId, { status: p.status as Doc<"leads">["status"] });
      patched++;
    }
    return { patched };
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

/**
 * Backfill idempotent d'un champ date (createdAt/lastContactAt…) par externalId.
 * Sert à réparer les lignes déjà migrées dont la vraie date Render manque
 * (ex : debriefs.createdAt ajouté après la 1re passe). Ne touche qu'aux lignes
 * trouvées ; renvoie le compte patché / introuvable.
 */
export const backfillCreatedAt = internalMutation({
  args: {
    table: v.string(),
    field: v.optional(v.string()), // défaut "createdAt"
    pairs: v.array(v.object({ externalId: v.string(), value: v.number() })),
  },
  handler: async (ctx, args) => {
    if (!(MAPPABLE_TABLES as readonly string[]).includes(args.table)) {
      throw new Error(`Table non mappable : ${args.table}`);
    }
    const field = args.field ?? "createdAt";
    let patched = 0;
    const notFound: string[] = [];
    for (const { externalId, value } of args.pairs) {
      const row = await (ctx.db.query(args.table as TableNames) as any)
        .withIndex("by_externalId", (q: any) => q.eq("externalId", externalId))
        .unique();
      if (!row) {
        notFound.push(externalId);
        continue;
      }
      await ctx.db.patch(row._id, { [field]: value } as never);
      patched += 1;
    }
    return { table: args.table, field, patched, notFound: notFound.length };
  },
});

/**
 * Backfill générique d'un champ STRING par externalId (miroir de
 * backfillCreatedAt qui ne prend que des numbers). Utilisé pour rapatrier les
 * ids GHL (leads.ghlContactId / rdv.ghlEventId) depuis PG external_id.
 */
export const backfillStringField = internalMutation({
  args: {
    table: v.string(),
    field: v.string(),
    pairs: v.array(v.object({ externalId: v.string(), value: v.string() })),
  },
  handler: async (ctx, args) => {
    if (!(MAPPABLE_TABLES as readonly string[]).includes(args.table)) {
      throw new Error(`Table non mappable : ${args.table}`);
    }
    let patched = 0;
    const notFound: string[] = [];
    for (const { externalId, value } of args.pairs) {
      const row = await (ctx.db.query(args.table as TableNames) as any)
        .withIndex("by_externalId", (q: any) => q.eq("externalId", externalId))
        .unique();
      if (!row) {
        notFound.push(externalId);
        continue;
      }
      if (row[args.field] === value) continue; // idempotent, pas d'écriture inutile
      await ctx.db.patch(row._id, { [args.field]: value } as never);
      patched += 1;
    }
    return { table: args.table, field: args.field, patched, notFound: notFound.length };
  },
});

/** externalId des lignes SANS storageId (pour cibler le ré-upload des blobs). */
export const missingStorageIds = internalQuery({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query(args.table as TableNames).collect();
    const missing = rows
      .filter((r) => !("storageId" in r) || !(r as { storageId?: string }).storageId)
      .map((r) => ("externalId" in r ? (r as { externalId?: string }).externalId : undefined))
      .filter((x): x is string => x !== undefined);
    return { total: rows.length, withStorage: rows.length - missing.length, missing };
  },
});

/** Patch storageId d'une ligne par externalId (ré-upload de blob). */
export const patchStorageId = internalMutation({
  args: { table: v.string(), externalId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const row = await (ctx.db.query(args.table as TableNames) as any)
      .withIndex("by_externalId", (q: any) => q.eq("externalId", args.externalId))
      .unique();
    if (!row) return { patched: false };
    await ctx.db.patch(row._id, { storageId: args.storageId } as never);
    return { patched: true };
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

/** Nombre de documents sans createdAt (afficheraient _creationTime = date d'import). */
export const countMissingCreatedAt = internalQuery({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    if (!(MAPPABLE_TABLES as readonly string[]).includes(args.table)) {
      throw new Error(`Table non mappable : ${args.table}`);
    }
    const rows = await ctx.db.query(args.table as TableNames).collect();
    const missing = rows.filter((r) => (r as { createdAt?: number }).createdAt === undefined);
    return {
      missing: missing.length,
      // Un doc migré (externalId présent) sans createdAt est un vrai problème ;
      // un doc natif Convex sans createdAt affiche _creationTime, qui est correct.
      migratedMissing: missing.filter((r) => (r as { externalId?: string }).externalId !== undefined).length,
    };
  },
});

/** Échantillon d'une table (vérification manuelle : dates, refs). */
export const sample = internalQuery({
  args: { table: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query(args.table as TableNames).take(args.limit ?? 3);
  },
});

// ─── Complétion idempotente (gap-fill PG → Convex) ──────────────────────────

/** Tous les externalId déjà présents dans une table (pour calculer les manquants). */
export const existingExternalIds = internalQuery({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query(args.table as TableNames).collect();
    return rows
      .map((r) => ("externalId" in r ? (r as { externalId?: string }).externalId : undefined))
      .filter((x): x is string => x !== undefined);
  },
});

/**
 * Upsert par externalId : insère chaque row seulement si son externalId est absent
 * (dédup). Les FK arrivent en UUID Postgres et sont résolues en Id Convex via
 * l'index by_externalId de la table référencée. Une FK `required` non résolue
 * fait sauter la ligne (signalée) ; une FK optionnelle non résolue est retirée.
 */
export const upsertMigration = internalMutation({
  args: {
    table: v.string(),
    fkFields: v.array(v.object({ field: v.string(), refTable: v.string(), required: v.boolean() })),
    rows: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skippedExisting = 0;
    const skippedUnresolved: string[] = [];
    // Noms de table dynamiques : Convex ne peut pas typer withIndex/insert ici.
    const byExternalId = (table: string, ext: string) =>
      (ctx.db.query(table as TableNames) as any)
        .withIndex("by_externalId", (q: any) => q.eq("externalId", ext))
        .unique();
    for (const row of args.rows as Array<Record<string, unknown>>) {
      const externalId = row.externalId as string;
      if (await byExternalId(args.table, externalId)) {
        skippedExisting += 1;
        continue;
      }
      const doc: Record<string, unknown> = { ...row };
      let ok = true;
      for (const { field, refTable, required } of args.fkFields) {
        const ext = row[field];
        if (ext === undefined || ext === null) {
          delete doc[field];
          if (required) ok = false; // FK requise absente en source → ligne non importable
          continue;
        }
        const ref = await byExternalId(refTable, ext as string);
        if (ref) {
          doc[field] = ref._id;
        } else {
          delete doc[field];
          if (required) ok = false;
        }
      }
      if (!ok) {
        skippedUnresolved.push(externalId);
        continue;
      }
      await ctx.db.insert(args.table as TableNames, doc as never);
      inserted += 1;
    }
    return { table: args.table, inserted, skippedExisting, skippedUnresolved };
  },
});

/**
 * Jonction vtTechniciens (pas d'externalId) : dédup par paire (clientId, userId)
 * après résolution des UUID Postgres. Idempotent.
 */
export const upsertVtTech = internalMutation({
  args: {
    rows: v.array(v.object({ clientExternalId: v.string(), userExternalId: v.string() })),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    const unresolved: string[] = [];
    for (const { clientExternalId, userExternalId } of args.rows) {
      const client = await ctx.db
        .query("clients")
        .withIndex("by_externalId", (q) => q.eq("externalId", clientExternalId))
        .unique();
      const user = await ctx.db
        .query("users")
        .withIndex("by_externalId", (q) => q.eq("externalId", userExternalId))
        .unique();
      if (!client || !user) {
        unresolved.push(`${clientExternalId}/${userExternalId}`);
        continue;
      }
      const dup = await ctx.db
        .query("vtTechniciens")
        .withIndex("by_client", (q) => q.eq("clientId", client._id))
        .filter((f) => f.eq(f.field("userId"), user._id))
        .first();
      if (dup) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("vtTechniciens", { clientId: client._id, userId: user._id });
      inserted += 1;
    }
    return { inserted, skipped, unresolved };
  },
});
