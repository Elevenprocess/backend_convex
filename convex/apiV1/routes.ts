/**
 * Registre des routes /api/v1 — toutes les fonctionnalités Velora, par domaine.
 *
 * Chaque route « pontée » (`bridged(...)`) délègue à une fonction métier
 * existante (`module.fn`, cf. bridge.ts) : les arguments viennent des
 * paramètres de chemin, de la query (coercée selon le validateur Convex) et du
 * body JSON ; `now` / `today` / `todayStart` sont injectés si absents ;
 * `paginationOpts` est piloté par `?limit=&cursor=` et la réponse renvoie
 * `{ items, nextCursor }`.
 *
 * Ordre : routes statiques AVANT routes paramétrées d'un même préfixe
 * (`/leads/stats` avant `/leads/:leadId`).
 *
 * Non exposé (actions GHL / e-mail / sync ads) : agenda GHL (calendar), envoi
 * d'invitation, synchro dépenses pubs — lot ultérieur.
 */
import { REGISTRY } from "./bridge";
import { coerceQuery, topLevelFields } from "./validate";
import {
  API_PREFIX, allowedRoutes, badRequest, buildGuide, buildOpenApi, describeToken, invoke,
  type ApiMethod, type RouteDef, type RouteScope,
} from "./router";

const RESERVED_QUERY = new Set(["limit", "cursor"]);
const MAX_PAGE = 200;

