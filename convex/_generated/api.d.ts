/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as callLogs from "../callLogs.js";
import type * as clients from "../clients.js";
import type * as debriefs from "../debriefs.js";
import type * as devis from "../devis.js";
import type * as documents from "../documents.js";
import type * as http from "../http.js";
import type * as leads from "../leads.js";
import type * as model_access from "../model/access.js";
import type * as model_acompteEcheancier from "../model/acompteEcheancier.js";
import type * as model_analyticsBuilders from "../model/analyticsBuilders.js";
import type * as model_analyticsRange from "../model/analyticsRange.js";
import type * as model_assembleEcheancier from "../model/assembleEcheancier.js";
import type * as model_audit from "../model/audit.js";
import type * as model_delivrabilitePermissions from "../model/delivrabilitePermissions.js";
import type * as model_delivrabiliteSeam from "../model/delivrabiliteSeam.js";
import type * as model_deriveDelivrabilite from "../model/deriveDelivrabilite.js";
import type * as model_deriveLeadStatus from "../model/deriveLeadStatus.js";
import type * as model_deriveLeadStatusFromDebrief from "../model/deriveLeadStatusFromDebrief.js";
import type * as model_devisExtraction from "../model/devisExtraction.js";
import type * as model_devisStatusSync from "../model/devisStatusSync.js";
import type * as model_ensureDossier from "../model/ensureDossier.js";
import type * as model_ensureProject from "../model/ensureProject.js";
import type * as model_enums from "../model/enums.js";
import type * as model_funnelMath from "../model/funnelMath.js";
import type * as model_notifMessages from "../model/notifMessages.js";
import type * as model_notify from "../model/notify.js";
import type * as model_ocr from "../model/ocr.js";
import type * as model_stageHistory from "../model/stageHistory.js";
import type * as model_substepCatalog from "../model/substepCatalog.js";
import type * as model_substepGating from "../model/substepGating.js";
import type * as model_syncFromCommercial from "../model/syncFromCommercial.js";
import type * as model_vtCalendar from "../model/vtCalendar.js";
import type * as notifications from "../notifications.js";
import type * as payments from "../payments.js";
import type * as projects from "../projects.js";
import type * as rdv from "../rdv.js";
import type * as referrers from "../referrers.js";
import type * as users from "../users.js";
import type * as workflowSteps from "../workflowSteps.js";
import type * as workflowSubsteps from "../workflowSubsteps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  callLogs: typeof callLogs;
  clients: typeof clients;
  debriefs: typeof debriefs;
  devis: typeof devis;
  documents: typeof documents;
  http: typeof http;
  leads: typeof leads;
  "model/access": typeof model_access;
  "model/acompteEcheancier": typeof model_acompteEcheancier;
  "model/analyticsBuilders": typeof model_analyticsBuilders;
  "model/analyticsRange": typeof model_analyticsRange;
  "model/assembleEcheancier": typeof model_assembleEcheancier;
  "model/audit": typeof model_audit;
  "model/delivrabilitePermissions": typeof model_delivrabilitePermissions;
  "model/delivrabiliteSeam": typeof model_delivrabiliteSeam;
  "model/deriveDelivrabilite": typeof model_deriveDelivrabilite;
  "model/deriveLeadStatus": typeof model_deriveLeadStatus;
  "model/deriveLeadStatusFromDebrief": typeof model_deriveLeadStatusFromDebrief;
  "model/devisExtraction": typeof model_devisExtraction;
  "model/devisStatusSync": typeof model_devisStatusSync;
  "model/ensureDossier": typeof model_ensureDossier;
  "model/ensureProject": typeof model_ensureProject;
  "model/enums": typeof model_enums;
  "model/funnelMath": typeof model_funnelMath;
  "model/notifMessages": typeof model_notifMessages;
  "model/notify": typeof model_notify;
  "model/ocr": typeof model_ocr;
  "model/stageHistory": typeof model_stageHistory;
  "model/substepCatalog": typeof model_substepCatalog;
  "model/substepGating": typeof model_substepGating;
  "model/syncFromCommercial": typeof model_syncFromCommercial;
  "model/vtCalendar": typeof model_vtCalendar;
  notifications: typeof notifications;
  payments: typeof payments;
  projects: typeof projects;
  rdv: typeof rdv;
  referrers: typeof referrers;
  users: typeof users;
  workflowSteps: typeof workflowSteps;
  workflowSubsteps: typeof workflowSubsteps;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
