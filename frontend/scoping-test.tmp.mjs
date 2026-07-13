// Campagne de test scoping par rôle contre le déploiement Convex cloud,
// via le MÊME client que le frontend (convex/browser, package d'ECOI_frontend).
// Usage :
//   node scoping-test.mjs signup            → crée les 4 comptes (flow signUp)
//   node scoping-test.mjs run <seed.json>   → se connecte (flow signIn) + matrice
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";

const URL = "https://spotted-horse-257.eu-west-1.convex.cloud";
const PASSWORD = "VeloraTest2026!";
const EMAILS = {
  admin: "admin@test.velora.re",
  setter: "setter@test.velora.re",
  commercial: "commercial@test.velora.re",
  deliv: "deliv@test.velora.re",
};

async function auth(email, flow) {
  const c = new ConvexHttpClient(URL);
  const res = await c.action(anyApi.auth.signIn, {
    provider: "password",
    params: { email, password: PASSWORD, flow },
  });
  if (!res?.tokens?.token) throw new Error(`Pas de token pour ${email} (${flow})`);
  c.setAuth(res.tokens.token);
  return c;
}

if (process.argv[2] === "signup") {
  for (const [role, email] of Object.entries(EMAILS)) {
    try {
      await auth(email, "signUp");
      console.log(`signUp OK  ${role} <${email}>`);
    } catch (e) {
      console.log(`signUp ERR ${role} <${email}> : ${e.message.split("\n")[0]}`);
    }
  }
  process.exit(0);
}

// ─── Campagne ────────────────────────────────────────────────────────────────
const seed = JSON.parse(readFileSync(process.argv[3], "utf8"));
const NOW = Date.now();
const PAGE = { numItems: 50, cursor: null };
const results = [];

function check(role, name, verdict, detail) {
  results.push({ role, name, verdict, detail });
  console.log(`${verdict === "PASS" ? "✅" : verdict === "LEAK" ? "🔴" : "⚠️ "} [${role}] ${name} — ${detail}`);
}

// Exécute une query et classe le résultat via un prédicat.
async function q(client, role, name, ref, args, expect) {
  try {
    const res = await client.query(ref, args);
    const [ok, detail] = expect(res);
    check(role, name, ok ? "PASS" : "LEAK", detail);
    return res;
  } catch (e) {
    const msg = e.message.split("\n")[0].slice(0, 160);
    const [ok, detail] = expect({ __threw: msg });
    check(role, name, ok ? "PASS" : "FAIL", detail ?? msg);
    return null;
  }
}
const threw = (r) => r && r.__threw !== undefined;
// En prod Convex, les messages de throw non-ConvexError sont expurgés ("Server Error") : tout throw vaut refus.
const refused = (r) => threw(r);

const clients = {};
for (const [role, email] of Object.entries(EMAILS)) {
  clients[role] = await auth(email, "signIn");
  console.log(`signIn OK ${role}`);
}

// ── users.me / users.list ────────────────────────────────────────────────────
for (const role of Object.keys(EMAILS)) {
  await q(clients[role], role, "users.me = soi-même", anyApi.users.me, {}, (r) =>
    threw(r) ? [false, r.__threw] : [r?.email === EMAILS[role], `email=${r?.email}`]);
}
await q(clients.admin, "admin", "users.list autorisé", anyApi.users.list, {}, (r) =>
  threw(r) ? [false, r.__threw] : [Array.isArray(r) && r.length >= 7, `${r.length} users`]);
for (const role of ["setter", "commercial", "deliv"]) {
  await q(clients[role], role, "users.list refusé", anyApi.users.list, {}, (r) =>
    refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé : ${JSON.stringify(r).slice(0, 80)}`]);
}

// ── leads.list (requireUser seul — comportement partagé assumé, on le mesure) ─
for (const role of Object.keys(EMAILS)) {
  await q(clients[role], role, "leads.list (partagé toute équipe)", anyApi.leads.list, { paginationOpts: PAGE }, (r) =>
    threw(r) ? [false, r.__threw] : [r.page.length === 2, `${r.page.length} leads visibles`]);
}

// ── clients.list / getByProject / substeps ──────────────────────────────────
await q(clients.admin, "admin", "clients.list = 2 dossiers", anyApi.clients.list, {}, (r) =>
  threw(r) ? [false, r.__threw] : [r.length === 2, `${r.length} dossiers`]);
await q(clients.deliv, "deliv", "clients.list = 2 dossiers (privilégié)", anyApi.clients.list, {}, (r) =>
  threw(r) ? [false, r.__threw] : [r.length === 2, `${r.length} dossiers`]);
await q(clients.commercial, "commercial", "clients.list = SON dossier seul", anyApi.clients.list, {}, (r) =>
  threw(r) ? [false, r.__threw]
    : [r.length === 1 && r[0]._id === seed.clientA, `${r.length} dossier(s), montant=${r[0]?.montantTotal}`]);
await q(clients.setter, "setter", "clients.list refusé", anyApi.clients.list, {}, (r) =>
  refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé : ${JSON.stringify(r).slice(0, 80)}`]);
