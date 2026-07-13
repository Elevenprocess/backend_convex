# Fiche client + devis — sections réductibles & réorganisation

Date : 2026-06-03
Périmètre : frontend uniquement (`ECOI_frontend`). Aucun changement backend.

## Problème

La fiche client pleine page (`src/pages/leads/LeadDetail.tsx`) empile de longues
sections (Historique, Débriefs) qui noient l'information ; on veut une vue plus
claire. Par ailleurs le bloc « Créer un projet » occupe la colonne droite avant
« Projets existants ». Enfin, à l'intérieur d'un projet, les cartes de devis
(`DevisCard` dans `src/components/devis/DevisList.tsx`) sont toujours entièrement
dépliées, ce qui est verbeux quand il y a plusieurs devis.

## Objectif

1. Rendre des sections **réductibles/dépliables** (réduire/développer) sur la fiche
   client, état mémorisé.
2. **Déplacer** le bloc « Créer un projet » en bas de la colonne gauche (sous
   l'info client + Attribution).
3. Rendre chaque **carte devis** réductible (résumé + déploiement), état mémorisé.

Hors périmètre : la variante sidebar `CommercialLeadPanel` (mêmes sections) n'est
PAS modifiée ; aucun redesign visuel (on conserve `glass-card` / le style « stone »
des devis) ; aucun changement backend.

## Décisions validées

- Bloc « Créer un projet » → **bas de la colonne gauche**.
- Devis → repli de **la carte entière** (résumé N°/client/TTC/statut + footer
  visibles).
- Fiche : **toutes** les sections concernées réductibles ; Historique & Débriefs
  **repliées par défaut**, Créer un projet & Projets existants **dépliées par défaut**.
- État replié/déplié **mémorisé** dans `localStorage`.

## Architecture

### 1. `src/lib/useCollapsibleState.ts` (nouveau)

Primitive de persistance, à responsabilité unique. Aucune dépendance UI.

```ts
function useCollapsibleState(
  storageKey: string,
  defaultCollapsed: boolean,
): [collapsed: boolean, toggle: () => void]
```

- Clé de stockage effective : `` `ecoi.collapse.${storageKey}` ``.
- Lecture initiale depuis `localStorage` (best-effort `try/catch`, comme le reste
  de l'app) : `'1'` → replié, `'0'` → déplié, absent/illisible → `defaultCollapsed`.
- `toggle()` inverse l'état et écrit `'1'`/`'0'` (best-effort).
- N'est PAS ajouté à `src/lib/hooks.ts` (fichier dans le WIP en cours d'un autre
  travail) : fichier neuf isolé.

### 2. `src/components/CollapsibleSection.tsx` (nouveau)

Composant présentationnel ; s'insère dans les conteneurs (cartes) existants.

```ts
type CollapsibleSectionProps = {
  title: string
  storageKey: string
  defaultCollapsed?: boolean   // défaut false
  right?: React.ReactNode      // ex. badge/compteur, affiché dans l'en-tête
  children: React.ReactNode
}
```

- En-tête = `<button type="button">` pleine largeur, `aria-expanded={!collapsed}`,
  contenant un chevron (`chevron-down` déplié / `chevron-right` replié), le `title`
  (gras), et l'éventuel `right` aligné à droite.
- Corps (`children`) rendu uniquement si **non** replié.
- Utilise `useCollapsibleState(storageKey, defaultCollapsed)`.
- Style « air »/sobre, sans dégradé ; ne fournit PAS le fond de carte (laissé à
  l'appelant, qui garde son `glass-card`).

### 3. `LeadDetail.tsx`

- **Déplacement** : retirer la carte `CreateProjectInline` de la colonne droite
  (`lg:col-span-2`) et la placer en **dernier** dans la colonne gauche
  (`lg:col-span-1`), après l'en-tête client, ATTRIBUTION, et la carte
  « DONNÉES FORMULAIRE / SETTER » si présente.
- **Repli** (sans changer les cartes `glass-card p-6`, on enveloppe leur contenu) :
  - Historique : `CollapsibleSection title="Historique" storageKey="lead.historique"
    defaultCollapsed` → **replié par défaut**.
  - Débriefs : `CollapsibleSection title="Débriefs" storageKey="lead.debriefs"
    defaultCollapsed right={<compteur>}` → **replié par défaut** (le compteur
    existant `N débrief(s)` passe en `right`).
- Dans `CreateProjectInline` (même fichier) :
  - Formulaire de création : `CollapsibleSection title="Créer un projet sur ce
    client" storageKey="lead.createProject"` → **déplié par défaut**.
  - Liste « Projets existants » : `CollapsibleSection title="Projets existants"
    storageKey="lead.existingProjects" right={<compteur>}` → **déplié par défaut**.
- Clés de persistance **globales par type** (pas par lead) : l'état choisi
  s'applique à toutes les fiches.

### 4. `DevisCard` (`src/components/devis/DevisList.tsx`)

- Ajouter `const [collapsed, toggleCollapsed] = useCollapsibleState('devis.' + d.id,
  false)` → **déplié par défaut**, mémorisé **par devis**.
- Nouvelle **barre-résumé toujours visible** en haut du `<li>` (bouton cliquable,
  chevron) : `N° {devisNumber ?? filename} · {nom client} · {TTC formaté} ·
  [badge statut] [badge OCR]`.
- Le **corps complet** existant (HERO + sections Specs/Lignes/Totaux/Échéancier/
  Financement) n'est rendu que si **non** replié.
- **Footer d'actions** (Voir le PDF, etc.) **toujours visible**.
- **Mode édition** : quand `editing` est vrai, le corps est forcé visible et le
  chevron de repli est masqué (on n'édite pas une carte repliée).
- Le cas « scan en cours » (retour anticipé `DevisScanLoader` pour
  `pending`/`processing`) reste inchangé (pas de repli sur cet état).

## Gestion des erreurs / cas limites

- `localStorage` indisponible (mode privé, quota) : `try/catch` ⇒ on retombe sur
  l'état par défaut, l'app continue.
- Devis sans `devisNumber` : la barre-résumé affiche `filename`. TTC manquant : `—`
  (via le `fmtEuro` existant).
- Édition d'un devis replié : ouverture forcée (voir ci-dessus).

## Tests

- `src/lib/useCollapsibleState.test.ts` : (a) renvoie `defaultCollapsed` si rien en
  storage ; (b) `toggle` inverse et persiste (`'1'`/`'0'`) ; (c) relit une valeur
  existante depuis `localStorage`.
- `src/components/CollapsibleSection.test.tsx` : titre visible ; corps masqué si
  `defaultCollapsed` ; clic sur l'en-tête → corps visible ; `aria-expanded` reflète
  l'état ; `right` rendu dans l'en-tête.
- `src/components/devis/DevisList.test.tsx` (étendu) : carte repliée → sections
  masquées et barre-résumé affiche le TTC ; clic → corps ré-affiché ; footer
  toujours présent.
- Réorganisation de `LeadDetail` : couverte par `npm run build` (typecheck) + vérif
  manuelle (un test de page complète serait disproportionné).

Vérification manuelle : ouvrir une fiche client → Historique/Débriefs repliés par
défaut, dépliables ; « Créer un projet » sous l'info client en colonne gauche ;
recharger la page → l'état repli/déploiement est conservé ; dans un projet, replier
une carte devis → ne reste que le résumé + le footer, persistant au rechargement.
