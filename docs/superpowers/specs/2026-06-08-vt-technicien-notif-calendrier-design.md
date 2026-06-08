# VT technicien — notifications + calendrier

Date : 2026-06-08
Statut : validé (design), prêt pour plan d'implémentation
Périmètre : full-stack (ECOI_backend + ECOI_frontend)

## Problème

Dans la page **Suivi** (processus de délivrabilité), quand on planifie une
Visite Technique (VT) et qu'on attribue un technicien, **rien n'est envoyé au
technicien** : pas de notification, et la VT **n'apparaît pas dans son
calendrier**. Le technicien doit aujourd'hui aller consulter manuellement « Mes
interventions » (une simple liste).

Objectif : quand une VT est attribuée/planifiée à un technicien, il reçoit une
**notification in-app persistée + temps réel**, et la VT apparaît dans la page
**« Calendrier » (`/rdv`)**.

## Décisions de cadrage (validées avec l'utilisateur)

1. **Deux notifications** : une à l'attribution du technicien, une au
   changement de la date de VT.
2. Le « calendrier du technicien » = la page **« Calendrier » (`/rdv`)** (déjà
   renommée « Calendrier » pour le technicien). La VT y apparaît comme un
   évènement, à côté des RDV.
3. Notification **in-app persistée (table `notifications`) + temps réel**
   (WebSocket).

## État de l'existant (vérifié dans le code)

- **Attribution technicien** : `clients.technicienVtId` (FK users), posé via
  `PATCH /clients/:id` → `clients.service.ts::assignTechnicien()`. UI :
  `TechnicienVtPicker.tsx`.
- **Date + notes de VT** : saisies sur la carte « Planifier la VT »
  (`SubstepCard.tsx`) → `PATCH /substeps/:id` → `substeps.service.ts::update()`
  écrit `workflow_substeps.dateRealisee` / `.notes` pour la clé `vt_planifie`.
- **Liste interventions technicien** : `MesInterventions.tsx` via `useClients()`
  (scopé serveur : un technicien ne voit que `technicienVtId === lui` OU les
  installations dont il est responsable — `clients.service.ts`).
- **Calendrier** : `RdvCalendar.tsx` fusionne `useRdvList()` (RDV locaux) +
  `useGhlCalendarEvents()` (events GHL). Aucune VT aujourd'hui.
- **Table `notifications`** : existe en base (`db/schema/notifications.ts` :
  `id, userId, type, title, body, payload, readAt, createdAt`) mais **aucun
  service/controller ne l'utilise**.
- **Temps réel** : `RealtimeService.emitNotification()` fait
  `server.emit('notification:new', payload)` — **broadcast à tous**, pas de
  ciblage par utilisateur (le gateway n'authentifie pas les sockets, pas de
  rooms). Côté front (`realtime.ts`), `notification:new` déclenche une
  notification navigateur **pour tout le monde** et rafraîchit quelques paths.

## Contrainte d'architecture : ciblage par utilisateur

Le WebSocket diffusant à tous, le ciblage se fait par **un champ `userId` dans
l'évènement `notification:new` + filtrage côté frontend** : la notification
navigateur et le rafraîchissement de `/notifications` ne se déclenchent que si
`userId === utilisateur courant` (ou si `userId` est absent → comportement
legacy broadcast conservé). La persistance, elle, est bien par utilisateur
(ligne `notifications.userId`). Le vrai routage par room socket (auth socket)
est **hors périmètre**.

## Architecture cible — 4 chantiers

### Chantier 1 — Backend : module Notifications (persistance + lecture)

Nouveau module `ECOI_backend/src/modules/notifications/` :

- `notifications.service.ts`
  - `create(userId, type, title, body?, payload?)` : insert dans `notifications`,
    renvoie la ligne.
  - `createAndEmit(...)` : `create(...)` **puis**
    `realtime.emitNotification({ id, kind: type, title, body, userId, ...payload, createdAt })`.
    `realtime` injecté en `@Optional()` (cohérent avec les autres services).
  - `findForUser(userId, { unreadOnly?, limit? })` : liste triée
    `createdAt desc`.
  - `markRead(id, userId)` : pose `readAt = now()` si la ligne appartient à
    l'utilisateur, sinon `NotFoundException`/`ForbiddenException`.
  - `markAllRead(userId)`.
