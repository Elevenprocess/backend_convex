# Technicien — scope dossiers attribués + planning VT/installation

**Date** : 2026-06-04
**Repos** : `ECOI_backend` (NestJS) + `ECOI_frontend` (React 19 / Vite)
**Statut** : design validé, prêt pour plan d'implémentation

## Problème

Le rôle `technicien` est aujourd'hui **cassé et non scopé** :

1. **Permissions mortes** — le scoping s'appuie sur `workflowSteps.responsableId`
   (`delivrabilite-permissions.ts`), mais ce champ n'est **jamais renseigné** :
   - `bootstrapFromRdv` / `bootstrapFromProject` créent les steps/substeps sans `responsableId`.
   - `assignTechnicien` n'écrit que `clients.technicienVtId`, ne propage rien.
   Conséquence : `visibleStepsWhere` ne matche jamais → le technicien voit **0 étape** ;
   `canEditStep` (`null === user.id`) est toujours faux → tous ses `PATCH` renvoient 403.
   Les tests passent seulement parce qu'ils injectent `responsableId` à la main.
2. **Surface trop large** — `GET /clients`, `GET /leads`, `GET /rdv`,
   `GET /documents/:id/raw` ne sont pas scopés : un technicien voit/télécharge
   tout le portefeuille. Côté front il est traité comme « ops » (`isOps`) et accède
   à Overview pipeline, Analytics, RDV, Rappels, liste clients complète.
3. **Aucun gating UI** dans `SubstepCard` / `WorkflowBoard` : tous les contrôles
   d'édition sont rendus pour tout le monde.

## Objectif

Le technicien doit **uniquement** :
- accéder aux **dossiers que le back office lui a attribués** (`clients.technicienVtId`) ;
- **éditer son terrain** sur ces dossiers : phases `vt` et `installation` (statut,
  dates, notes, upload rapport VT). Pas d'assignation, pas de résolution de problème,
  pas de paperasse (dp/racco/consuel/mes) ;
- voir un **calendrier de ses interventions** : dates de VT **et** d'installation.

Tout le reste lui est masqué et refusé.

## Décision d'architecture

**Source de vérité unique = `clients.technicienVtId`.** On rebase tout le scoping
du technicien sur ce champ (posé par le back office), au lieu du
`workflowSteps.responsableId` jamais rempli. Aucune donnée d'attribution dupliquée.

## Backend (`ECOI_backend`)

### 1. `delivrabilite-permissions.ts`
- `visibleStepsWhere(user)` : pour un technicien, sous-requête
  `workflow_steps.client_id IN (SELECT id FROM clients WHERE technicien_vt_id = :userId)`.
- `visibleSubstepsWhere(user)` : idem sur `workflow_substeps.client_id`.
- `canEditStep(user, { phase, clientTechnicienVtId })` — **changement de signature** :
  le 2ᵉ argument porte `clientTechnicienVtId` (le technicien VT du dossier) au lieu de
  `responsableId`. Règle technicien : `can(edit, phase) && clientTechnicienVtId === user.id`.
- `canEditSubstep` : même signature/règle, délègue à `canEditStep`.
- `can()` inchangé (technicien : `view` toujours ok ; `edit` seulement sur
  `FIELD_PHASES = ['vt','installation']` ; `assign`/`resolve_problem`/`cancel_sale` = false).

### 2. Services
- `WorkflowStepsService.assertCanMutate` : charger le `technicienVtId` du dossier
  (`before.clientId`) et le passer à `canEditStep`.
- `SubstepsService.assertCanMutate` : idem avant `canEditSubstep`.
- (1 SELECT léger supplémentaire par mutation — acceptable.)

