"use node";
/**
 * Catch-up sync Render (Postgres) → Convex, exécuté CÔTÉ CONVEX.
 *
 * Même logique que scripts/catchupSync.mjs (upsert idempotent par externalId +
 * backfill debriefs.createdAt), mais portée en action Node : certains réseaux
 * bloquent le port 5432 sortant, alors que le cloud Convex joint Render sans
 * problème. DATABASE_URL doit être défini dans l'environnement du déploiement
 * (`npx convex env set DATABASE_URL ...`).
 *
 * Usage :
 *   npx convex run migrationPg:catchup '{"tables":["leads"]}'
 *   npx convex run migrationPg:catchup '{}'            # toutes les tables + backfill
 *   npx convex run migrationPg:pgCounts '{}'           # comptages PG (diagnostic)
 */
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import pg from "pg";

const UPSERT_BATCH = 100;
const BACKFILL_BATCH = 400;

// ─── Convertisseurs (pg renvoie numeric/bigint en string, ts/date en Date) ──────
const ms = (v: unknown) => (v == null ? undefined : new Date(v as string).getTime());
const num = (v: unknown) => (v == null ? undefined : Number(v));
const str = (v: unknown) => (v == null ? undefined : v);

type Conv = (v: unknown) => unknown;
type Spec = {
  pg: string;
  fields: Array<[string, string, Conv]>;
  fk: Array<{ field: string; refTable: string; required: boolean }>;
};

