# API Velora pour agents (Hermes, n8n, scripts)

Base : `https://spotted-horse-257.eu-west-1.convex.site/api/v1`
Auth : header `Authorization: Bearer vlr_…` (clé créée dans **Paramètres → Clés API / Agents**, admin).

```bash
export VELORA_API=https://spotted-horse-257.eu-west-1.convex.site/api/v1
export VELORA_KEY=vlr_xxxxxxxx

curl -H "Authorization: Bearer $VELORA_KEY" $VELORA_API/me            # qui suis-je, quels scopes, quelles routes
curl -H "Authorization: Bearer $VELORA_KEY" $VELORA_API/openapi.json  # spec OpenAPI 3.1 complète
```

## Scopes
`<domaine>:read` / `<domaine>:write`, presets `*:read` / `*:write`. `write` n'implique pas `read`.
Domaines : `leads rdv calls debriefs devis projects clients payments ads analytics users notifications objectives referrers calendar activity`.

Une clé agit comme un **compte de service admin** (« Agent API ») limité par ses scopes.
Header optionnel `X-Acting-As: <userId>` : l'action est faite **au nom d'un utilisateur** (ses droits s'appliquent ;
ex. journaliser un appel pour un setter → l'appel lui est attribué). Le journal d'activité indique
« Nom (via Clé API : <nom de la clé>) ».

## Conventions
- JSON partout ; IDs = IDs Convex ; dates en ms epoch (`scheduledAt`, `from`, `to`) sauf mention `YYYY-MM-DD` (`period`, `today`, rapports ads).
- Listes paginées : `?limit=` (1-200, défaut 50) `&cursor=` → `{ "items": [...], "nextCursor": "…" | null }`.
- Query params typés automatiquement (`?from=1723000000000` → nombre, `?active=true` → booléen, `?ids=a,b` → tableau).
- `now`, `today`, `todayStart` sont injectés (heure serveur / date Réunion) si absents.
- Erreurs : `{ "error": { "code", "message", ... } }` — `401 invalid_key|revoked|expired`, `403 missing_scope {required}`,
  `404 not_found`, `405 method_not_allowed`, `422 validation` (message métier en français), `429 rate_limited` (300 req/min/clé, `Retry-After`).

## Routes principales (voir `/openapi.json` pour la liste exhaustive et les schémas)

| Domaine | Lecture | Écriture |
|---|---|---|
| leads | `GET /leads`, `/leads/enriched`, `/leads/stats`, `/leads/dashboard`, `/leads/pending-quotes`, `/leads/source-map`, `/leads/{leadId}`, `/leads/{leadId}/enriched` | `POST /leads`, `PATCH /leads/{leadId}`, `POST /leads/{leadId}/status`, `/qualify`, `/assign-setter`, `/assign-commercial`, `DELETE /leads/{leadId}`, `POST /leads/source-map` |
| rdv | `GET /rdv`, `/rdv/awaiting-debrief`, `/rdv/signatures`, `/rdv/{rdvId}`, `/leads/{leadId}/rdv` | `POST /rdv`, `PATCH /rdv/{rdvId}`, `POST /rdv/{rdvId}/reception-flag` |
| calls | `GET /leads/{leadId}/calls`, `/calls/by-setter/{setterId}`, `/calls/upcoming-callbacks` | `POST /leads/{leadId}/calls` |
| debriefs | `GET /debriefs/{debriefId}`, `/leads/{leadId}/debriefs`, `/projects/{projectId}/debriefs` | `POST /debriefs`, `POST /leads/{leadId}/debriefs`, `PATCH /debriefs/{debriefId}`, `DELETE …` |
| devis | `GET /devis/{devisId}`, `/devis/{devisId}/pdf-url`, `/leads/{leadId}/devis` | `POST /devis/upload-url` → PUT du PDF → `POST /devis`, `PATCH`, `/sign`, `/retry-ocr`, `DELETE` |
| projects | `GET /projects/{projectId}`, `/fiche`, `/leads/{leadId}/projects`, `/leads/{leadId}/fiche`, `/workflow/steps`, `/workflow/substeps`, documents, attachments | `POST /projects`, `PATCH`, `DELETE`, `PATCH /workflow/steps/{stepId}`, `/resolve-problem`, sous-étapes, upload documents / pièces jointes |
| clients | `GET /clients`, `/clients/vt-calendar`, `/leads/{leadId}/client`, `/projects/{projectId}/client` | `POST /clients/{clientId}/techniciens`, `/clients/bootstrap`, `/clients/manual` |
| payments | `GET /payments/acomptes`, `/debriefs/{debriefId}/acompte`, `/clients/{clientId}/acompte-state` | `PATCH /debriefs/{debriefId}/financing`, `POST|DELETE …/echeancier`, `POST …/echeances` |
| ads | `GET /ads/report?from&to&level&channel`, `/ads/deposits?channel`, `/ads/deposits/budget?channel` | `POST /ads/deposits`, `DELETE /ads/deposits/{id}` |
| analytics | `GET /analytics/summary`, `/funnel`, `/setters`, `/setters/{setterId}`, `/commercials/{commercialId}`, `/debriefs`, `/pipeline/*`, `/simulator` | — |
| users | `GET /users`, `/users/directory`, `/users/invitations`, `/users/{userId}` | `POST /users`, `PATCH /users/{userId}`, `/role`, `/active`, `/renew`, `DELETE`, `DELETE /users/invitations/{invitationId}` |
| notifications | `GET /notifications` (avec `X-Acting-As`) | `POST /notifications/read-all`, `/notifications/{id}/read` |
| objectives | `GET /objectives?period=YYYY-MM` | `POST /objectives` |
| referrers | `GET /referrers` | `POST /referrers` |
| activity | `GET /activity`, `/leads/{leadId}/activity` | — |
| calendar | *routes à venir (actions GHL)* | |

## Exemples

```bash
# Prospects qualifiés, 20 par page
curl -H "Authorization: Bearer $VELORA_KEY" "$VELORA_API/leads?status=qualifie&limit=20"

# Journaliser un appel au nom d'un setter
curl -X POST -H "Authorization: Bearer $VELORA_KEY" -H "X-Acting-As: <userId setter>" \
  -H "content-type: application/json" \
  -d '{"result":"rappel_planifie","notes":"Rappeler jeudi","nextCallbackAt":1724000000000}' \
  "$VELORA_API/leads/<leadId>/calls"

# Reprogrammer un RDV
curl -X PATCH -H "Authorization: Bearer $VELORA_KEY" -H "content-type: application/json" \
  -d '{"scheduledAt":1724050000000,"status":"planifie"}' "$VELORA_API/rdv/<rdvId>"

# KPI 30 jours
curl -H "Authorization: Bearer $VELORA_KEY" "$VELORA_API/analytics/summary?days=30"
```

## Côté Hermes (VPS)
Un outil HTTP générique suffit : `VELORA_API_URL` + `VELORA_API_KEY`. Au démarrage, lire `/me`
(scopes + routes autorisées) puis `/openapi.json` pour les schémas. Toute réponse `403 missing_scope`
indique le scope à demander à un admin.

## Implémentation (repères)
`convex/apiV1/router.ts` (auth, scopes, erreurs), `routes.ts` (registre), `bridge.ts` (pont « acteur de
service » qui invoque les fonctions métier existantes avec le même journal d'activité), `validate.ts`
(validation/coercion/OpenAPI depuis les validateurs Convex), `convex/apiTokens.ts` + `model/apiScopes.ts`,
UI `frontend/src/components/settings/ApiTokensSection.tsx`.