await q(clients.commercial, "commercial", "clients.getByProject(B étranger) masqué", anyApi.clients.getByProject, { projectId: seed.projectB }, (r) =>
  threw(r) ? [/introuvable|Accès/.test(r.__threw), r.__threw] : [r === null, `retour=${JSON.stringify(r)?.slice(0, 60)}`]);
await q(clients.commercial, "commercial", "workflowSubsteps.list(clientB) vide", anyApi.workflowSubsteps.list, { clientId: seed.clientB }, (r) =>
  threw(r) ? [false, r.__threw] : [Array.isArray(r) && r.length === 0, `${r?.length} substeps (existence non fuitée)`]);
await q(clients.deliv, "deliv", "workflowSubsteps.list(clientB) complet", anyApi.workflowSubsteps.list, { clientId: seed.clientB }, (r) =>
  threw(r) ? [false, r.__threw] : [r.length === 12, `${r.length} substeps`]);

// ── notifications ────────────────────────────────────────────────────────────
await q(clients.admin, "admin", "notifications.listMine = la sienne seule", anyApi.notifications.listMine, {}, (r) =>
  threw(r) ? [false, r.__threw] : [r.length === 1 && r[0].title === "Notif admin", `${r.length} notif(s) : ${r.map((n) => n.title).join(", ")}`]);
for (const role of ["setter", "commercial", "deliv"]) {
  await q(clients[role], role, "notifications.listMine vide (rien d'autrui)", anyApi.notifications.listMine, {}, (r) =>
    threw(r) ? [false, r.__threw] : [r.length === 0, `${r.length} notif(s)`]);
}

// ── analytics ────────────────────────────────────────────────────────────────
await q(clients.admin, "admin", "summary : vue admin, CA équipe=30000", anyApi.analytics.summary, { now: NOW }, (r) =>
  threw(r) ? [false, r.__threw] : [r.admin !== null && r.setter === null && r.commercial === null && r.admin.ca === 30000, `ca=${r.admin?.ca}`]);
await q(clients.setter, "setter", "summary : vue setter seule (1 appel à lui)", anyApi.analytics.summary, { now: NOW, days: 30 }, (r) =>
  threw(r) ? [false, r.__threw] : [r.setter !== null && r.admin === null && r.commercial === null && r.setter.loggedCalls === 1, `loggedCalls=${r.setter?.loggedCalls}`]);
await q(clients.commercial, "commercial", "summary : vue commerciale, CA=10000 (pas 30000)", anyApi.analytics.summary, { now: NOW }, (r) =>
  threw(r) ? [false, r.__threw] : [r.commercial !== null && r.admin === null && r.commercial.ca === 10000, `ca=${r.commercial?.ca}`]);
await q(clients.deliv, "deliv", "summary refusé", anyApi.analytics.summary, { now: NOW }, (r) =>
  refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé`]);
await q(clients.commercial, "commercial", "commercialStats(id d'autrui) → forcé aux siennes", anyApi.analytics.commercialStats, { commercialId: seed.commercial2, now: NOW }, (r) =>
  threw(r) ? [false, r.__threw] : [r.ca === 10000, `ca=${r.ca} (20000 = fuite commercial2)`]);
await q(clients.setter, "setter", "setterStats(id d'autrui) → forcé aux siennes", anyApi.analytics.setterStats, { setterId: seed.setter2, now: NOW }, (r) =>
  threw(r) ? [false, r.__threw] : [r.loggedCalls === 1, `loggedCalls=${r.loggedCalls} (2 = fuite setter2)`]);
await q(clients.admin, "admin", "debriefStats total équipe = 2", anyApi.analytics.debriefStats, {}, (r) =>
  threw(r) ? [false, r.__threw] : [r.total === 2, `total=${r.total}`]);
await q(clients.commercial, "commercial", "debriefStats = SES débriefs (1)", anyApi.analytics.debriefStats, { commercialId: seed.commercial2 }, (r) =>
  threw(r) ? [false, r.__threw] : [r.total === 1 && r.acceptanceFactorCounts.confiance === undefined, `total=${r.total} facteurs=${JSON.stringify(r.acceptanceFactorCounts)}`]);
for (const role of ["setter", "deliv"]) {
  await q(clients[role], role, "debriefStats refusé", anyApi.analytics.debriefStats, {}, (r) =>
    refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé`]);
}
await q(clients.admin, "admin", "funnel autorisé", anyApi.analytics.funnel, { now: NOW }, (r) =>
  threw(r) ? [false, r.__threw] : [r.totals !== undefined, `newLeads=${r.totals?.newLeads}`]);
