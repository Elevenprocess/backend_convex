#!/usr/bin/env node
/**
 * Catch-up sync Render (Postgres) → Convex.
 *
 * Postgres reste la base LIVE (le backend NestJS reçoit encore les webhooks GHL),
 * donc Convex — figé au jour de la migration — diverge en continu. Ce script
 * rejoue un upsert IDEMPOTENT (dédup par externalId = id Postgres) pour rattraper
 * le delta, et backfill les dates métier manquantes (debriefs.createdAt notamment,
 * ajouté après la 1re passe). Sûr à relancer autant de fois que nécessaire.
 *
 * Prérequis :
 *   - DATABASE_URL         = chaîne de connexion externe Postgres Render
 *   - CONVEX_DEPLOY_KEY    = deploy key du déploiement Convex cible
 *   - schéma Convex À JOUR déployé (debriefs.createdAt doit exister)
 *
 * Usage :  DATABASE_URL=... CONVEX_DEPLOY_KEY=... node scripts/catchupSync.mjs
 */
import pg from "pg";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const CONVEX_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_URL = process.env.DATABASE_URL;
const DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;
if (!DATABASE_URL || !DEPLOY_KEY) {
  console.error("DATABASE_URL et CONVEX_DEPLOY_KEY requis dans l'environnement.");
  process.exit(1);
}

const UPSERT_BATCH = 100;
const BACKFILL_BATCH = 400;

function convexRun(fn, args) {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    cwd: CONVEX_DIR,
    env: { ...process.env, CONVEX_DEPLOY_KEY: DEPLOY_KEY },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });
  return out.trim() ? JSON.parse(out) : null;
}

// ─── Convertisseurs (pg renvoie numeric/bigint en string, ts/date en Date) ──────
const ms = (v) => (v == null ? undefined : new Date(v).getTime());
const num = (v) => (v == null ? undefined : Number(v));
const str = (v) => (v == null ? undefined : v);
const bool = (v) => (v == null ? undefined : Boolean(v));
const json = (v) => (v == null ? undefined : v);

/**
 * Spec par table : [convexField, pgColumn, convert]. `id` PG → `externalId` Convex
 * (clé de dédup). Les colonnes PG `external_id` (id GHL) ne sont PAS reprises : la
 * convention établie est externalId = id Postgres (résolution des FK).
 * fkFields : résolution UUID PG → Id Convex via l'index by_externalId.
 */
const TABLES = {
  leads: {
    pg: "leads",
    fields: [
      ["externalId", "id", str],
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
      ["externalId", "id", str], ["leadId", "lead_id", str], ["commercialId", "commercial_id", str],
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
      ["ringoverPayload", "ringover_payload", json],
      ["nextCallbackAt", "next_callback_at", ms], ["notes", "notes", str],
    ],
    fk: [
      { field: "leadId", refTable: "leads", required: false },
      { field: "setterId", refTable: "users", required: false },
    ],
  },
};

// Ordre = dépendances FK (users/referrers supposés déjà migrés et stables).
// SYNC_TABLES (liste csv) restreint les tables ; SKIP_BACKFILL saute le backfill
// debriefs.createdAt (utile pour rejouer avant/après le déploiement du schéma).
const ALL = ["leads", "rdv", "debriefs", "callLogs"];
const ORDER = process.env.SYNC_TABLES ? process.env.SYNC_TABLES.split(",").map((s) => s.trim()) : ALL;
const SKIP_BACKFILL = process.env.SKIP_BACKFILL === "1";

function mapRow(spec, row) {
  const doc = {};
  for (const [cf, pc, conv] of spec.fields) {
    const val = conv(row[pc]);
    if (val !== undefined) doc[cf] = val;
  }
  return doc;
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const name of ORDER) {
      const spec = TABLES[name];
      const { rows } = await client.query(`SELECT * FROM ${spec.pg}`);
      const docs = rows.map((r) => mapRow(spec, r));
      let inserted = 0, skippedExisting = 0, unresolved = 0;
      for (let i = 0; i < docs.length; i += UPSERT_BATCH) {
        const batch = docs.slice(i, i + UPSERT_BATCH);
        const res = convexRun("migration:upsertMigration", { table: name, fkFields: spec.fk, rows: batch });
        inserted += res.inserted; skippedExisting += res.skippedExisting;
        unresolved += res.skippedUnresolved.length;
      }
      console.log(`${name}: PG=${rows.length} → +${inserted} nouveaux, ${skippedExisting} déjà présents, ${unresolved} FK non résolue`);
    }

    if (SKIP_BACKFILL) { console.log("(backfill debriefs.createdAt sauté : SKIP_BACKFILL=1)"); return; }
    // Backfill debriefs.createdAt sur TOUTES les lignes (les débriefs déjà migrés
    // avant l'ajout du champ n'ont pas de createdAt → dates de débrief fausses).
    const { rows: dbg } = await client.query("SELECT id, created_at FROM debriefs WHERE created_at IS NOT NULL");
    const pairs = dbg.map((r) => ({ externalId: r.id, value: new Date(r.created_at).getTime() }));
    let patched = 0, notFound = 0;
    for (let i = 0; i < pairs.length; i += BACKFILL_BATCH) {
      const res = convexRun("migration:backfillCreatedAt", { table: "debriefs", field: "createdAt", pairs: pairs.slice(i, i + BACKFILL_BATCH) });
      patched += res.patched; notFound += res.notFound;
    }
    console.log(`debriefs.createdAt: ${patched} patchés, ${notFound} introuvables`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
