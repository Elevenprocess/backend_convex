# API Velora pour agents (Hermes) — design validé le 2026-08-17

## Objectif
Exposer toutes les fonctionnalités de Velora à un agent externe (Hermes, VPS) via une API
HTTP authentifiée par clé, avec un choix de scopes par domaine (lecture / écriture),
gérée par les admins depuis Paramètres.

## Décisions
- **Transport** : REST HTTP sur `https://spotted-horse-257.eu-west-1.convex.site/api/v1/...`,
  header `Authorization: Bearer vk_live_...`. Spec `GET /api/v1/openapi.json`, `GET /api/v1/me`.
- **Scopes** : domaine × `read`/`write` (16 domaines, voir tableau). Presets `*:read`, `*:write`.
- **Écriture** : autorisée dès cette version, gardée par `<domaine>:write`, tracée dans `activityLog`.
- **Gestion** : carte « Clés API / Agents » dans Settings (admin), table `apiKeys`, secret affiché une seule fois.
- **Identité** : la clé est un compte de service admin (voit toute l'entreprise, limité par ses scopes) ;
  `actingAs` optionnel pour attribuer une action à un utilisateur.
- **Compat** : `hermes.ts` + `HERMES_API_KEY` conservés (agent débriefs n8n).

## Architecture
```
Agent ──HTTPS──▶ convex/http.ts ──▶ convex/api/router.ts
                     1. lookup clé (SHA-256) dans `apiKeys`
                     2. active / non expirée / scope requis / rate limit
                     3. dispatch vers internalQuery/internalMutation de convex/api/<domaine>.ts
                     4. lastUsedAt + callCount + trace activityLog (écritures)
                 convex/api/<domaine>.ts réutilise convex/model/* (logique métier extraite au besoin,
                 sans toucher aux mutations écran qui font requireUser()).
```

### Table `apiKeys`
`name`, `keyHash` (index `by_keyHash`), `prefix`, `scopes: string[]`, `createdBy`, `createdAt`,
`expiresAt?`, `revokedAt?`, `lastUsedAt?`, `callCount`, `windowStart?`, `windowCount?` (rate limit).

### Erreurs JSON
`401 invalid_key`, `403 missing_scope {required}`, `404 not_found`, `422 validation`, `429 rate_limited`, `500 internal`.

## Scopes & routes
| Scope | read | write |
|---|---|---|
| leads | list/search, get (enrichi), stats, dashboard, source-map | create, update, updateStatus, qualify, assignSetter, assignCommercial, delete, sourceMapUpsert |
| rdv | list, get, listByLead, awaitingDebrief, signatures | create, update/reschedule, flagByReception |
| calls | listByLead, listBySetter, upcomingCallbacks | logCall |
| debriefs | listByLead/Project, get, stats | create, update, delete |
| devis | listByLead, get, pdfUrl | create, update, markAsSigned, remove, retryOcr |
| projects | get, listByLead, fiche, steps, substeps, documents, attachments | create, update, step/substep update, resolveProblem, attach |
| clients | list, getByLead/Project, vtCalendar | assignTechniciens, createManualDossier |
| payments | acomptes list/get, état par client | updateFinancing, set/resetEcheancier, recordEcheance |
| ads | rapport, séries, dépôts, budget | addDeposit, removeDeposit, sync |
| analytics | summary, funnel, leaderboards, pipeline*, simulateur | — |
| users | list, directory, get, invitations | create, adminUpdate, updateRole, toggleActive, invitations |
| notifications | list | markRead |
| objectives | listByPeriod | upsert |
| referrers | list | create |
| calendar | calendars, freeSlots, events | createAppointment, updateAppointment, reassign, sync |
| activity | list, forLead | — |
| apikeys | réservé UI admin, jamais accordé à une clé | |

Conventions : `GET /api/v1/<domaine>?…&limit=&cursor=`, `GET /…/{id}`, `POST`, `PATCH`,
actions métier `POST /…/{id}/<action>`. IDs Convex, timestamps ISO, `createdAt` (jamais `_creationTime`).
Pagination curseur, `limit` ≤ 200.

## UI (Settings, admin)
Tableau des clés (nom, préfixe, scopes, créée par/le, dernier usage, appels, expiration, statut ;
Révoquer, Modifier scopes). Modale « Nouvelle clé » : nom, grille domaines × Lecture/Écriture,
presets, expiration (30/90/365 j/jamais). Clé complète affichée une fois + snippet curl.

## Sécurité
Format `vk_live_` + 32 chars ; SHA-256 stocké ; fail-closed ; rate limit 300 req/min/clé ;
écritures tracées `activityLog` (acteur « Clé API : <nom> », `actingAs?`) ; création/révocation
dans `auditLog` ; pas de CORS ; scope `apikeys` non accordable.

## Tests
`apiKeys.test.ts`, `api_auth.test.ts` (401/403/429/lastUsedAt), un test par domaine (1 read + 1 write
+ trace activityLog), `api_openapi.test.ts`.

## Lots
1. Socle : table, mutations admin, router (auth/scopes/erreurs/rate limit/me/openapi), carte Settings.
2. Routes lecture (tous domaines).
3. Routes écriture (tous domaines), extraction métier vers `model/*`.
4. `docs/api-hermes.md` + fiche outil Hermes.

## Branchement Hermes
Outil HTTP générique côté VPS (`VELORA_API_URL`, `VELORA_API_KEY`) ; l'agent lit `/api/v1/openapi.json`
au démarrage. Aucune dépendance Composio.