for (const role of ["setter", "commercial", "deliv"]) {
  await q(clients[role], role, "funnel refusé (managers seuls)", anyApi.analytics.funnel, { now: NOW }, (r) =>
    refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé`]);
  await q(clients[role], role, "pipelineDistribution refusé", anyApi.analytics.pipelineDistribution, { now: NOW }, (r) =>
    refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé`]);
}

// ── finances ─────────────────────────────────────────────────────────────────
const TODAY = new Date(NOW).toISOString().slice(0, 10);
await q(clients.admin, "admin", "listAcomptes autorisé (2 dossiers)", anyApi.payments.listAcomptes, { today: TODAY }, (r) =>
  threw(r) ? [false, r.__threw] : [Array.isArray(r) && r.length === 2, `${r.length} échéanciers`]);
await q(clients.deliv, "deliv", "listAcomptes autorisé (rôle finances élargi)", anyApi.payments.listAcomptes, { today: TODAY }, (r) =>
  threw(r) ? [false, r.__threw] : [Array.isArray(r) && r.length === 2, `${r.length} échéanciers`]);
for (const role of ["setter", "commercial"]) {
  await q(clients[role], role, "listAcomptes refusé", anyApi.payments.listAcomptes, { today: TODAY }, (r) =>
    refused(r) ? [true, "Accès refusé"] : [false, `PAS refusé`]);
}

// ── rdv (requireUser seul — on mesure) ───────────────────────────────────────
for (const role of Object.keys(EMAILS)) {
  await q(clients[role], role, "rdv.list (partagé toute équipe)", anyApi.rdv.list, { paginationOpts: PAGE }, (r) =>
    threw(r) ? [false, r.__threw] : [r.page.length === 2, `${r.page.length} rdv visibles`]);
}

// ── non authentifié : tout doit être fermé ───────────────────────────────────
const anon = new ConvexHttpClient(URL);
for (const [name, ref, args] of [
  ["leads.list", anyApi.leads.list, { paginationOpts: PAGE }],
  ["clients.list", anyApi.clients.list, {}],
  ["analytics.summary", anyApi.analytics.summary, { now: NOW }],
  ["payments.listAcomptes", anyApi.payments.listAcomptes, { today: TODAY }],
  ["notifications.listMine", anyApi.notifications.listMine, {}],
  ["rdv.list", anyApi.rdv.list, { paginationOpts: PAGE }],
]) {
  await q(anon, "anonyme", `${name} fermé`, ref, args, (r) =>
    threw(r) ? [true, r.__threw.slice(0, 60)] : [false, `OUVERT : ${JSON.stringify(r).slice(0, 80)}`]);
}
await q(anon, "anonyme", "users.me = null", anyApi.users.me, {}, (r) =>
  threw(r) ? [true, r.__threw.slice(0, 60)] : [r === null, `retour=${JSON.stringify(r)?.slice(0, 40)}`]);

// Mauvais mot de passe → refus
try {
  const c = new ConvexHttpClient(URL);
  await c.action(anyApi.auth.signIn, { provider: "password", params: { email: EMAILS.admin, password: "mauvais-mdp-123", flow: "signIn" } });
  check("anonyme", "signIn mauvais mot de passe refusé", "LEAK", "CONNECTÉ avec un mauvais mot de passe !");
} catch (e) {
  check("anonyme", "signIn mauvais mot de passe refusé", "PASS", e.message.split("\n")[0].slice(0, 80));
}

const leaks = results.filter((r) => r.verdict === "LEAK");
const fails = results.filter((r) => r.verdict === "FAIL");
console.log(`\n══ BILAN : ${results.length} vérifications — ${results.filter((r) => r.verdict === "PASS").length} PASS, ${leaks.length} LEAK, ${fails.length} FAIL ══`);
process.exit(leaks.length || fails.length ? 1 : 0);
