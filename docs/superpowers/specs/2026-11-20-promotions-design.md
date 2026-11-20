# Promotions (onglet « Promotion » de la page Leads) — conception

Date : 2026-11-20 · Statut : validée en discussion (v2 : anciens leads + RDV bureau), à relire avant plan
Premier usage : Black Friday 2026 (semaine du 23/11).

## 1. But

L'admin crée un événement commercial limité dans le temps (ex. « Black Friday »).
Deux familles de leads y sont rattachées :

- les **nouveaux leads** (et tout lead) qui reçoivent un **tag GHL** précis pendant
  l'événement ;
- des **anciens leads** que l'admin cible **par statut**, pour les rappeler et les
  inviter au bureau d'Electro Concept OI.

Ces leads sont regroupés dans un onglet **Promotion** de la page `/#/leads`. Les
setters les y appellent avec l'offre sous les yeux, et l'admin y suit les résultats.
Pendant la promo, la qualification propose un second type de RDV : **au bureau**,
sur un calendrier GHL dédié (vendredi et samedi).

### Décisions prises (20/11)

| Question | Décision |
|---|---|
| À quoi sert la promo ? | Rattacher et suivre les nouveaux leads taggés **et** rappeler des anciens leads pour les inviter au bureau. |
| Rattachement des nouveaux leads | Par **tag GHL** (ex. `black friday`), posé par un **workflow GHL** (côté Erwan). VELORA ne fait que lire. |
| Rattachement des anciens leads | L'**admin choisit par statut** (et une période d'arrivée facultative) à la création de la promo. |
| Qui voit l'onglet ? | **Admin** (création, gestion, chiffres) **et setters** (liste à appeler + offre). |
| Doublon avec les onglets habituels ? | **Non** : pendant la promo, ses leads ne sont **que** dans l'onglet Promotion. Après la fin, ils reviennent dans leur onglet de statut normal. |
| Calendrier du RDV bureau | Calendrier GHL **« Black Friday »** (`SyL9dfmEXNYeigIOvd9R`), choisi dans la promo. |
| Pour quels leads le RDV bureau ? | **Tous les leads** tant qu'une promo avec calendrier bureau est en cours. |
| Qui reçoit au bureau ? | Les **membres du calendrier GHL**. GHL répartit les RDV, VELORA reprend le commercial attribué. |

### Hors périmètre

- Remise appliquée automatiquement aux devis.
- Plusieurs promotions en même temps sur un même lead (un lead = au plus une promo).
- Ajout ou retrait de leads un par un à la main (le ciblage se fait par statut ou par tag).
- Création ou modification des workflows et calendriers GHL depuis VELORA (réglés à la main dans GHL).

## 2. Constat technique

- Les webhooks GHL portent déjà les tags du contact, dans `tags` : une chaîne
  séparée par des virgules (ex. `"simulateur,présentiel"`,
  `"brasseur d'air,rlt,simulateur,présentiel"`). On l'a vérifié sur les
  `webhookEvents` récents.
- **VELORA ne stocke aucun tag aujourd'hui.**
- Entrées GHL existantes :
  - `POST /webhooks/elevenprocess` → `contact.created` → `webhooks.createLeadFromWebhook`.
    Si le contact existe déjà, l'appel est traité comme une **re-soumission** :
    `resubmittedAt` est posé, et un lead perdu ou sans réponse repasse « à rappeler ».
    Cette entrée **ne convient pas** à un simple ajout de tag.
  - `POST /webhooks/ghl/opportunity` → `applyGhlStageChange`.
- Le tag peut être posé par le workflow GHL **après** la création du contact. On ne
  peut donc pas compter uniquement sur `contact.created`.
- **Qualification** (`frontend/src/components/SplitPanel.tsx`, `NotesTab`) : étapes
  `eligibility` → `qualification` → `secteur` → `rdv` → `confirmation` → `done`.
  `validateRdv()` appelle `createGhlAppointment` avec le `calendarId` du secteur
  (env `GHL_SECTOR_CALENDARS`, quatre calendriers round-robin) et `locationType: 'domicile'`.