/** Copie conforme de la spec de scripts/catchupSync.mjs — voir ce fichier. */
const TABLES: Record<string, Spec> = {
  leads: {
    pg: "leads",
    fields: [
      ["externalId", "id", str],
      // Id contact GHL (leads.external_id PG) : requis pour les webhooks GHL
      // (contact_id) et le push du champ lien_debrief.
      ["ghlContactId", "external_id", str],
      ["source", "source", str], ["status", "status", str],
      ["firstName", "first_name", str], ["lastName", "last_name", str],
      ["email", "email", str], ["phone", "phone", str],
      ["addressLine", "address_line", str], ["city", "city", str],
      ["postalCode", "postal_code", str], ["localisationMap", "localisation_map", str],
      ["revenuFiscal", "revenu_fiscal", num], ["typeLogement", "type_logement", str],
      ["utmSource", "utm_source", str], ["utmMedium", "utm_medium", str],
      ["utmCampaign", "utm_campaign", str], ["campaign", "campaign", str],
      ["adset", "adset", str], ["ad", "ad", str],
      ["canalAcquisition", "canal_acquisition", str],
      ["setterId", "setter_id", str], ["assignedToId", "assigned_to_id", str],
      ["referrerId", "referrer_id", str],
      ["lastContactAt", "last_contact_at", ms], ["datePassageRelance", "date_passage_relance", ms],
      ["monetaryValue", "monetary_value", num],
      ["ghlStageName", "ghl_stage_name", str], ["ghlPipelineId", "ghl_pipeline_id", str],
      ["lostReason", "lost_reason", str], ["acquisitionChannel", "acquisition_channel", str],
      ["campaignId", "campaign_id", str], ["adsetId", "adset_id", str], ["adId", "ad_id", str],
      ["attributionMedium", "attribution_medium", str],
      ["attributionSessionSource", "attribution_session_source", str],
      ["deletedAt", "deleted_at", ms], ["createdAt", "created_at", ms],
    ],
    fk: [
      { field: "setterId", refTable: "users", required: false },
      { field: "assignedToId", refTable: "users", required: false },
      { field: "referrerId", refTable: "referrers", required: false },
    ],
  },
  rdv: {
    pg: "rdv",
    fields: [
      ["externalId", "id", str],
      // Id du rendez-vous GHL (rdv.external_id PG) : résolution des webhooks
      // GHL (appointment_id).
      ["ghlEventId", "external_id", str],
      ["leadId", "lead_id", str], ["commercialId", "commercial_id", str],
      ["scheduledAt", "scheduled_at", ms], ["locationType", "location_type", str],
      ["status", "status", str], ["result", "result", str],
      ["signatureAt", "signature_at", ms], ["montantTotal", "montant_total", num],
      ["financingType", "financing_type", str], ["objections", "objections", str],
      ["nonSaleReason", "non_sale_reason", str], ["kits", "kits", str], ["notes", "notes", str],
      ["debriefFilledAt", "debrief_filled_at", ms], ["debriefDueAt", "debrief_due_at", ms],
      ["deletedAt", "deleted_at", ms], ["createdAt", "created_at", ms],
    ],
    fk: [
      { field: "leadId", refTable: "leads", required: true },
      { field: "commercialId", refTable: "users", required: false },
    ],
  },
  debriefs: {
    pg: "debriefs",
    fields: [
      ["externalId", "id", str], ["projectId", "project_id", str], ["leadId", "lead_id", str],
      ["rdvId", "rdv_id", str], ["commercialId", "commercial_id", str],
      ["outcome", "outcome", str], ["nonSaleReason", "non_sale_reason", str],
      ["reflexionReason", "reflexion_reason", str], ["suiviReason", "suivi_reason", str],
      ["objection", "objection", str],
      ["acceptanceFactors", "acceptance_factors", (v) => (Array.isArray(v) ? v : [])],
      ["notes", "notes", str], ["montantTotal", "montant_total", num],
      ["financingType", "financing_type", str], ["kits", "kits", str],
      ["signedAt", "signed_at", ms], ["paymentSubMethod", "payment_sub_method", str],
      ["financingOrg", "financing_org", str], ["acomptePercent", "acompte_percent", num],
      ["acompteAmount", "acompte_amount", num],
      ["customEcheancier", "custom_echeancier", (v) => Boolean(v)],
      ["deletedAt", "deleted_at", ms], ["createdAt", "created_at", ms],
    ],
    fk: [
      { field: "projectId", refTable: "projects", required: false },
      { field: "leadId", refTable: "leads", required: false },
      { field: "rdvId", refTable: "rdv", required: false },
      { field: "commercialId", refTable: "users", required: true },
    ],
  },
  callLogs: {
    pg: "call_logs",
    fields: [
      ["externalId", "id", str], ["leadId", "lead_id", str], ["setterId", "setter_id", str],
      ["calledAt", "called_at", ms], ["result", "result", str],
      ["durationSec", "duration_sec", num], ["ringoverCallId", "ringover_call_id", str],
      ["ringoverChannelId", "ringover_channel_id", str], ["ringoverStatus", "ringover_status", str],
      // ringover_payload volontairement NON repris : jamais lu par l'app et il
      // gonflait chaque lecture analytics (la source reste dans Postgres).
      ["nextCallbackAt", "next_callback_at", ms], ["notes", "notes", str],
    ],
    fk: [
      { field: "leadId", refTable: "leads", required: false },
      { field: "setterId", refTable: "users", required: false },
    ],
  },
};

const ORDER = ["leads", "rdv", "debriefs", "callLogs"];

function mapRow(spec: Spec, row: Record<string, unknown>) {
  const doc: Record<string, unknown> = {};
  for (const [cf, pc, conv] of spec.fields) {
    const val = conv(row[pc]);
    if (val !== undefined) doc[cf] = val;
  }
  return doc;
}