### 3. `GET /clients` scopé
- `ClientsController.list` passe l'`actor` (session) → `svc.list(q, actor)`.
- `ClientsService.list(q, actor)` : si `normalizeRole(actor.role) === 'technicien'`,
  **forcer** `conditions.push(eq(clients.technicienVtId, actor.id))` et **ignorer** tout
  `q.technicienVtId` reçu (pas d'élévation via query param).
- Les autres rôles du module restent non filtrés.

### 4. `GET /documents/:id/raw` scopé
- Avant de streamer : si technicien, vérifier que le `clientId` du document a
  `technicien_vt_id = actor.id`, sinon `NotFoundException` (pas de fuite d'existence).

### 5. Tests
- Technicien voit seulement ses dossiers attribués (`list`, `findAll` steps/substeps).
- Technicien édite vt/installation d'un dossier **attribué** → ok.
- Technicien sur un dossier **non attribué** → 403 (edit) / invisible (list).
- Technicien sur dp/racco/consuel/mes même attribué → 403.
- `GET /documents/:id/raw` d'un dossier non attribué → 404.
- Mise à jour de `delivrabilite-permissions.fixtures.json` et des specs qui
  injectaient `responsableId`.

## Frontend (`ECOI_frontend`)

### 6. Sidebar
- Pour `role === 'technicien'`, n'afficher que 2 entrées :
  - **« Planning »** → `/planning` (icône `calendar`)
  - **« Mes dossiers »** → `/client` (icône `inbox`)
- Retirer le technicien du traitement `isOps` générique (plus de Suivi global,
  Overview pipeline, Analytics, RDV, Rappels).

### 7. Routing (`main.tsx`)
- Redirection par défaut du technicien (`/` et `/overview`) → `/planning`.
- Garde `<Navigate to="/planning">` sur les pages ops si un technicien tape l'URL :
  Overview, Analytics, RDV, Notifications, Leads (`/leads`).
- `/client` et `/client/:id` (SuiviDetail) restent accessibles (données déjà scopées
  côté backend).

### 8. Nouvelle page `TechnicienPlanning` (`/planning`)
- Écran principal du technicien.
- Source : `GET /clients` (auto-scopé backend). Pour chaque dossier, dériver :
  - événement **VT** si `steps.vt.datePlanifiee` présent ;
  - événement **Installation** si `steps.installation.datePlanifiee` présent.
- Les dates sont des `date` (sans heure) → vue **mois/semaine** type grille
  (pas de positionnement horaire). Réutiliser les helpers timezone Réunion de
  `RdvCalendar.tsx` (extraire dans un module partagé si pertinent, sinon dupliquer
  le minimum).
- Chaque événement : nom client, ville, type (VT / Installation), statut de l'étape ;
  badge couleur VT vs Installation. Clic → fiche dossier (`/client/:id`).
- États : loading, vide (« Aucune intervention planifiée »), erreur.

### 9. « Mes dossiers » (`/client`)
- Réutiliser `ClientsList` (déjà alimenté par le `GET /clients` scopé).
- Pour le technicien : masquer toute action de réattribution / colonnes non
  pertinentes. Clic sur un dossier → board de suivi (`SuiviDetail`).

### 10. Gating `SubstepCard` / `WorkflowBoard`
- Passer le rôle + l'info d'édition au board.
- Pour le technicien : contrôles d'édition (statut, date, notes, dropzone upload,
  suppression doc) actifs **uniquement** sur les sous-étapes de phase `vt` /
  `installation` ; dp/racco/consuel/mes rendus en **lecture seule**.
- Le `TechnicienVtPicker` reste en lecture (déjà le cas : `canAssign` exclut technicien).

## Hors scope (YAGNI)

- Pas d'annulation de vente (`cancel_sale` reste non implémenté — chantier distinct).
- Pas de refonte du modèle `responsableId` (on le laisse pour un éventuel usage
  futur d'assignation fine par étape ; le scoping technicien ne s'en sert plus).
- Pas de notifications/push planning pour le technicien.

## Critères de succès

1. Un technicien connecté atterrit sur `/planning` et n'a que 2 entrées de menu.
2. Il voit dans son calendrier ses VT et installations planifiées, et rien d'autre.
3. Sa liste « Mes dossiers » ne contient que les dossiers où il est technicien VT.
4. Il peut faire avancer les sous-étapes vt/installation de ses dossiers ; les autres
   phases sont en lecture seule ; un dossier non attribué est invisible/refusé.
5. Aucun endpoint ne laisse fuiter un dossier ou un document non attribué.
6. Les tests backend couvrent visibilité + édition scopées sur `clients.technicienVtId`.
