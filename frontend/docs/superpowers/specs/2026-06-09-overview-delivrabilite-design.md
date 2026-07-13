# Refonte Overview Délivrabilité — Design

**Date :** 2026-06-09
**Périmètre :** `OverviewSuivi` dans `src/pages/Overview.tsx` (rôles `delivrabilite`, `back_office`, `technicien`)
**Direction retenue :** A — « Pipeline funnel »

## Contexte

La vue actuelle (`OverviewSuivi`, ~lignes 72-128 d'`Overview.tsx`) est pauvre : elle ne lit que
`useLeads` + `useRdvList` (leads signés), affiche 4 boutons de workflow **statiques** pointant tous
vers `/suivi`, et n'exploite pas du tout les données réelles du workflow de livraison
(`ClientResponse.steps`, `currentPhase`, `blocked`, `missingDocsCount`).

On la remplace **intégralement** par un tableau de bord branché sur la vraie donnée des dossiers,
structuré autour du tunnel des 6 phases de livraison.

Le workflow de livraison comporte 6 phases (`WorkflowPhase`) :
`vt → dp → racco → consuel → installation → mes`
(Visite technique → Déclaration préalable → Raccordement → Consuel → Installation → Mise en service).

## Architecture

- **Routing inchangé** : `Overview()` continue de router `delivrabilite` / `back_office` / `technicien`
  vers `OverviewSuivi`.
- **Source de données** : `useClients()` (porte `steps`, `currentPhase`, `blocked`, `missingDocsCount`,
  `signedAt`). `useRdvList()` conservé **uniquement** pour le CA (jointure par `leadId`).
- **Découpage** : pour ne pas alourdir `Overview.tsx` (déjà ~2300 lignes), la logique de calcul est
  extraite dans un module pur et testable **`src/lib/deliveryOverview.ts`**. `OverviewSuivi` ne contient
  que le JSX + le state de période.

### `src/lib/deliveryOverview.ts` (pur, testé)

```
isStepLate(step: ClientPhaseStep, now: Date): boolean
  // généralise isVtEnRetard (technicienStats.ts) :
  // true si status === 'probleme'
  //   OU (status === 'planifie' ET datePlanifiee parsée < now)

buildDeliveryPipeline(clients: ClientResponse[], range, now): {
  phases: Record<WorkflowPhase, { count: number; late: number; missingDocs: number }>
  activeCount: number          // dossiers de la cohorte hors statusGlobal livré/annulé
  lateCount: number            // dossiers ayant ≥1 step en retard
  missingDocsCount: number     // dossiers avec missingDocsCount > 0
  toDeliverThisWeek: number    // currentPhase ∈ {installation, mes} non livré
}

selectDeliveryPriorities(clients, now): PriorityRow[]
  // tri : blocked d'abord, puis retard le plus ancien (datePlanifiee croissante),
  //       puis missingDocsCount desc

selectRecentDeliveries(clients, range): ClientResponse[]
  // currentPhase === 'mes' avec steps.mes.dateRealisee dans range, tri date desc
```

La **cohorte** = dossiers dont `signedAt` ∈ `range` (période sélectionnée). Tous les compteurs en
dérivent. Le CA en livraison est calculé côté composant en sommant `montantTotal` des RDV dont le
`leadId` correspond à un dossier de la cohorte.

## Layout — les 4 zones

### En-tête + filtre de période
Réutilise `SUIVI_PERIOD_OPTIONS` + `buildSuiviPeriodRange` (`src/lib/suivi.ts`), exactement comme
`OverviewResponsableTechnique`. **Défaut : `this_year`** (un défaut court rendrait le tunnel quasi vide).
Eyebrow « DÉLIVRABILITÉ · PILOTAGE », titre « Pipeline livraison ».

### Zone 1 — Tunnel 6 phases (héros, cliquable)
6 cartes en ligne (avec chevrons `›` entre elles) :
- Label via `PHASE_LABEL`, icône via `PHASE_ICON`.
- Compteur = `phases[phase].count` (dossiers dont `currentPhase === phase`).
- Mini-indicateurs : `N ret.` (rouge) si `late > 0`, `N doc` (orange) si `missingDocs > 0`.
- Clic → `navigate('/suivi?phase=<phase>')`. Si le board ne lit pas encore ce param, la navigation
  vers `/suivi` reste fonctionnelle (param ignoré, pas de régression).

### Zone 2 — KPIs de santé
Ligne de cartes :
- **Dossiers actifs** (`activeCount`)
- **Retards SLA** (`lateCount`, rouge)
- **Docs manquants** (`missingDocsCount`, orange)
- **À livrer cette semaine** (`toDeliverThisWeek`)
- **CA en livraison** (somme RDV joints, format k€)

### Zone 3 — File de priorités
Liste issue de `selectDeliveryPriorities` : avatar (initiales), nom + ville, phase courante,
badge (`Retard J+x` / `doc manquant` / `bloqué`), bouton **Suivi** → `/suivi?lead=<id>`.
Vide → message « Aucun dossier à traiter ».

### Zone 4 — Dernières livraisons
Liste issue de `selectRecentDeliveries` : mises en service récentes, badge « livré ✓ ».
Plus cosmétique — sentiment de progression. Vide → message neutre.

## Réutilisation de l'existant
- `AirKpi`, `CardHead`, `initials`, `fullName`, `fmtCompact`, `fmtKEur` (déjà dans `Overview.tsx`).
- `PHASE_LABEL`, `PHASE_ICON`, `slaGaugeInfo`, `todayIso` (`src/lib/suivi-board.ts`).
- `SUIVI_PERIOD_OPTIONS`, `buildSuiviPeriodRange`, `getDefaultSuiviPeriod` (`src/lib/suivi.ts`).
- Heuristique de retard généralisée depuis `isVtEnRetard` (`src/lib/technicienStats.ts`).

## Données indisponibles — décisions
- **Pas de montant sur `ClientResponse`** → CA dérivé des RDV (`montantTotal`) par jointure `leadId`,
  comme la vue actuelle.
- **Pas de deadline SLA sur `ClientPhaseStep`** (les deadlines vivent sur `SubstepResponse`) →
  le « retard » s'appuie sur l'heuristique de dates (`isStepLate`), pas sur un vrai SLA. Suffisant
  pour un overview ; la granularité SLA fine reste sur le board `/suivi`.

## Tests
`src/lib/deliveryOverview.test.ts` couvre : `isStepLate` (chaque statut + date passée/future),
`buildDeliveryPipeline` (répartition par phase, comptage retards/docs, cohorte par `signedAt`),
`selectDeliveryPriorities` (ordre de tri), `selectRecentDeliveries` (filtre `mes` + range).

## Hors périmètre
- Lecture du param `?phase=` côté board `/suivi` (navigation reste fonctionnelle sans).
- Toute modification backend (on consomme `ClientResponse` tel quel).
- Les autres vues d'`Overview.tsx` (Admin, Commercial, Setter, ResponsableTechnique) sont intactes.
