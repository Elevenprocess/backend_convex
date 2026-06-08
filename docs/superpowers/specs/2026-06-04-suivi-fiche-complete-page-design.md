# Page « Fiche complète » du client — Design

**Date :** 2026-06-04
**Périmètre :** Frontend (ECOI_frontend)

## Contexte

La page de suivi d'un client (`src/pages/SuiviDetail.tsx`, route `/suivi/:id`)
affiche une barre latérale (`DossierSidebar`) et un workflow d'installation.
Un composant `src/components/suivi/FicheComplete.tsx` existe déjà sous forme de
**panneau latéral (slide-over)** : déclenché par le bouton « Fiche complète » du
`DossierSidebar`, il agrège les coordonnées du client, l'historique (note setter
+ débriefs) et les fichiers (devis, photos, documents) de tous ses projets.

Ce composant est récent et **non encore commité** (fichier non suivi par git).

## Objectif

Remplacer le panneau slide-over par une **vraie page dédiée** (URL propre,
partageable) qui présente, pour un client :

- À **gauche** : sa **fiche** (identité, coordonnées, données collectées,
  historique global).
- En **zone principale** : ses **dossiers regroupés par projet** — pour chaque
  projet, les éléments créés par les commerciaux : devis, photos, documents,
  débriefs.

## Décisions de design (validées)

1. **Page dédiée** plutôt que panneau slide-over.
2. **Remplacement** : le panneau est supprimé ; le bouton « Fiche complète »
   redirige vers la page.
3. **Fiche client à gauche**, dossiers à droite.
4. **Dossiers groupés par projet** (une section par projet du client), pas par
   type.

## Architecture

### Routing

Ajout dans `src/main.tsx`, sous le même garde `RequireAuth` que les autres
routes de suivi :

```
{ path: '/suivi/:id/fiche', element: <FicheCompletePage /> }
```

Le paramètre `:id` est l'identifiant du **dossier** (même clé que `/suivi/:id`),
construit côté front par `buildDossiers`.

### Page : `src/pages/SuiviFiche.tsx` → `FicheCompletePage`

Responsabilités :

- Reconstruire le `dossier` comme `SuiviDetail` :
  `useLeads({ limit: 500 })` + `useRdvList({ limit: 200 })` + `useUsers()` →
  `buildDossiers(...)` → `.find(d => d.id === id)`.
- Appliquer **le même garde de rôles** que `SuiviDetail` (autorisés : `admin`,
  `delivrabilite`, `responsable_technique`, `back_office`, `technicien` ;
  sinon `Navigate to="/overview"`). Si `:id` absent → `Navigate to="/suivi"`.
- Charger les détails des projets du lead :
  `listProjectsByLead(lead.id)` puis `getProjectDetail(p.id)` pour chacun
  (chaque détail contient `devis`, `debriefs`, `attachments`).
- Gérer les états : chargement, dossier introuvable, erreur de chargement des
  projets.
- Habillage : `AppShell flat` + `Topbar` (eyebrow « FICHE CLIENT », titre = nom
  du client) + fil d'Ariane « ← Retour au dossier » vers `/suivi/:id`.
- Layout deux colonnes (réutilise les classes de layout existantes type
  `suivi-split`/`suivi-main-col` ou un équivalent flex) :
  - gauche : `<FicheClientPanel dossier={dossier} />` (sticky)
  - droite : une `<ProjectDossierSection>` par projet ; si aucun projet, état
    vide « Aucun projet pour ce client ».

### Composant : `FicheClientPanel` (colonne gauche)

Présentationnel, prend `dossier` en prop. Extrait des sections actuelles de
`FicheComplete` :

- **Coordonnées & données** : téléphone, email, adresse, code postal, ville,
  logement, revenu fiscal, source, canal, campagne, setter, commercial, RDV,
  montant, financement, signé le. (Réutilise les sous-composants `Section` /
  `Field`.)
