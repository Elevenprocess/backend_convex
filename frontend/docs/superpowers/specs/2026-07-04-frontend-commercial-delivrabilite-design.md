# Frontend commercial & délivrabilité — accueil comme centre de gravité

**Date** : 2026-07-04
**Objectif** : rendre la prise en main de VELORA évidente pour les rôles `commercial` et `delivrabilite` (contexte : onboarding de nouveaux arrivants). L'accueil de chaque rôle devient son poste de pilotage quotidien ; le guidage est intégré dans les écrans (états vides, popovers), pas en tour guidé séparé.

**Approche retenue** : « Accueil centre de gravité », 2 lots livrables séparément. Pas de refonte des écrans profonds (Suivi, fiche client) ni de la navigation. Aucune modification de routes, de guards ni de permissions backend.

---

## Lot 1 — Commercial : « Mon espace »

Fichier principal : `src/pages/Overview.tsx` → `OverviewCommercialSolo` (actuellement : 1 KPI « RDV honorés » + liste des débriefs à remplir).

La vue passe à 4 blocs, pilotés par le `DateRangePicker` existant (défaut « ce mois-ci ») :

### 1.1 Mes stats (rangée de KPIs)
- Source : `GET /analytics/commercials/:id` (existant, auto-scopé : un commercial ne voit que ses stats — `analytics.controller.ts:81-90`).
- KPIs : RDV honorés, ventes signées, taux de closing, CA signé.
- Composants : réutiliser `MagicKpi` / `AirKpi` existants.

### 1.2 Mes prochains RDV (liste chronologique)
- Source : `GET /rdv` (existant, auto-scopé : `rdv.service.ts:302-303` filtre sur `rdv.commercialId = currentUser.id`), filtré côté client sur les RDV à venir.
- Affichage : date/heure, nom du client, secteur, statut. Clic → fiche client (`leadPaths.ts`).
- Décision : **liste, pas de mini-agenda**. Le guard `RdvCalendarGuard` reste en place ; le commercial n'accède toujours pas au calendrier global `/rdv`.

### 1.3 Débriefs à remplir
- Bloc existant (`CommercialDebriefsToFill`) conservé tel quel.
- Ajout d'un état vide explicite (« Rien à remplir — vos débriefs sont à jour »).

### 1.4 Mes leads en cours
- Source : hook clients/leads existant, déjà scopé sur `assignedToId` pour un commercial (RootLayout).
- Affichage : lead, statut, dernière activité. Clic → fiche.
- C'est un raccourci depuis l'accueil ; la page `/client` reste inchangée.

### 1.5 Guidage
- Chaque bloc a un état vide qui explique à quoi il sert.
- `/suivi` (« Mes dossiers ») : pour le rôle `commercial`, badge « Lecture seule » + une phrase d'explication en tête de page (le suivi est piloté par l'équipe délivrabilité).

---

## Lot 2 — Délivrabilité : file de travail + guide des phases

Fichier principal : `src/pages/Overview.tsx` → `OverviewSuivi` (actuellement : tunnel 6 phases, puis 5 KPIs, puis « À traiter en priorité » top 6 + « Dernières livraisons »).

### 2.1 File de travail « À traiter en priorité » (passe en tête)
- N'est plus limitée à 6 items : affiche tous les dossiers nécessitant une action.
- Groupée / filtrable par nature : Bloqués, Retards SLA, Docs manquants (filtres rapides en tête de liste).
- Chaque item affiche la **prochaine action attendue** en toutes lettres (ex. « Planifier la VT », « Relancer le Consuel », « Compléter : Arrêté municipal ») — libellés dérivés du guide des phases (2.2) et des données déjà présentes dans `buildDeliveryPipeline` (`lib/deliveryOverview.ts`).
- Clic → `/suivi/:id/fiche` (comportement actuel conservé).
- Tri par urgence (bloqués d'abord, puis retard décroissant).

### 2.2 Guide des phases (`src/lib/phase-guide.ts`, nouveau)
- Config statique frontend décrivant chaque phase (VT, DP, RACCO, Installation, Consuel, MES) : objectif en une phrase, documents attendus, action qui clôture la phase, phase suivante. Note « dépôt seul » : le flag `depositOnly` est porté par les sous-étapes (il simplifie leur pop-up), les 6 phases restent présentes sur tous les dossiers — le guide mentionne simplement le cas dépôt-seul dans son texte, sans filtrage par dossier.
- Les tableaux d'ordre de phase existants (dont `DELIVERY_PHASES`) restent la source de vérité pour l'ordre ; le guide n'ajoute que du texte.
- Consommé par :
  - une icône « ? » sur chaque phase du tunnel de l'overview (popover),
  - le même popover sur les en-têtes de colonnes du `WorkflowBoard` dans `/suivi`,
  - les libellés « prochaine action » de la file de travail (2.1).

### 2.3 Réorganisation de l'overview
- Nouvel ordre : file de travail (2.1) → tunnel 6 phases (inchangé, clic → `/suivi?phase=X`) → KPIs compactés en une rangée discrète → « Dernières livraisons » en pied.

### 2.4 Hors périmètre (décidé)
- **Pas de renommage sidebar** (« Calendrier RDV », « Planning », « Dossiers » restent tels quels).
- La fiabilisation profonde de la saisie (formulaires guidés dans la fiche) est reportée à un éventuel lot 3.

---

## Contraintes transverses

- **Repo partagé** : des fichiers WIP tiers peuvent être présents (ex. `src/lib/api.ts` modifié, `NewClientModal.*` non suivis au moment de la rédaction). Commits avec chemins explicites uniquement, jamais `git add -A`.
- **Validation** : `tsc -b` sur le frontend (pas `tsc --noEmit`), conformément au build Render.
- **Aucune migration ni changement backend** : les endpoints nécessaires existent déjà.
- **Perf** : réutiliser les hooks/caches existants (stale-while-refetch) ; pas de nouveau polling.

## Critères de succès

- Un commercial qui se connecte voit sur un seul écran : ses stats, ses prochains RDV, ses débriefs à remplir, ses leads en cours — sans navigation.
- Un délivrabilité qui se connecte sait immédiatement quels dossiers traiter et quelle est la prochaine action pour chacun.
- Un nouveau comprend chaque phase du workflow sans demander (popovers « ? »).
- `tsc -b` passe ; aucun changement de comportement pour les autres rôles (admin, setter, commercial_lead, responsable_technique, back_office, finances).

## Tests

- Vérification par rôle en « view as » / impersonation (`lib/auth.ts`) : commercial, delivrabilite, et non-régression sur admin + commercial_lead.
- États vides : nouveau commercial sans RDV ni leads → chaque bloc affiche son explication.
- Cas « dépôt seul » : le texte du guide mentionne la simplification dépôt-seul (RACCO) ; aucun filtrage de phase par dossier (les 6 phases existent sur tous les dossiers).