- `RDV_LOCATIONS = ["domicile", "agence", "visio"]` (`convex/model/enums.ts`) :
  **`agence` existe déjà** mais n'est jamais utilisé. On l'emploie pour le RDV bureau.
- Calendrier GHL « Black Friday » (`SyL9dfmEXNYeigIOvd9R`), état au 20/11 :
  - type `event`, **désactivé**, **aucun membre** ;
  - ouvert **vendredi seulement**, de 8 h à 17 h ;
  - créneaux de 30 min, intervalle de 10 min, 1 RDV par créneau, confirmation automatique.

## 3. Choix d'architecture

Le rattachement est **enregistré sur le lead** (`promotionId`). On ne le recalcule
pas à l'affichage. Les listes peuvent ainsi exclure ou inclure les leads de promo
par index, sans recoder la règle dans chaque requête.

## 4. Données (convex/schema.ts)

### Nouvelle table `promotions`

| Champ | Type | Note |
|---|---|---|
| `name` | string | « Black Friday 2026 » |
| `tag` | optional string | Tel que saisi par l'admin (« Black Friday ») |
| `tagKey` | optional string | Forme normalisée : minuscules, sans accents, espaces réduits |
| `startAt` | number (ms) | Début, minuit heure de la Réunion du jour choisi |
| `endAt` | number (ms) | Fin, 23:59:59.999 heure de la Réunion du jour choisi |
| `offer` | optional string | Texte de l'offre affiché aux setters |
| `pitch` | optional string | Argumentaire et script d'appel |
| `officeCalendarId` | optional string | Calendrier GHL du RDV bureau (Black Friday : `SyL9dfmEXNYeigIOvd9R`) |
| `officeAddress` | optional string | Adresse du bureau, reprise dans le RDV et le message de transfert |
| `legacyStatuses` | optional array(leadStatus) | Statuts des anciens leads ciblés |
| `legacyArrivedFrom` | optional number (ms) | Borne basse facultative de la date d'arrivée des anciens leads |
| `legacyArrivedTo` | optional number (ms) | Borne haute facultative |
| `archived` | boolean | Masque la promo sans la supprimer |
| `createdBy` | id("users") | |
| `createdAt` | number | |

Index : `by_tagKey` (`tagKey`) et `by_endAt` (`endAt`).

Une promo a au moins un tag **ou** au moins un statut ciblé.

### Champs ajoutés sur `leads`