- **Historique global** : note setter (`lead.latestCallComment`) + débriefs
  **non rattachés à un projet** (`projectId === null`, via `useLeadDebriefs`).

### Composant : `ProjectDossierSection` (zone principale, un par projet)

Prend un `ProjectDetailResponse` (et la table des utilisateurs pour résoudre le
nom du commercial). Affiche :

- **En-tête** : `project.name`, badge `status`, date de création
  (`createdAt`), nom du commercial (`commercialId` → users).
- **Devis** : liste, chaque ligne via `DevisRow` (téléchargement PDF).
- **Photos** : `attachments.filter(kind === 'photo')` en grille.
- **Documents** : `attachments.filter(kind !== 'photo')` via `AttachmentRow`.
- **Débriefs** : `project.debriefs` triés par date décroissante (issue, notes,
  objection, date) — même rendu que la carte de débrief actuelle.

Chaque sous-bloc affiche un état vide discret quand il est vide.

### Réutilisation / refactor

`FicheComplete.tsx` est **démantelé** : ses sous-composants présentationnels
(`Section`, `Field`, `Empty`, `DevisRow`, `AttachmentRow`, et la carte de
débrief) sont déplacés vers un module partagé (p. ex. en haut de `SuiviFiche.tsx`
ou un petit fichier `fiche-parts.tsx`) puis consommés par `FicheClientPanel` et
`ProjectDossierSection`. L'habillage slide-over (overlay, `<aside>` fixe, bouton
fermer, handler Échap) est supprimé.

### Suppression du panneau

Dans `src/components/suivi/DossierSidebar.tsx` :

- Retirer l'import `FicheComplete`, l'état `showFiche` et le rendu
  `{showFiche && <FicheComplete .../>}`.
- Le bouton « Fiche complète » devient
  `<Link to={`/suivi/${dossier.id}/fiche`} className="suivi-side-cta">Fiche complète</Link>`.

Le fichier `FicheComplete.tsx` est supprimé une fois ses parties extraites.

## Flux de données

```
FicheCompletePage(:id)
  ├─ useLeads + useRdvList + useUsers → buildDossiers → dossier
  ├─ useLeadDebriefs(lead.id)                → historique global (gauche)
  └─ listProjectsByLead(lead.id)
       └─ getProjectDetail(p.id) [×N]        → {devis, debriefs, attachments}
            → une ProjectDossierSection par projet (droite)
```

## Modèle de données (existant, aucune modif backend)

- `ProjectDetailResponse` = `ProjectResponse` + `devis: Devis[]`,
  `debriefs: DebriefResponse[]`, `attachments: ProjectAttachmentResponse[]`.
- `DebriefResponse.projectId` permet de distinguer débriefs projet vs lead.
- `ProjectAttachmentResponse.kind` ∈ `'photo' | 'document' | 'autre'`.

Aucune route ni schéma backend à modifier.

## Gestion des erreurs / états

- **Dossier introuvable** : message « Dossier introuvable » + lien retour.
- **`:id` absent** : redirection `/suivi`.
- **Rôle non autorisé** : redirection `/overview`.
- **Échec chargement projets** : bandeau d'erreur non bloquant ; la fiche de
  gauche reste affichée.
- **Projet/sous-bloc vide** : états vides discrets (réutilise `Empty`).

## Tests

Test vitest `src/pages/SuiviFiche.test.tsx` (mocks des hooks de données, à la
manière des tests existants type `ClientsList.test.tsx`) :

- Rend le **nom du client** et les **en-têtes de section** par projet quand le
  dossier est trouvé.
- Un **devis** et un **document** apparaissent dans la section du **bon
  projet**.
- Affiche « **Dossier introuvable** » quand l'id ne correspond à aucun dossier.

## Hors périmètre (YAGNI)

- Pas de modification backend.
- Pas d'upload/édition depuis cette page (consultation seule, comme l'actuel).
- Pas de pagination ni de filtres sur les fichiers.
```