/** Date YYYY-MM-DD à La Réunion (fuseau métier de Velora). */
export function isoDateReunion(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-CA", { timeZone: "Indian/Reunion" });
}
/** Minuit à La Réunion (UTC+4, sans DST) du jour de `ms`. */
export function startOfDayReunion(ms: number): number {
  const d = isoDateReunion(ms);
  return Date.parse(`${d}T00:00:00+04:00`);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function bridged(method: ApiMethod, path: string, scope: RouteScope, fn: string, summary: string): RouteDef {
  if (!REGISTRY[fn]) throw new Error(`Route ${method} ${path} : fonction inconnue ${fn}`);
  return {
    method, path, scope, summary, fn,
    handler: async (ctx, req) => {
      const argsJson = REGISTRY[fn].exportArgs?.() ?? '{"type":"any"}';
      const fields = topLevelFields(argsJson);
      const rawQuery: Record<string, string> = {};
      req.query.forEach((v, k) => { if (!RESERVED_QUERY.has(k)) rawQuery[k] = v; });
      if (req.body !== undefined && !isPlainObject(req.body)) throw badRequest("Le body doit être un objet JSON");
      const args: Record<string, unknown> = {
        ...coerceQuery(argsJson, rawQuery),
        ...(isPlainObject(req.body) ? req.body : {}),
        ...req.params,
      };
      if (fields.paginationOpts) {
        const rawLimit = req.query.get("limit");
        const limit = rawLimit ? Number(rawLimit) : 50;
        if (!Number.isFinite(limit) || limit < 1) throw badRequest("`limit` doit être un entier ≥ 1");
        args.paginationOpts = { numItems: Math.min(Math.floor(limit), MAX_PAGE), cursor: req.query.get("cursor") ?? null };
      }
      if (fields.now && args.now === undefined) args.now = req.now;
      if (fields.today && args.today === undefined) args.today = isoDateReunion(req.now);
      if (fields.todayStart && args.todayStart === undefined) args.todayStart = startOfDayReunion(req.now);

      const out = await invoke(ctx, req, fn, args);
      if (fields.paginationOpts && isPlainObject(out) && Array.isArray(out.page)) {
        return { items: out.page, nextCursor: out.isDone ? null : out.continueCursor };
      }
      return out ?? null;
    },
  };
}

const R = bridged;

// ─── Meta ────────────────────────────────────────────────────────────────────
const META: RouteDef[] = [
  {
    method: "GET", path: "/me", scope: null,
    summary: "Identité de la clé : nom, scopes, routes accessibles",
    handler: async (_ctx, req) => ({ ...describeToken(req.token), routes: allowedRoutes(ROUTES, req.token) }),
  },
  {
    method: "GET", path: "/openapi.json", scope: null, public: true,
    summary: "Spécification OpenAPI 3.1 de l'API (publique)",
    handler: async (_ctx, req) => buildOpenApi(ROUTES, new URL(req.raw.url).origin),
  },
  {
    method: "GET", path: "/guide.md", scope: null, public: true,
    summary: "Guide Markdown pour agents IA : règles, vocabulaire métier, routes (public)",
    handler: async (_ctx, req) => buildGuide(ROUTES, new URL(req.raw.url).origin),
  },
];

// ─── Prospects ───────────────────────────────────────────────────────────────
const LEADS: RouteDef[] = [
  R("GET", "/leads", "leads:read", "leads.list", "Lister les prospects (filtres status, setterId, assignedToId, city, search ; paginé)"),
  R("GET", "/leads/enriched", "leads:read", "leads.listEnriched", "Lister les prospects enrichis (dernier appel, RDV, débrief…) ; paginé"),
  R("GET", "/leads/stats", "leads:read", "leads.stats", "Compteurs prospects (par statut, du jour)"),
  R("GET", "/leads/dashboard", "leads:read", "leads.dashboard", "Tableau de bord prospects"),
  R("GET", "/leads/pending-quotes", "leads:read", "leads.pendingQuotes", "Prospects en attente de devis"),
  R("GET", "/leads/source-map", "leads:read", "leads.sourceMapList", "Table de correspondance source brute → canal"),
  R("GET", "/leads/source-map/unmapped", "leads:read", "leads.sourceMapUnmapped", "Sources brutes sans canal"),
  R("GET", "/leads/:leadId", "leads:read", "leads.get", "Fiche prospect"),
  R("GET", "/leads/:leadId/enriched", "leads:read", "leads.getEnriched", "Fiche prospect enrichie"),
  R("POST", "/leads", "leads:write", "leads.create", "Créer un prospect (saisie manuelle)"),
  R("PATCH", "/leads/:leadId", "leads:write", "leads.update", "Modifier un prospect"),
  R("POST", "/leads/:leadId/status", "leads:write", "leads.updateStatus", "Changer le statut d'un prospect"),
  R("POST", "/leads/:leadId/qualify", "leads:write", "leads.qualify", "Qualifier / disqualifier un prospect"),
  R("POST", "/leads/:leadId/assign-setter", "leads:write", "leads.assignSetter", "Attribuer un setter"),
  R("POST", "/leads/:leadId/assign-commercial", "leads:write", "leads.assignCommercial", "Attribuer un commercial"),
  R("DELETE", "/leads/:leadId", "leads:write", "leads.softDelete", "Supprimer (soft) un prospect"),
  R("POST", "/leads/source-map", "leads:write", "leads.sourceMapUpsert", "Créer / modifier une correspondance source → canal"),
];

// ─── Rendez-vous ─────────────────────────────────────────────────────────────
const RDV: RouteDef[] = [
  R("GET", "/rdv", "rdv:read", "rdv.list", "Lister les RDV (commercialId, status, result, from, to ; paginé)"),
  R("GET", "/rdv/awaiting-debrief", "rdv:read", "rdv.awaitingDebrief", "RDV passés sans débrief"),
  R("GET", "/rdv/signatures", "rdv:read", "rdv.listSignatures", "RDV signés"),
  R("GET", "/rdv/:rdvId", "rdv:read", "rdv.get", "Détail d'un RDV"),
  R("GET", "/leads/:leadId/rdv", "rdv:read", "rdv.listByLead", "RDV d'un prospect"),
  R("POST", "/rdv", "rdv:write", "rdv.create", "Créer un RDV"),
  R("PATCH", "/rdv/:rdvId", "rdv:write", "rdv.update", "Modifier un RDV (statut, date, résultat, montant…)"),
  R("POST", "/rdv/:rdvId/reception-flag", "rdv:write", "rdv.flagByReception", "Signaler un RDV annulé / reporté (réception)"),
];

// ─── Appels ──────────────────────────────────────────────────────────────────
const CALLS: RouteDef[] = [
  R("GET", "/calls/upcoming-callbacks", "calls:read", "callLogs.upcomingCallbacks", "Rappels à venir"),
  R("GET", "/calls/by-setter/:setterId", "calls:read", "callLogs.listBySetter", "Appels d'un setter"),
  R("GET", "/leads/:leadId/calls", "calls:read", "callLogs.listByLead", "Appels d'un prospect"),
  R("POST", "/leads/:leadId/calls", "calls:write", "callLogs.logCall", "Journaliser un appel (met à jour le statut du prospect)"),
];

// ─── Débriefs ────────────────────────────────────────────────────────────────
const DEBRIEFS: RouteDef[] = [
  R("GET", "/debriefs/:debriefId", "debriefs:read", "debriefs.get", "Détail d'un débrief"),
  R("GET", "/leads/:leadId/debriefs", "debriefs:read", "debriefs.listByLead", "Débriefs d'un prospect"),
  R("GET", "/projects/:projectId/debriefs", "debriefs:read", "debriefs.listByProject", "Débriefs d'un dossier"),
  R("POST", "/debriefs", "debriefs:write", "debriefs.create", "Créer un débrief (par projectId)"),
  R("POST", "/leads/:leadId/debriefs", "debriefs:write", "debriefs.createForLead", "Créer un débrief pour un prospect"),
  R("PATCH", "/debriefs/:debriefId", "debriefs:write", "debriefs.update", "Modifier un débrief"),
  R("DELETE", "/debriefs/:debriefId", "debriefs:write", "debriefs.softDelete", "Supprimer (soft) un débrief"),
];

// ─── Devis ───────────────────────────────────────────────────────────────────
const DEVIS: RouteDef[] = [
  R("GET", "/devis/:devisId", "devis:read", "devis.getById", "Détail d'un devis"),
  R("GET", "/devis/:devisId/pdf-url", "devis:read", "devis.getPdfUrl", "URL temporaire du PDF"),
  R("GET", "/leads/:leadId/devis", "devis:read", "devis.listByLead", "Devis d'un prospect"),
  R("POST", "/devis/upload-url", "devis:write", "devis.generateUploadUrl", "Obtenir une URL d'upload (PDF) → storageId"),
  R("POST", "/devis", "devis:write", "devis.create", "Créer un devis à partir d'un storageId"),
  R("PATCH", "/devis/:devisId", "devis:write", "devis.update", "Modifier un devis"),
  R("POST", "/devis/:devisId/sign", "devis:write", "devis.markAsSigned", "Marquer un devis signé"),
  R("POST", "/devis/:devisId/retry-ocr", "devis:write", "devis.retryOcr", "Relancer l'OCR"),
  R("DELETE", "/devis/:devisId", "devis:write", "devis.remove", "Supprimer un devis"),
];

// ─── Dossiers (projets, workflow, documents) ─────────────────────────────────
const PROJECTS: RouteDef[] = [
  R("GET", "/projects/:projectId", "projects:read", "projects.get", "Détail d'un projet"),
  R("GET", "/projects/:projectId/fiche", "projects:read", "projects.fiche", "Fiche complète d'un projet"),
  R("GET", "/leads/:leadId/projects", "projects:read", "projects.listByLead", "Projets d'un prospect"),
  R("GET", "/leads/:leadId/fiche", "projects:read", "projects.ficheByLead", "Fiche projet d'un prospect"),
  R("GET", "/workflow/steps", "projects:read", "workflowSteps.list", "Étapes de workflow (clientId, phase, status, responsableId)"),
  R("GET", "/workflow/steps/:stepId", "projects:read", "workflowSteps.get", "Détail d'une étape"),
  R("GET", "/workflow/substeps", "projects:read", "workflowSubsteps.list", "Sous-étapes (clientId, phase, status, responsableId)"),
  R("GET", "/workflow/substeps/:substepId", "projects:read", "workflowSubsteps.get", "Détail d'une sous-étape"),
  R("GET", "/workflow/substeps/:substepId/documents", "projects:read", "documents.listBySubstep", "Documents d'une sous-étape"),
  R("GET", "/documents/:documentId/url", "projects:read", "documents.getUrl", "URL temporaire d'un document"),
  R("GET", "/projects/:projectId/attachments", "projects:read", "projectAttachments.listByProject", "Pièces jointes d'un projet"),
  R("GET", "/attachments/:attachmentId/url", "projects:read", "projectAttachments.getUrl", "URL temporaire d'une pièce jointe"),
  R("POST", "/projects", "projects:write", "projects.create", "Créer un projet pour un prospect"),
  R("PATCH", "/projects/:projectId", "projects:write", "projects.update", "Modifier un projet"),
  R("DELETE", "/projects/:projectId", "projects:write", "projects.softDelete", "Supprimer (soft) un projet"),
  R("PATCH", "/workflow/steps/:stepId", "projects:write", "workflowSteps.update", "Modifier une étape (statut, dates, responsable, problème)"),
  R("POST", "/workflow/steps/:stepId/resolve-problem", "projects:write", "workflowSteps.resolveProblem", "Résoudre le problème d'une étape"),
  R("PATCH", "/workflow/substeps/:substepId", "projects:write", "workflowSubsteps.update", "Modifier une sous-étape"),
  R("POST", "/workflow/substeps/:substepId/resolve-problem", "projects:write", "workflowSubsteps.resolveProblem", "Résoudre le problème d'une sous-étape"),
  R("POST", "/documents/upload-url", "projects:write", "documents.generateUploadUrl", "URL d'upload de document → storageId"),
  R("POST", "/workflow/substeps/:substepId/documents", "projects:write", "documents.attachToSubstep", "Attacher des documents (storageIds) à une sous-étape"),
  R("DELETE", "/documents/:documentId", "projects:write", "documents.remove", "Supprimer un document"),
  R("POST", "/attachments/upload-url", "projects:write", "projectAttachments.generateUploadUrl", "URL d'upload de pièce jointe → storageId"),
  R("POST", "/projects/:projectId/attachments", "projects:write", "projectAttachments.create", "Ajouter une pièce jointe à un projet"),
  R("DELETE", "/attachments/:attachmentId", "projects:write", "projectAttachments.remove", "Supprimer une pièce jointe"),
];

// ─── Clients (délivrabilité) ─────────────────────────────────────────────────
const CLIENTS: RouteDef[] = [
  R("GET", "/clients", "clients:read", "clients.list", "Dossiers clients (phase, statusGlobal, blocked, technicienVtId, unassignedVt)"),
  R("GET", "/clients/vt-calendar", "clients:read", "clients.vtCalendar", "Agenda des visites techniques (from, to)"),
  R("GET", "/leads/:leadId/client", "clients:read", "clients.getByLead", "Dossier client d'un prospect"),
  R("GET", "/projects/:projectId/client", "clients:read", "clients.getByProject", "Dossier client d'un projet"),
  R("POST", "/clients/:clientId/techniciens", "clients:write", "clients.assignTechniciens", "Affecter le(s) technicien(s) VT"),
  R("POST", "/clients/bootstrap", "clients:write", "clients.bootstrap", "Créer le dossier client d'un lead/projet signé"),
  R("POST", "/clients/manual", "clients:write", "clients.createManualDossier", "Créer un dossier client manuel"),
];

// ─── Paiements ───────────────────────────────────────────────────────────────
const PAYMENTS: RouteDef[] = [
  R("GET", "/payments/acomptes", "payments:read", "payments.listAcomptes", "Acomptes et échéanciers"),
  R("GET", "/debriefs/:debriefId/acompte", "payments:read", "payments.getAcompte", "Acompte / échéancier d'une vente"),
  R("GET", "/clients/:clientId/acompte-state", "payments:read", "payments.acompteStateByClient", "État d'acompte d'un client"),
  R("PATCH", "/debriefs/:debriefId/financing", "payments:write", "payments.updateFinancing", "Modifier le financement d'une vente"),
  R("POST", "/debriefs/:debriefId/echeancier", "payments:write", "payments.setEcheancier", "Définir l'échéancier (tranches)"),
  R("DELETE", "/debriefs/:debriefId/echeancier", "payments:write", "payments.resetEcheancier", "Réinitialiser l'échéancier"),
  R("POST", "/debriefs/:debriefId/echeances", "payments:write", "payments.recordEcheance", "Enregistrer une échéance (encaissement…)"),
];

// ─── Publicités ──────────────────────────────────────────────────────────────
const ADS: RouteDef[] = [
  R("GET", "/ads/report", "ads:read", "ads.report", "Rapport dépense × prospects × CA (from, to, level, channel)"),
  R("GET", "/ads/deposits", "ads:read", "adDeposits.list", "Dépôts (recharges) d'un canal"),
  R("GET", "/ads/deposits/budget", "ads:read", "adDeposits.budget", "Budget restant d'un canal"),
  R("POST", "/ads/deposits", "ads:write", "adDeposits.add", "Ajouter un dépôt"),
  R("DELETE", "/ads/deposits/:id", "ads:write", "adDeposits.remove", "Supprimer un dépôt"),
];

// ─── Analytics ───────────────────────────────────────────────────────────────
const ANALYTICS: RouteDef[] = [
  R("GET", "/analytics/summary", "analytics:read", "analytics.summary", "KPI globaux (days | from/to)"),
  R("GET", "/analytics/funnel", "analytics:read", "analytics.funnel", "Funnel prospects → RDV → ventes"),
  R("GET", "/analytics/setters", "analytics:read", "analytics.setterLeaderboard", "Classement des setters"),
  R("GET", "/analytics/setters/:setterId", "analytics:read", "analytics.setterStats", "Stats d'un setter"),
  R("GET", "/analytics/commercials/:commercialId", "analytics:read", "analytics.commercialStats", "Stats d'un commercial"),
  R("GET", "/analytics/debriefs", "analytics:read", "analytics.debriefStats", "Stats des débriefs"),
  R("GET", "/analytics/pipeline/distribution", "analytics:read", "analytics.pipelineDistribution", "Répartition du pipeline"),
  R("GET", "/analytics/pipeline/by-commercial", "analytics:read", "analytics.pipelineByCommercial", "Pipeline par commercial"),
  R("GET", "/analytics/pipeline/stuck", "analytics:read", "analytics.pipelineStuck", "Dossiers bloqués depuis N jours (days)"),
  R("GET", "/analytics/simulator", "analytics:read", "simulatorStats.funnel", "Funnel du simulateur (from, to)"),
];

// ─── Utilisateurs ────────────────────────────────────────────────────────────
const USERS: RouteDef[] = [
  R("GET", "/users", "users:read", "users.list", "Lister les utilisateurs (role, team, active)"),
  R("GET", "/users/directory", "users:read", "users.directory", "Annuaire minimal (id, nom, rôle)"),
  R("GET", "/users/invitations", "users:read", "invitations.listInvitations", "Invitations en attente"),
  R("GET", "/users/:userId", "users:read", "users.get", "Fiche utilisateur"),
  R("POST", "/users", "users:write", "users.create", "Créer un utilisateur"),
  R("PATCH", "/users/:userId", "users:write", "users.adminUpdate", "Modifier un utilisateur"),
  R("POST", "/users/:userId/role", "users:write", "users.updateRole", "Changer le rôle"),
  R("POST", "/users/:userId/active", "users:write", "users.toggleActive", "Activer / désactiver"),
  R("POST", "/users/:userId/renew", "users:write", "invitations.renewUser", "Renouveler un accès (nouvelle invitation)"),
  R("DELETE", "/users/:userId", "users:write", "users.remove", "Supprimer un utilisateur"),
  R("DELETE", "/users/invitations/:invitationId", "users:write", "invitations.revokeInvitation", "Révoquer une invitation"),
];

// ─── Notifications ───────────────────────────────────────────────────────────
const NOTIFICATIONS: RouteDef[] = [
  R("GET", "/notifications", "notifications:read", "notifications.listMine", "Notifications de l'acteur (X-Acting-As pour un utilisateur)"),
  R("POST", "/notifications/read-all", "notifications:write", "notifications.markAllRead", "Tout marquer lu"),
  R("POST", "/notifications/:notificationId/read", "notifications:write", "notifications.markRead", "Marquer une notification lue"),
];

// ─── Objectifs, apporteurs, historique ───────────────────────────────────────
const OBJECTIVES: RouteDef[] = [
  R("GET", "/objectives", "objectives:read", "commercialObjectives.listByPeriod", "Objectifs d'une période (period=YYYY-MM)"),
  R("POST", "/objectives", "objectives:write", "commercialObjectives.upsert", "Créer / modifier l'objectif d'un commercial"),
];
const REFERRERS: RouteDef[] = [
  R("GET", "/referrers", "referrers:read", "referrers.list", "Apporteurs d'affaires"),
  R("POST", "/referrers", "referrers:write", "referrers.create", "Créer un apporteur"),
];
const ACTIVITY: RouteDef[] = [
  R("GET", "/activity", "activity:read", "activityLog.list", "Journal d'activité (from, to, actorId, domain, entityType, leadId, clientId, search ; paginé)"),
  R("GET", "/leads/:leadId/activity", "activity:read", "activityLog.forLead", "Historique d'un prospect"),
];

export const ROUTES: RouteDef[] = [
  ...META,
  ...LEADS, ...RDV, ...CALLS, ...DEBRIEFS, ...DEVIS, ...PROJECTS, ...CLIENTS,
  ...PAYMENTS, ...ADS, ...ANALYTICS, ...USERS, ...NOTIFICATIONS,
  ...OBJECTIVES, ...REFERRERS, ...ACTIVITY,
];

export { API_PREFIX };