| Champ | Type | Note |
|---|---|---|
| `ghlTags` | optional array(string) | Derniers tags reçus de GHL (forme d'origine) |
| `promotionId` | optional id("promotions") | Promo de rattachement, jamais effacé automatiquement |
| `promotionJoinedAt` | optional number | Date du rattachement |
| `promotionSource` | optional `"tag" \| "statut"` | Origine : tag GHL (nouveaux) ou ciblage par statut (anciens) |

Index : `by_promotion` (`promotionId`).

### Statut d'une promo (calculé, pas stocké)

- `a_venir` : maintenant < `startAt`
- `en_cours` : `startAt` ≤ maintenant ≤ `endAt` et non archivée
- `terminee` : maintenant > `endAt`, ou promo archivée

Contraintes, vérifiées à la création et à la modification :
- **deux promotions non archivées ne peuvent pas avoir le même `tagKey` sur des
  périodes qui se chevauchent** ;
- **au plus une promo `en_cours` avec `officeCalendarId` à un instant donné**, pour
  que la qualification n'ait qu'un seul calendrier bureau à proposer.

## 5. Rattachement (backend)

### 5.1 Module pur `convex/model/promotions.ts`

- `normalizeTag(s)` : minuscules, suppression des accents (NFD), espaces réduits, trim.
- `parseGhlTags(raw)` : accepte une chaîne séparée par des virgules ou un tableau ;
  renvoie un tableau dédoublonné, sans les vides.
- `promotionStatus(promo, now)` : `a_venir`, `en_cours` ou `terminee`.
- `matchPromotion(tags, promos, now)` : la promo `en_cours` dont le `tagKey` est dans
  les tags. Si plusieurs correspondent (cas exclu par la contrainte), on prend celle
  qui a commencé le plus tard.
- `isLegacyEligible(lead, promo, ctx)` : vrai si le statut du lead est dans
  `legacyStatuses`, si la date d'arrivée est dans les bornes facultatives, et si le
  lead n'est pas exclu (§5.4).

### 5.2 Mutation interne `promotions.applyLeadTags({ leadId, tags, at })`

1. Écrit `ghlTags` sur le lead.
2. Si le lead n'a pas encore de `promotionId` et que `matchPromotion(tags, …, at)`
   renvoie une promo : pose `promotionId`, `promotionJoinedAt` et
   `promotionSource: "tag"`, puis écrit un journal d'activité `lead.promotion.joined`.
3. Ne retire jamais un rattachement existant. Si le tag disparaît dans GHL, le lead
   reste dans la promo : c'est l'historique commercial.
4. Idempotente : la rejouer ne change rien.

`at` = moment de réception du webhook. **Tout lead, nouveau ou ancien, qui reçoit le
tag pendant la promo y est rattaché.** Le ciblage des anciens leads se fait alors
indifféremment dans GHL (tag) ou dans VELORA (statut, §5.4).

### 5.3 Points d'appel (tags)

- `createLeadFromWebhook` (nouveau lead et re-soumission) : lit `contact.tags` et
  appelle la logique de 5.2 dans la même transaction.
- `applyGhlStageChange` : si le payload contient `tags`, met à jour `ghlTags` et
  tente le rattachement. Un webhook d'opportunité qui arrive après la pose du tag
  rattrape donc le lead.
- **Nouvelle route `POST /webhooks/ghl/tags`** : protégée par le même secret
  (`checkWebhookSecret`), payload `{ contact_id, tags }`. Elle est prévue pour le
  workflow GHL Black Friday : action Webhook placée *après* l'action « Ajouter le tag ».
  Elle trouve le lead avec `findLeadByGhlContact` (les deux familles d'identifiants,
  `externalId` puis `ghlContactId`), enregistre l'événement dans `webhookEvents`
  (`contact.tags`) et appelle 5.2. Si le lead est introuvable, elle répond 200 avec
  `{ matched: false }` : le contact sera traité à son `contact.created`.

### 5.4 Anciens leads par statut

- `promotions.previewLegacy({ promotionId })` (query admin) : nombre de leads
  éligibles et répartition par statut. Elle s'affiche dans le formulaire avant
  validation.
- `promotions.attachLegacy({ promotionId })` (action admin, par lots de 200) : pose
  `promotionId`, `promotionJoinedAt` et `promotionSource: "statut"` sur les leads
  éligibles. Elle journalise `lead.promotion.joined` et renvoie
  `{ scanned, attached, skipped }`. Idempotente.
- **Exclus d'office** : leads supprimés (soft-delete), `signe`, déjà rattachés à une
  promo, ou ayant un RDV **à venir** (statut RDV non annulé, `scheduledAt` > maintenant).
- Autorisé seulement si la promo est `a_venir` ou `en_cours`.
- Le rattachement par statut ne change **pas** le statut du lead. Il ne fait que le
  déplacer dans l'onglet Promotion, le temps de la promo.

### 5.5 Rattrapage des tags `promotions.backfill({ promotionId })` (admin)

Action par lots qui rejoue les `webhookEvents` GHL reçus depuis `startAt`
(`contact.created`, opportunités et `contact.tags`) : extraction des tags, puis 5.2.
Utile si la promo est créée après l'arrivée des premiers leads taggés.
Idempotente. Elle renvoie `{ scanned, attached }`.

## 6. RDV au bureau

### 6.1 Backend

- `promotions.active` renvoie aussi `officeCalendarId` et `officeAddress` de la promo
  `en_cours` qui en a un.
- `createGhlAppointment` (`convex/ghlAppointments.ts`) accepte déjà `calendarId` et
  `locationType`. Pour un RDV bureau :
  - `calendarId = officeCalendarId` ; `sector` optionnel (pas de secteur) ;
  - `locationType: "agence"` ; adresse du RDV = `officeAddress`, pas celle du client ;
  - on vérifie côté serveur que `calendarId` est bien le calendrier bureau d'une
    promo `en_cours`. Sinon le RDV est refusé (pas de calendrier arbitraire).
- Lecture des créneaux libres : même requête que pour les secteurs (créneaux libres
  GHL d'un calendrier et d'une date), appelée avec `officeCalendarId`.
- Commercial du RDV : GHL l'attribue parmi les membres du calendrier. VELORA le
  reprend via la synchronisation existante des RDV GHL (assignedUserId → ghlUserId →
  user), comme pour les secteurs.
- Le RDV bureau garde le lien `promotionId` du lead s'il en a un. Pour un lead hors
  promo qui prend un RDV bureau, on enregistre `promotionId` **sur le RDV**
  (optional, nouveau champ `rdv.promotionId`), pour compter tous les RDV bureau de
  la promo.

### 6.2 Barre latérale (SplitPanel.tsx, `NotesTab`)

- Étape `qualification` : si `promotions.active` renvoie un calendrier bureau,
  **pour tous les leads**, deux choix s'affichent l'un sous l'autre :
  1. **Qualifié – RDV à domicile** : parcours actuel (`secteur` → `rdv` → `confirmation`).
  2. **Qualifié – RDV au bureau** (juste en dessous) : pas d'étape secteur. On passe
     directement à l'étape `rdv` en **mode bureau**, puis à `confirmation`.
- Mode bureau de l'étape `rdv` :
  - en-tête « Bureau Electro Concept OI · <nom de la promo> » à la place du secteur ;
  - même `InlineRdvAgenda`, alimenté par les créneaux libres du calendrier bureau ;
  - les jours proposés sont ceux que GHL ouvre (vendredi et samedi une fois réglés) ;
  - si la date choisie n'a aucun créneau, le message invite à prendre un vendredi
    ou un samedi.
- Étape `confirmation` : le résumé indique **« RDV au bureau »** et l'adresse du
  bureau. Le message de transfert (`formatRdvTransferNote`) porte « RDV BUREAU ».
- Hors promo avec calendrier bureau, seul le choix 1 apparaît : le parcours actuel
  est inchangé.
- La variable interne `setterStatus` garde `qualifie`. Le choix domicile ou bureau
  est un nouvel état `rdvMode: 'domicile' | 'bureau'`.

### 6.3 Affichage

Badge **« Bureau »** sur les RDV `locationType: "agence"`, aux endroits suivants :
- agenda RDV (`pages/rdv`) ;
- carte RDV de la fiche lead (`RdvInfoCard`) ;
- vue commerciale (`ClientsList`).

## 7. API Convex (convex/promotions.ts)

| Fonction | Rôle | Accès |
|---|---|---|
| `list` | Toutes les promos, avec leur statut calculé et les compteurs | admin |
| `active` | Promos `en_cours` (nom, dates, offre, argumentaire, calendrier et adresse du bureau) | tout utilisateur connecté |
| `create` / `update` | Contrôles : nom requis, tag ou statut ciblé requis, `startAt` < `endAt`, contraintes de §4 | admin |
| `archive` | Pose `archived: true` | admin |
| `previewLegacy` / `attachLegacy` | Voir §5.4 | admin |
| `backfill` | Voir §5.5 | admin |
| `leads({ promotionId, source?, paginationOpts })` | Leads rattachés (index `by_promotion`), filtre facultatif `tag` ou `statut`, mêmes champs enrichis que la liste actuelle | admin ; setter filtré sur ses leads, comme la liste setter actuelle |
| `stats({ promotionId })` | Voir ci-dessous | admin |

Contenu de `stats`, séparé en **Nouveaux (tag)** et **Anciens (statut)** :
- leads ;
- joints (au moins un appel abouti) ;
- RDV à domicile ;
- RDV au bureau ;
- qualifiés ;
- signés.

Les RDV bureau pris par des leads hors promo sont comptés à part
(`rdv.promotionId` sans `lead.promotionId`). Les définitions de joint, RDV, qualifié
et signé réutilisent celles de `analytics.ts`, pour que les chiffres concordent
avec le tableau de bord.

## 8. Interface de l'onglet (frontend/src/pages/leads/LeadsList.tsx)

### 8.1 Setter (`LeadsSetter`)

- Nouvel onglet **Promotion** dans la barre des statuts (`LeadsRail` /
  `FilterPill`), avec le compteur des leads de la promo.
- **Visible uniquement s'il y a une promo `en_cours`.**
- En haut de l'onglet : bandeau avec le nom, les dates (« du 23 au 29 nov. »),
  l'offre, l'argumentaire (dépliable) et, s'il y en a, « RDV au bureau possibles le
  vendredi et le samedi ».
- Filtre **Tous / Nouveaux / Anciens** (`promotionSource`).
- En dessous : le même tableau et les mêmes actions que les autres onglets (appel,
  rappel, statut, fiche latérale avec les deux qualifications).
- **Exclusion** : dans `filterSetterLeadsByStatus` et dans les compteurs des autres
  onglets, les leads dont `promotionId` pointe vers une promo `en_cours` sont retirés.
  Quand la promo est terminée, ils réapparaissent naturellement dans leur onglet de
  statut normal.
- Badge au nom de la promo (« Black Friday ») sur la ligne d'un lead rattaché à une
  promo terminée, pour garder l'historique.

### 8.2 Admin (`LeadsAdmin`)

- Onglet **Promotion** dans la vue admin.
- Bouton **« Nouvelle promotion »** → fenêtre avec :
  - **Général** : nom, dates de début et de fin, offre, argumentaire.
  - **Nouveaux leads (tag GHL)** : tag. Aide : « Le tag doit être posé par un
    workflow GHL. Ajoutez ensuite une action Webhook vers `/webhooks/ghl/tags`. »
  - **Anciens leads** : cases à cocher par statut (Perdu, Pas qualifié, Sans réponse,
    Relance long terme, À rappeler…), période d'arrivée facultative, aperçu du nombre
    (`previewLegacy`) et bouton **« Rattacher ces leads »** (`attachLegacy`).
  - **RDV au bureau** : calendrier GHL (liste des calendriers GHL de la location,
    pré-rempli « Black Friday ») et adresse du bureau.
- Liste des promos regroupées en En cours, À venir et Terminées. Chaque carte
  affiche les dates, le tag, les statuts ciblés, les chiffres (`stats`) et les
  actions Modifier, Rattacher les anciens, Rattraper les tags et Archiver.
- Clic sur une promo → tableau de ses leads (`promotions.leads`, filtre Nouveaux /
  Anciens).
- **Exclusion** également dans la liste admin principale tant que la promo est
  `en_cours` : ajouter un filtre serveur « hors promo en cours » à la requête paginée
  utilisée par `LeadsAdmin`, pour garder la même règle que chez les setters.
  La recherche par nom ou téléphone reste globale et retrouve aussi les leads de promo.

### 8.3 Dates

Toutes les dates de promo sont saisies et affichées en **heure de la Réunion**.
La conversion jour → millisecondes réutilise la logique de
`convex/model/analyticsRange.ts`, pour éviter le décalage d'un jour déjà rencontré
depuis un navigateur en UTC+3.

## 9. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Tag posé après `contact.created` | Rattrapé par `/webhooks/ghl/tags` ou par le prochain webhook d'opportunité |
| Promo créée après l'arrivée des leads taggés | Bouton Rattraper les tags |
| Ancien lead taggé pendant la promo | Rattaché (`promotionSource: "tag"`) |
| Ancien lead ciblé avec un RDV à venir, signé ou déjà dans une promo | Ignoré (compté dans `skipped`) |
| « Rattacher ces leads » relancé | Aucun doublon, `attached` à 0 si rien de nouveau |
| Tag retiré dans GHL | Le rattachement reste |
| Promo archivée en cours de route | Ses leads repassent aussitôt dans les onglets habituels, avec le badge. Le choix RDV bureau disparaît |
| Tag avec majuscules ou accents différents | Reconnu (`normalizeTag`) |
| Calendrier bureau désactivé ou sans membre dans GHL | Aucun créneau renvoyé. Message : « Calendrier bureau indisponible dans GHL, prévenir l'admin » |
| Aucun créneau le jour choisi | Message invitant à choisir un vendredi ou un samedi |
| Créneau pris entre l'affichage et la validation | Erreur GHL remontée, créneaux rechargés (comportement actuel des secteurs) |
| RDV bureau demandé avec un calendrier qui n'est pas celui d'une promo en cours | Refusé côté serveur |
| Webhook tags sans `contact_id` ou JSON invalide | 400, événement non traité |
| Secret absent ou faux | 403 |

## 10. Tests (vitest + convex-test, comme les `*.test.ts` existants)

- `promotions_model.test.ts` :
  - `normalizeTag`, `parseGhlTags` (chaîne, tableau, vides, doublons) ;
  - `promotionStatus` aux bornes de la période en heure de la Réunion ;
  - `matchPromotion`, `isLegacyEligible` (statuts, bornes d'arrivée, exclusions).
- `promotions.test.ts` :
  - création refusée en cas de chevauchement sur le même tag, de deux calendriers
    bureau en cours en même temps, si début ≥ fin, ou sans tag ni statut ;
  - rattachement au `contact.created` avec le tag ;
  - rattachement tardif via `/webhooks/ghl/tags` ;
  - ancien lead taggé pendant la promo : rattaché ; tag hors période : non ;
  - `previewLegacy` et `attachLegacy` : bons statuts, exclusions (signé, RDV à venir,
    autre promo, supprimé), statut du lead inchangé, idempotence ;
  - idempotence de `applyLeadTags` et du rattrapage ;
  - RDV bureau : `locationType: "agence"`, calendrier bureau, `rdv.promotionId` posé ;
    refus d'un calendrier qui n'est pas celui de la promo en cours ;
  - `stats` : séparation Nouveaux / Anciens et domicile / bureau, cohérente avec un
    jeu de leads, appels et RDV ;
  - droits : un setter ne peut ni créer, ni rattacher, ni rattraper, et ne voit que
    ses leads.
- Front :
  - exclusion dans `filterSetterLeadsByStatus` (promo en cours exclue, promo terminée
    réintégrée) ;
  - qualification : le choix « RDV au bureau » n'apparaît que si une promo avec
    calendrier bureau est en cours, et il saute l'étape secteur.
- Vérification manuelle avant la mise en service, sur un contact de test uniquement :
  - créer une promo de test (tag `zz-test-promo`) ;
  - poser le tag et vérifier que le lead apparaît dans l'onglet ;
  - prendre un RDV bureau, vérifier qu'il arrive dans le calendrier GHL et qu'il
    revient dans VELORA avec le commercial attribué ;
  - annuler le RDV de test et supprimer la promo de test.

## 11. Mise en service

1. Déployer Convex (`spotted-horse-257`) et pousser le front sur `main` (Vercel).
2. **Dans GHL (Erwan)**, calendrier « Black Friday » (`SyL9dfmEXNYeigIOvd9R`) :
   - l'**activer** ;
   - **ajouter le samedi** aux heures d'ouverture (il est ouvert le vendredi seulement, de 8 h à 17 h) ;
   - **y ajouter les commerciaux** qui tiendront le bureau (aucun membre aujourd'hui).
3. **Dans GHL (Erwan)**, workflow Black Friday : ajouter une action Webhook vers
   `https://spotted-horse-257.eu-west-1.convex.site/webhooks/ghl/tags`, avec le header
   secret et le corps `{ "contact_id": "{{contact.id}}", "tags": "{{contact.tags}}" }`.
4. L'admin crée « Black Friday 2026 » : tag, dates, offre, calendrier bureau, adresse
   du bureau et statuts des anciens leads. Il vérifie l'aperçu, puis clique sur
   « Rattacher ces leads ».
5. Après les premiers leads taggés, cliquer sur Rattraper les tags une fois par sécurité.

## 12. Points à confirmer avec Erwan

- Nom exact du tag et dates de début et de fin du Black Friday.
- Statuts des anciens leads à inviter (et période d'arrivée éventuelle).
- Adresse exacte du bureau à indiquer au client.
- Réglages du calendrier « Black Friday » (étape 11.2) et action Webhook du workflow (étape 11.3).