async function withPg<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absent de l'env du déploiement (npx convex env set DATABASE_URL ...)");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const catchup = internalAction({
  args: {
    tables: v.optional(v.array(v.string())),
    skipBackfill: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const order = args.tables ?? ORDER;
    const summary: Record<string, unknown> = {};
    await withPg(async (client) => {
      for (const name of order) {
        const spec = TABLES[name];
        if (!spec) throw new Error(`Table inconnue : ${name}`);
        const { rows } = await client.query(`SELECT * FROM ${spec.pg}`);
        const docs = rows.map((r) => mapRow(spec, r));
        let inserted = 0, skippedExisting = 0;
        const unresolved: string[] = [];
        for (let i = 0; i < docs.length; i += UPSERT_BATCH) {
          const res: any = await ctx.runMutation(internal.migration.upsertMigration, {
            table: name,
            fkFields: spec.fk,
            rows: docs.slice(i, i + UPSERT_BATCH),
          });
          inserted += res.inserted;
          skippedExisting += res.skippedExisting;
          unresolved.push(...res.skippedUnresolved);
        }
        summary[name] = { pg: rows.length, inserted, skippedExisting, unresolved };
      }

      if (!args.skipBackfill && order.includes("debriefs")) {
        const { rows: dbg } = await client.query(
          "SELECT id, created_at FROM debriefs WHERE created_at IS NOT NULL"
        );
        const pairs = dbg.map((r: { id: string; created_at: string | Date }) => ({
          externalId: r.id,
          value: new Date(r.created_at).getTime(),
        }));
        let patched = 0, notFound = 0;
        for (let i = 0; i < pairs.length; i += BACKFILL_BATCH) {
          const res: any = await ctx.runMutation(internal.migration.backfillCreatedAt, {
            table: "debriefs",
            field: "createdAt",
            pairs: pairs.slice(i, i + BACKFILL_BATCH),
          });
          patched += res.patched;
          notFound += res.notFound;
        }
        summary.backfillDebriefsCreatedAt = { patched, notFound };
      }
    });
    return summary;
  },
});

/**
 * Backfill des ids GHL sur les lignes déjà migrées (upsertMigration skippe
 * l'existant, donc les nouveaux champs ghlContactId/ghlEventId n'arrivent que
 * sur les insertions futures — cette action patche le stock).
 *   npx convex run migrationPg:backfillGhlIds '{}'
 */
export const backfillGhlIds = internalAction({
  args: {},
  handler: async (ctx) => {
    const JOBS = [
      { table: "leads", field: "ghlContactId", pg: "leads" },
      { table: "rdv", field: "ghlEventId", pg: "rdv" },
    ] as const;
    const summary: Record<string, unknown> = {};
    await withPg(async (client) => {
      for (const job of JOBS) {
        const { rows } = await client.query(
          `SELECT id::text, external_id FROM ${job.pg} WHERE external_id IS NOT NULL`
        );
        const pairs = rows.map((r: { id: string; external_id: string }) => ({
          externalId: r.id,
          value: r.external_id,
        }));
        let patched = 0, notFound = 0;
        for (let i = 0; i < pairs.length; i += BACKFILL_BATCH) {
          const res: any = await ctx.runMutation(internal.migration.backfillStringField, {
            table: job.table,
            field: job.field,
            pairs: pairs.slice(i, i + BACKFILL_BATCH),
          });
          patched += res.patched;
          notFound += res.notFound;
        }
        summary[`${job.table}.${job.field}`] = { pg: pairs.length, patched, notFound };
      }
    });
    return summary;
  },
});

/** SELECT de diagnostic (interne : requiert la clé admin du déploiement). */
export const pgSelect = internalAction({
  args: { sql: v.string() },
  handler: async (_ctx, args) => {
    if (!/^\s*select\b/i.test(args.sql)) throw new Error("SELECT uniquement");
    return withPg(async (client) => {
      const { rows } = await client.query(args.sql);
      return rows;
    });
  },
});

/** Comptages PG de toutes les tables publiques (diagnostic de delta). */
export const pgCounts = internalAction({
  args: {},
  handler: async () => {
    return withPg(async (client) => {
      const { rows: tables } = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
      );
      const counts: Record<string, number> = {};
      for (const { table_name } of tables) {
        const { rows } = await client.query(`SELECT count(*)::int AS c FROM "${table_name}"`);
        counts[table_name] = rows[0].c;
      }
      return counts;
    });
  },
});