- `notifications.controller.ts` (gardé par l'auth existante) :
  - `GET /notifications?unreadOnly&limit` → notifs de l'utilisateur courant.
  - `PATCH /notifications/:id/read`.
  - `POST /notifications/read-all`.
- `notifications.module.ts` : exporte `NotificationsService`, importe le module
  realtime. Enregistré dans `app.module.ts`.
- DTOs : `notification-response.dto.ts` (`{ id, type, title, body, payload,
  readAt, createdAt }`), `query-notifications.dto.ts`.

Type de notif (`type` / `kind`) introduits : `vt_assigned`, `vt_date_changed`.

### Chantier 2 — Backend : déclencheurs des 2 notifications

- **Attribution** — `clients.service.ts::assignTechnicien()` :
  après update, si `dto.technicienVtId` est non nul **et différent** de l'ancien
  `technicienVtId`, appeler
  `notifications.createAndEmit(newTechId, 'vt_assigned', titre, corps, { clientId, leadId })`.
  Injecter `NotificationsService` en `@Optional()` pour ne pas casser les specs
  existantes qui n'ont pas le module.
  - Titre : `« Nouvelle VT attribuée »` ; corps : `«<nom client> — <ville> »`.
- **Changement de date** — `substeps.service.ts::update()` :
  dans la transaction, si `before.key === 'vt_planifie'` et que
  `dto.dateRealisee` est présent et **différent** de `before.dateRealisee`,
  résoudre le technicien (`clients.technicienVtId` du `updated.clientId`) ; s'il
  existe, `createAndEmit(techId, 'vt_date_changed', titre, corps, { clientId, substepId })`.
  - Corps : `« Date de VT : <date formatée FR> — <nom client> »`.
  - L'émission se fait **après commit** (ou via best-effort dans la transaction
    — voir note d'implémentation) pour éviter de notifier sur un rollback.

Les deux déclencheurs sont **best-effort** : une erreur de notification ne doit
pas faire échouer l'attribution/la mise à jour (try/catch + log).

### Chantier 3 — Backend : flux calendrier VT

Nouvel endpoint sur le module délivrabilité (clients) :

- `GET /clients/vt-calendar?from=<iso>&to=<iso>` →
  `VtCalendarEntry[]` où
  `VtCalendarEntry = { clientId, leadId, leadName, city, phone, date /* YYYY-MM-DD */, status, technicienVtId }`.
- Source de la date : sous-étape `vt_planifie.dateRealisee`, repli sur
  `vt_attribuee.dateRealisee` si vide. Filtre `from`/`to` sur cette date.
- **Scoping par rôle réutilisé** : un `technicien` ne reçoit que ses VT
  (`technicienVtId === lui`) ; managers/ops (admin, delivrabilite,
  responsable_technique, back_office) voient tout. Réutilise la logique de
  visibilité de `clients.service.ts`.

### Chantier 4 — Frontend

- **Hooks** (`ECOI_frontend/src/lib/hooks.ts` + `api.ts` + `types.ts`) :
  - `useVtCalendar({ from, to })` → `GET /clients/vt-calendar`. Type
    `VtCalendarEntry`.
  - `useNotifications({ unreadOnly?, limit? })` → `GET /notifications`. Type
    `NotificationResponse`. + `markNotificationRead(id)` / `markAllNotificationsRead()`.
- **Calendrier** (`RdvCalendar.tsx`) :
  - Étendre l'union `CalendarItem` avec `{ source: 'vt'; id; scheduledAt; vt: VtCalendarEntry }`.
  - `scheduledAt` = `date` à **08:00 heure Réunion** (la VT n'a pas d'heure).
  - Fusionner les VT dans `calendarItems` (chargées via `useVtCalendar` sur la
    même période). Style distinct (couleur/badge « VT » + icône), pour ne pas
    confondre avec un RDV commercial.
  - Au clic sur une VT :
    - rôles ops/managers (admin, delivrabilite, responsable_technique,
      back_office) → navigation vers le dossier Suivi (`/suivi/:clientId`).
    - **technicien** (n'a PAS accès à `/suivi`) → ouverture d'un popup
      lecture seule (nom, ville, téléphone, date, notes VT) ; pas de
      navigation. Réutilise le pattern `StackPopup`/modale existant.
  - Rendu dans `RdvBlock`, `RdvButton`, `StackPopup` (gérer la 3ᵉ variante de
    source proprement).
- **Notifications/Rappels** (`Notifications.tsx`) :
  - Ajouter les notifs persistées (`useNotifications`) comme **source
    supplémentaire** des rappels affichés, avec lien vers le dossier et action
    « marquer lu ».
  - Conserver les notifs dérivées existantes (leads/rdv/call-logs).
- **Temps réel** (`realtime.ts`) :
  - `notification:new` : ne déclencher la notification navigateur **que si**
    `notification.userId === utilisateur courant` ou `userId` absent.
  - Ajouter `/notifications` aux paths rafraîchis.
  - Récupérer l'utilisateur courant via le store auth (déjà accessible).

## Modèle de données

- **Aucune migration de schéma** : la table `notifications` existe déjà. On ne
  fait qu'ajouter le service/endpoints qui l'utilisent.
- Aucune nouvelle colonne sur `clients` / `workflow_substeps`.

## Flux de données (résumé)

1. Manager/ops attribue un technicien dans Suivi → `PATCH /clients/:id` →
   `assignTechnicien()` → `createAndEmit('vt_assigned')` → ligne `notifications`
   + `notification:new {userId}` → front du technicien : notif navigateur +
   refresh `/notifications` + apparition dans Rappels.
2. Manager/ops change la date « Planifier la VT » → `PATCH /substeps/:id` →
   `update()` → `createAndEmit('vt_date_changed')` → idem.
3. Technicien ouvre « Calendrier » (`/rdv`) → `useVtCalendar()` →
   `GET /clients/vt-calendar` (scopé) → VT affichées à 08:00 aux côtés des RDV.

## Gestion des erreurs

- Déclencheurs de notif : best-effort (try/catch + log), n'échouent jamais
  l'opération métier porteuse.
- `GET /clients/vt-calendar` et `GET /notifications` : erreurs remontées
  normalement (le front affiche l'état d'erreur déjà géré dans `RdvCalendar`).
- Ciblage navigateur : si pas de permission Notification, dégradation
  silencieuse (déjà géré dans `realtime.ts`).

## Tests

- **Backend** (⚠️ DB de test indisponible — privilégier des tests unitaires sans
  DB, type `*.service.spec.ts` avec exécuteur mocké, comme l'existant) :
  - `notifications.service.spec.ts` : `create`, `findForUser` (scoping),
    `markRead` (refus si autre user).
  - `assignTechnicien` : émet `vt_assigned` au nouveau technicien, n'émet pas si
    technicien inchangé / nul ; n'échoue pas si la notif jette.
  - `substeps.service` : émet `vt_date_changed` quand la date `vt_planifie`
    change avec technicien assigné ; pas d'émission sinon.
  - `vt-calendar` : scoping par rôle, choix de date `vt_planifie` → repli
    `vt_attribuee`, filtre période.
- **Frontend** (vitest/jsdom) :
  - `RdvCalendar` : une VT (`source: 'vt'`) est rendue comme évènement distinct.
  - `realtime` : `notification:new` ne notifie pas si `userId` ≠ courant.

## Hors périmètre (YAGNI)

- Routage WebSocket par room/authentification socket (filtrage front suffit).
- Notifications email/SMS (Lot 2).
- Rappel automatique J-1 avant la VT (cron) — non demandé.
- Heure réelle de VT (la VT reste date-only ; affichage 08:00 conventionnel).

## Découpage en commits (contrainte repo : scoped fichier par fichier, WIP concurrent)

Backend et frontend sont **deux repos git séparés**. Commits indépendants et
scopés, dans l'ordre :

1. Backend : module notifications (service + controller + module + DTOs + specs)
   + enregistrement `app.module.ts`.
2. Backend : déclencheur `vt_assigned` (`clients.service.ts` + spec).
3. Backend : déclencheur `vt_date_changed` (`substeps.service.ts` + spec).
4. Backend : endpoint `GET /clients/vt-calendar` (controller/service + spec).
5. Frontend : hooks/api/types (`useNotifications`, `useVtCalendar`).
6. Frontend : calendrier VT (`RdvCalendar.tsx` + test).
7. Frontend : intégration Rappels (`Notifications.tsx`).
8. Frontend : ciblage temps réel (`realtime.ts` + test).
