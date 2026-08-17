/**
 * Registre des routes /api/v1 : concatène les listes par domaine + routes
 * d'introspection. Ajouter un domaine = ajouter sa liste ici.
 */
import { API_PREFIX, allowedRoutes, buildOpenApi, describeToken, type RouteDef } from "./router";

const META: RouteDef[] = [
  {
    method: "GET",
    path: "/me",
    scope: null,
    summary: "Identité de la clé : nom, scopes, routes accessibles",
    handler: async (_ctx, req) => ({
      ...describeToken(req.token),
      routes: allowedRoutes(ROUTES, req.token),
    }),
  },
  {
    method: "GET",
    path: "/openapi.json",
    scope: null,
    summary: "Spécification OpenAPI 3.1 de l'API",
    handler: async (_ctx, req) => buildOpenApi(ROUTES, new URL(req.raw.url).origin),
  },
];

export const ROUTES: RouteDef[] = [
  ...META,
  // Lot 2 : ...LEADS, ...RDV, ...CALLS, ...DEBRIEFS, ...DEVIS, ...PROJECTS,
  // ...CLIENTS, ...PAYMENTS, ...ADS, ...ANALYTICS, ...USERS, ...NOTIFICATIONS,
  // ...OBJECTIVES, ...REFERRERS, ...CALENDAR, ...ACTIVITY
];

export { API_PREFIX };
