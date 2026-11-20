# Promotions (onglet « Promotion » de la page Leads) — conception

Date : 2026-11-20 · Statut : validée en discussion, à relire avant plan
Premier usage : Black Friday 2026 (semaine du 23/11).

## 1. But

L'admin crée un événement commercial limité dans le temps (ex. « Black Friday »).
Les **nouveaux leads** qui arrivent pendant l'événement avec un **tag GHL** précis
sont rattachés à cette promotion. Ils sont regroupés dans un onglet **Promotion**
de la page `/#/leads`, où les setters les appellent avec l'offre sous les yeux et
où l'admin suit les résultats.

### Décisions prises (20/11)

| Question | Décision |
|---|---|
| À quoi sert la promo ? | Rattacher et suivre les **nouveaux leads** (pas de campagne de rappel d'anciens leads). |
| Comment un lead est rattaché ? | Par **tag GHL** (ex. `black friday`). |
| Qui pose le tag ? | Un **workflow GHL** (déjà prévu côté Erwan / pubs). VELORA ne fait que lire. |
| Qui voit l'onglet ? | **Admin** (création, gestion, chiffres) **et setters** (liste à appeler + offre). |
| Doublon avec les onglets habituels ? | **Non** : pendant la promo, ses leads ne sont **que** dans l'onglet Promotion. Après la fin, ils reviennent dans leur onglet de statut normal. |

### Hors périmètre

- Remise appliquée automatiquement aux devis.
- Plusieurs promotions en même temps sur un même lead (un lead = au plus une promo).
- Campagne de rappel d'anciens leads.
- Création ou modification des workflows GHL depuis VELORA (les workflows GHL ne sont pas modifiables par API).

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

## 3. Choix d'architecture

Le rattachement est **enregistré sur le lead** (`promotionId`). On ne le recalcule
pas à l'affichage. Les listes peuvent ainsi exclure ou inclure les leads de promo
par index, sans recoder la règle des tags dans chaque requête.

## 4. Données (convex/schema.ts)

### Nouvelle table `promotions`

| Champ | Type | Note |
|---|---|---|
| `name` | string | « Black Friday 2026 » |
| `tag` | string | Tel que saisi par l'admin (« Black Friday ») |
| `tagKey` | string | Forme normalisée : minuscules, sans accents, espaces réduits |
| `startAt` | number (ms) | Début, minuit heure de la Réunion du jour choisi |
| `endAt` | number (ms) | Fin, 23:59:59.999 heure de la Réunion du jour choisi |
| `offer` | optional string | Texte de l'offre affiché aux setters |
| `pitch` | optional string | Argumentaire et script d'appel |
| `archived` | boolean | Masque la promo sans la supprimer |
| `createdBy` | id("users") | |
| `createdAt` | number | |

Index : `by_tagKey` (`tagKey`) et `by_endAt` (`endAt`).

### Champs ajoutés sur `leads`

| Champ | Type | Note |
|---|---|---|
| `ghlTags` | optional array(string) | Derniers tags reçus de GHL (forme d'origine) |
| `promotionId` | optional id("promotions") | Promo de rattachement, jamais effacé automatiquement |
| `promotionJoinedAt` | optional number | Date du rattachement |

Index : `by_promotion` (`promotionId`).

### Statut d'une promo (calculé, pas stocké)

- `a_venir` : maintenant < `startAt`
- `en_cours` : `startAt` ≤ maintenant ≤ `endAt` et non archivée
- `terminee` : maintenant > `endAt`, ou promo archivée

Contrainte : **deux promotions non archivées ne peuvent pas avoir le même `tagKey`
sur des périodes qui se chevauchent**. C'est vérifié à la création et à la modification.

## 5. Rattachement (backend)

### 5.1 Module pur `convex/model/promotions.ts`

- `normalizeTag(s)` : minuscules, suppression des accents (NFD), espaces réduits, trim.
- `parseGhlTags(raw)` : accepte une chaîne séparée par des virgules ou un tableau ;
  renvoie un tableau dédoublonné, sans les vides.
- `promotionStatus(promo, now)` : `a_venir`, `en_cours` ou `terminee`.
- `matchPromotion(tags, promos, at)` : la promo non archivée dont le `tagKey` est dans
  les tags et dont la période contient `at`. Si plusieurs correspondent (cas exclu par
  la contrainte ci-dessus), on prend celle qui a commencé le plus tard.

### 5.2 Mutation interne `promotions.applyLeadTags({ leadId, tags, at })`

1. Écrit `ghlTags` sur le lead.
2. Si le lead n'a pas encore de `promotionId` et que `matchPromotion(tags, …, at)`
   renvoie une promo : pose `promotionId` et `promotionJoinedAt`, puis écrit un
   journal d'activité `lead.promotion.joined`.
3. Ne retire jamais un rattachement existant. Si le tag disparaît dans GHL, le lead
   reste dans la promo : c'est l'historique commercial.
4. Idempotente : la rejouer ne change rien.

`at` = date d'arrivée du lead (`createdAt`). Règle : **seul un lead arrivé pendant la
période de la promo est rattaché**. Un ancien lead à qui l'on pose le tag n'entre pas
(la promo concerne les nouveaux leads).

### 5.3 Points d'appel

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

### 5.4 Rattrapage `promotions.backfill({ promotionId })` (admin)

Action par lots qui rejoue les `webhookEvents` GHL de la période de la promo
(`contact.created`, opportunités et `contact.tags`) : extraction des tags, puis 5.2.
Utile si la promo est créée après l'arrivée des premiers leads taggés.
Idempotente. Elle renvoie `{ scanned, attached }`.

## 6. API Convex (convex/promotions.ts)

| Fonction | Rôle | Accès |
|---|---|---|
| `list` | Toutes les promos, avec leur statut calculé et les compteurs | admin |
| `active` | Promos `en_cours` (nom, dates, offre, argumentaire) | tout utilisateur connecté |
| `create` / `update` | Contrôles : nom et tag requis, `startAt` < `endAt`, pas de chevauchement sur le même tag | admin |
| `archive` | Pose `archived: true` | admin |
| `leads({ promotionId, paginationOpts })` | Leads rattachés (index `by_promotion`), mêmes champs enrichis que la liste actuelle | admin ; setter filtré sur ses leads, comme la liste setter actuelle |
| `stats({ promotionId })` | Leads reçus, joints (au moins un appel abouti), RDV pris, qualifiés, signés | admin |
| `backfill` | Voir 5.4 | admin |

Les définitions de « joint », « RDV pris », « qualifié » et « signé » réutilisent
celles de `analytics.ts` (appels réels, RDV, statuts), pour que les chiffres
concordent avec le tableau de bord.

## 7. Interface (frontend/src/pages/leads/LeadsList.tsx)

### 7.1 Setter (`LeadsSetter`)

- Nouvel onglet **Promotion** dans la barre des statuts (`LeadsRail` /
  `FilterPill`), avec le compteur des leads de la promo.
- **Visible uniquement s'il y a une promo `en_cours`.**
- En haut de l'onglet : bandeau avec le nom, les dates (« du 23 au 29 nov. »),
  l'offre et l'argumentaire (dépliable).
- En dessous : le même tableau et les mêmes actions que les autres onglets
  (appel, rappel, statut, fiche latérale).
- **Exclusion** : dans `filterSetterLeadsByStatus` et dans les compteurs des autres
  onglets, les leads dont `promotionId` pointe vers une promo `en_cours` sont retirés.
  Quand la promo est terminée, ils réapparaissent naturellement dans leur onglet de
  statut normal.
- Badge **« Black Friday »** (nom de la promo) sur la ligne d'un lead rattaché à une
  promo terminée, pour garder l'historique.

### 7.2 Admin (`LeadsAdmin`)

- Onglet **Promotion** dans la vue admin.
- Bouton **« Nouvelle promotion »** → fenêtre avec : nom, tag GHL, date de début,
  date de fin, offre, argumentaire. Aide affichée : « Le tag doit être posé par un
  workflow GHL. Ajoutez ensuite une action Webhook vers `/webhooks/ghl/tags`. »
- Liste des promos regroupées en En cours, À venir et Terminées. Chaque carte
  affiche les dates, le tag, les chiffres (section 6, `stats`) et les actions
  Modifier, Rattraper et Archiver.
- Clic sur une promo → tableau de ses leads (`promotions.leads`).
- **Exclusion** également dans la liste admin principale tant que la promo est
  `en_cours` : ajouter un filtre serveur « hors promo en cours » à la requête paginée
  utilisée par `LeadsAdmin`, pour garder la même règle que chez les setters.
  La recherche par nom ou téléphone reste globale et retrouve aussi les leads de promo.

### 7.3 Dates

Toutes les dates de promo sont saisies et affichées en **heure de la Réunion**.
La conversion jour → millisecondes réutilise la logique de
`convex/model/analyticsRange.ts`, pour éviter le décalage d'un jour déjà rencontré
depuis un navigateur en UTC+3.

## 8. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Tag posé après `contact.created` | Rattrapé par `/webhooks/ghl/tags` ou par le prochain webhook d'opportunité |
| Promo créée après l'arrivée des leads | Bouton Rattraper |
| Lead arrivé avant la promo puis taggé | Pas rattaché (§5.2) |
| Tag retiré dans GHL | Le rattachement reste |
| Promo archivée en cours de route | Ses leads repassent aussitôt dans les onglets habituels, avec le badge |
| Tag avec majuscules ou accents différents | Reconnu (`normalizeTag`) |
| Webhook tags sans `contact_id` ou JSON invalide | 400, événement non traité |
| Secret absent ou faux | 403 |

## 9. Tests (vitest + convex-test, comme les `*.test.ts` existants)

- `promotions_model.test.ts` : `normalizeTag`, `parseGhlTags` (chaîne, tableau,
  vides, doublons), `promotionStatus` aux bornes de la période en heure de la
  Réunion, `matchPromotion`.
- `promotions.test.ts` :
  - création refusée en cas de chevauchement sur le même tag, ou si début ≥ fin ;
  - rattachement au `contact.created` avec le tag ;
  - rattachement tardif via `/webhooks/ghl/tags` ;
  - pas de rattachement hors période, ni pour un ancien lead ;
  - idempotence de `applyLeadTags` et du rattrapage (aucun doublon, `attached`
    à 0 au second passage) ;
  - `stats` cohérent avec un jeu de leads, appels et RDV ;
  - droits : un setter ne peut ni créer ni rattraper, et ne voit que ses leads.
- Front : test unitaire de l'exclusion dans `filterSetterLeadsByStatus` (promo en
  cours exclue, promo terminée réintégrée).
- Vérification manuelle avant la mise en service : créer une promo de test avec un
  tag `zz-test-promo`, poser le tag sur un contact de test GHL et vérifier qu'il
  apparaît dans l'onglet. Supprimer ensuite la promo de test.

## 10. Mise en service

1. Déployer Convex (`spotted-horse-257`) et pousser le front sur `main` (Vercel).
2. L'admin crée « Black Friday 2026 » (tag et dates définitifs à fournir par Erwan).
3. Côté GHL (Erwan) : dans le workflow Black Friday, ajouter une action Webhook vers
   `https://spotted-horse-257.eu-west-1.convex.site/webhooks/ghl/tags`, avec le header
   secret et le corps `{ "contact_id": "{{contact.id}}", "tags": "{{contact.tags}}" }`.
4. Après les premiers leads, cliquer sur Rattraper une fois par sécurité.

## 11. Points à confirmer avec Erwan

- Nom exact du tag et dates de début et de fin du Black Friday.
- Ajout de l'action Webhook dans son workflow GHL (étape 10.3).
