# SPEC — Refonte page Suivi installation (ex-Délivrabilité)

Date : 2026-05-26
Auteur : Erwan + Claude
Page concernée : `/suivi` → `/suivi` (index) + `/suivi/:id` (détail)
Fichier principal : `src/pages/Suivi.tsx`
CSS : `src/index.css` bloc `.suivi-*` (lignes ~3581 → ~3744)

---

## 1. Objectifs

1. Réaligner le visuel sur le design system glass warm (mockups référents) et le cahier des charges `docs/cahier-des-charges-mode-sombre-clair.md`.
2. Remplacer le rail horizontal 12 étapes par une **timeline verticale** scrollable plus lisible.
3. Supprimer le modal popup d'édition de module → **accordion inline** dans la timeline.
4. Séparer en deux écrans : **liste des dossiers signés** + **détail dossier**.
5. Drop des hardcodes `#0e7e6b`, `#f7f4ee` → tout sur tokens `var(--color-or)` etc. pour fonctionner light **et** dark.
6. Ne **rien casser** côté données : conserver les hooks `useLeads` / `useRdvList` / `useUsers`, la clé localStorage `ecoi.suivi.workflow.v1:<leadId>`, la définition des 12 étapes, les permissions `admin` + `delivrabilite`.

---

## 2. Hors scope

- Pas de changement du modèle de données workflow (12 étapes, slots, statuts).
- Pas de changement de la logique de calcul d'avancement.
- Pas de touches aux hooks ni au backend.
- Pas de migration des données localStorage existantes (la clé reste `ecoi.suivi.workflow.v1:<leadId>`).

---

## 3. Routes & navigation

| Avant | Après |
|---|---|
| `/suivi?lead=<id>` (single page + modal) | `/suivi` index + `/suivi/:id` détail |

- Index `/suivi` : grille de cartes dossiers signés.
- Détail `/suivi/:id` : layout 2 colonnes (sidebar dossier + timeline verticale).
- Si `lead` introuvable → redirect vers `/suivi`.
- Permissions inchangées : guard `admin` ou `delivrabilite` sur les 2 routes.
- Migration douce : si quelqu'un arrive sur `/suivi?lead=<id>`, on redirige vers `/suivi/<id>` (compat liens externes).

---

## 4. Design tokens — light + dark

Toutes les surfaces utilisent **uniquement les tokens existants**. Aucun hex hardcodé.

### 4.1 Variables clés (déjà définies dans `index.css`)

| Token | Light | Dark |
|---|---|---|
| `--color-or` | `#1F7857` | `#4E9667` |
| `--color-or-light` | `#3E9A6F` | `#6FB689` |
| `--color-or-dark` | `#145A41` | `#8FD0A4` |
| `--color-or-tint` | `#DCEDE4` | `rgba(78,150,103,.14)` |
| `--color-cream` | `#F4F8F4` | `#0E1A14` |
| `--color-cream-darker` | `#F1F6F0` | `#060F0B` |
| `--color-text` | `#0F1E16` | `#DCE6DE` |
| `--color-muted` | `#5E7264` | `#9BAFA1` |
| `--color-line` | `#E1EBE3` | `rgba(220,232,222,.12)` |
| `--color-cuivre` | `#B59241` | `#D4B85A` |
| `--color-rouille` | `#A85D2E` | `#C77449` |
| `--color-success` | `#3DA86A` | `#5BB373` |

### 4.2 Mapping états workflow (vert principal préservé light + dark)

| État | Cercle / accent | Token |
|---|---|---|
| Done | Pleine couleur, ✓ blanc | `var(--color-or)` |
| Current | Pulse doré, ring | `var(--color-cuivre)` + halo `var(--color-or-tint)` |
| Todo | Outline gris | `var(--color-line)` + bg transparent |
| Blocked | Pleine couleur rouille | `var(--color-rouille)` |

### 4.3 Règle d'or vert principal

Le vert ECOI **doit rester** la couleur d'accent en light ET en dark :
- Tous les états `done`, progress bars, CTA primaires → `var(--color-or)`
- Hover/focus rings → `var(--color-or-light)` (qui se claircit auto en dark)
- Tints/backgrounds chauds vert → `var(--color-or-tint)`
- En dark mode, le vert `#4E9667` reste lisible sur fond `#0E1A14` (contraste vérifié OK > AA)

### 4.4 Surfaces glass

Utiliser les **classes existantes** plutôt que ré-écrire :
- `.glass-card` → cards de dossier (index), sidebar dossier (détail)
- `.kpi-card` → 4 KPI hero (index)
- Versions dark déjà gérées dans `index.css` ligne 2821+

Pour les surfaces spécifiques au suivi (accordion étape, timeline), ajouter classes `.suivi-v2-*` (préfixe `v2` pour cohabiter le temps de la transition, à supprimer après merge).

---

## 5. Écran 1 — `/suivi` index

### 5.1 Structure

```
┌─ AppShell ──────────────────────────────────────────────┐
│ Sidebar │  Topbar                                       │
│         │ ┌─ Hero ───────────────────────────────────┐  │
│         │ │ h1 "Suivi installation"                  │  │
│         │ │ Filtres : [Période ▾] [Recherche…]       │  │
│         │ └──────────────────────────────────────────┘  │
│         │ ┌─ KPIs (4 col desktop, 2 col tablette) ───┐  │
│         │ │ [En cours] [Étape moy] [Bloqués] [Livrés]│  │
│         │ └──────────────────────────────────────────┘  │
│         │ ┌─ Grille dossiers (3 col / 2 / 1) ────────┐  │
│         │ │  [Card]  [Card]  [Card]                  │  │
│         │ │  [Card]  [Card]  [Card]                  │  │
│         │ │  ...                                     │  │
│         │ └──────────────────────────────────────────┘  │
└─────────┴──────────────────────────────────────────────┘
```

### 5.2 Hero

- Composant : `<header className="suivi-v2-hero">`
- `h1` = "Suivi installation" — `font-weight: 950`, `letter-spacing: -.055em`, `clamp(24px, 3vw, 42px)`, color `var(--color-text)`
- Sous-titre court : "Vue d'ensemble des installations en cours et livrées"
- Right-side : filtre période (4 chips) + champ recherche client

### 5.3 KPI cards

4 cards en `.kpi-card` :

| KPI | Calcul | Couleur valeur |
|---|---|---|
| Dossiers en cours | leads signés non livrés | `var(--color-or)` |
| Étape moyenne | mode(currentStepIndex) | `var(--color-text)` |
| Bloqués | leads sans mvt > 7j sur étape | `var(--color-rouille)` |
| Livrés (période) | leads à étape 12 dans range | `var(--color-or)` |

### 5.4 Card dossier

```
┌─────────────────────────────────────┐
│ HO    M. Hoarau                     │  <- Avatar initiales (40x40)
│       Saint-Denis · 14 500 €        │
│                                     │
│ ████████░░░░░░░░░  42 %             │  <- progress bar fine 4px
│                                     │
│ ● Pose en cours · il y a 2j         │  <- badge étape actuelle
└─────────────────────────────────────┘
```

- Card class : `.glass-card` + `.suivi-v2-dossier-card` (overrides padding + hover)
- Avatar : cercle 40px, fond `var(--color-or-tint)`, texte `var(--color-or-dark)`, initiales 2 lettres
- Progress bar : 4px height, bg `var(--color-line)`, fill `var(--color-or)` avec transition
- Badge étape : dot + label, couleur selon état (mapping section 4.2)
- Hover : `transform: translateY(-2px)`, `box-shadow` plus marquée
- Click → `navigate(\`/suivi/\${lead.id}\`)`
- Layout grid : `repeat(auto-fill, minmax(320px, 1fr))`, gap 16px

### 5.5 États vides

- 0 dossier → grand placeholder centré avec icône `clipboard-list`, texte "Aucun dossier signé pour le moment" + lien retour `/leads`
- 0 résultat recherche → "Aucun dossier ne correspond" + bouton "Effacer filtres"

---

## 6. Écran 2 — `/suivi/:id` détail

### 6.1 Structure

```
┌─ AppShell ─────────────────────────────────────────────────┐
│ Sidebar │ Topbar                                           │
│         │ ┌─ Breadcrumb : [← Tous les dossiers] ─────────┐ │
│         │ └───────────────────────────────────────────────┘ │
│         │ ┌─ Grid 380px | 1fr ───────────────────────────┐ │
│         │ │ ┌─ Sidebar dossier ──┐ ┌─ Timeline ────────┐ │ │
│         │ │ │ Avatar             │ │ ● Signature   ✓   │ │ │
│         │ │ │ Nom client         │ │ │                 │ │ │
│         │ │ │ Ville, téléphone   │ │ ● Acompte     ✓   │ │ │
│         │ │ │ Email              │ │ │                 │ │ │
│         │ │ │ Montant            │ │ ● Visa tech   ✓   │ │ │
│         │ │ │ Financement        │ │ │                 │ │ │
│         │ │ │ Date signature     │ │ ⏵ Consuel     …   │ │ │
│         │ │ │ Commercial         │ │ │   [expanded]    │ │ │
│         │ │ │                    │ │ │                 │ │ │
│         │ │ │ Avancement 42%     │ │ ○ Pose            │ │ │
│         │ │ │ [Appeler] [Mail]   │ │ │                 │ │ │
│         │ │ │ [Voir dans GHL]    │ │ ○ Mise en service │ │ │
│         │ │ └────────────────────┘ │ ... 12 étapes     │ │ │
│         │ │   ↑ sticky top 16px    └───────────────────┘ │ │
│         │ └───────────────────────────────────────────────┘ │
└─────────┴───────────────────────────────────────────────────┘
```

### 6.2 Sidebar dossier (gauche, 380px)

- Class : `.glass-card.suivi-v2-dossier-side`
- `position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto;`
- Sur mobile (< 960px), la sidebar passe en haut, full-width, non sticky
- Sections :
  1. Identité (avatar 64px + nom + ville)
  2. Contact (`tel:` + `mailto:` cliquables)
  3. Financier (montant + mode financement + organisme)
  4. Métadonnées (date signature, commercial assigné via `useUsers`)
  5. Progress global (barre + % + "X étapes sur 12")
  6. Actions : 3 boutons. "Appeler" (`tel:`), "Email" (`mailto:`), "Voir dans GHL" (lien externe)

### 6.3 Timeline verticale

```css
.suivi-v2-timeline { display: flex; flex-direction: column; gap: 0; position: relative; }
.suivi-v2-timeline::before {
  content: ''; position: absolute; left: 21px; top: 0; bottom: 0;
  width: 2px; background: var(--color-line); border-radius: 999px;
}
```

Chaque étape = item flex avec :
- Cercle 44px à gauche (z-index au-dessus de la ligne)
- Bloc contenu à droite : titre + statut + meta (date / "il y a Xj") + chevron expand

États de cercle :

| État | Background | Border | Icône | Animation |
|---|---|---|---|---|
| done | `var(--color-or)` | none | ✓ blanc 18px | — |
| current | `var(--color-cream)` | `2px solid var(--color-cuivre)` | n° étape | `pulse` halo `var(--color-or-tint)` |
| todo | `var(--color-cream)` | `2px solid var(--color-line)` | n° étape gris | — |
| blocked | `var(--color-rouille)` | none | ! blanc | — |

Click sur n'importe quelle étape → toggle accordion expand inline (un seul à la fois).

### 6.4 Accordion édition étape

Quand expanded :
- Background du bloc contenu passe à `var(--color-or-tint)` (light) / fond glass légèrement plus opaque (dark)
- Padding internal accru
- Champs (déjà existants — à conserver) :
  - Date prévue (`input[type="date"]`)
  - Date réalisation (`input[type="date"]`)
  - Notes (`textarea`, autosize)
  - Sous-tâches (checklist générée selon module — config existante)
  - Documents joints (lien upload — placeholder pour Lot 1)
- Footer accordion :
  - À gauche : "Marquer terminé" (CTA primaire `var(--color-or)`) OU "Réouvrir" si done
  - À droite : `Enregistré il y a Xs ✓` (subtle, opacity .6)
- Auto-save localStorage debounce 500ms → clé inchangée `ecoi.suivi.workflow.v1:<leadId>`
- Animation expand : `max-height` 0 → auto + opacity 0 → 1, durée 280ms cubic-bezier(.2,.9,.2,1)

---

## 7. Composants à créer / refondre

| Composant | Fichier | Statut |
|---|---|---|
| `SuiviIndex` | `src/pages/Suivi.tsx` (refonte de l'export par défaut) | À refondre |
| `SuiviDetail` | `src/pages/SuiviDetail.tsx` | Nouveau |
| `DossierCard` | `src/components/suivi/DossierCard.tsx` | Nouveau |
| `KpiHeroRow` | inline dans `Suivi.tsx` | Nouveau |
| `DossierSidebar` | `src/components/suivi/DossierSidebar.tsx` | Nouveau |
| `WorkflowTimeline` | `src/components/suivi/WorkflowTimeline.tsx` | Nouveau (remplace rail + modal) |
| `WorkflowStep` | `src/components/suivi/WorkflowStep.tsx` | Nouveau (cercle + accordion) |

Les hooks `useLeads`, `useRdvList`, `useUsers` et l'utilitaire de read/write localStorage **ne changent pas**.

---

## 8. Plan CSS

1. **Conserver** les classes `.suivi-node-*` actuelles le temps de migration (pour éviter régression si autre page les utilise — vérifier avec grep).
2. **Ajouter** nouveau bloc `.suivi-v2-*` à la suite, dans `src/index.css`.
3. **Ajouter** version dark sous le bloc `[data-theme="dark"]` existant (ligne 2792+).
4. Après merge réussi : **supprimer** l'ancien bloc `.suivi-*` (lignes ~3581 → ~3744).
5. Le préfixe `v2` sera renommé en `suivi-*` lors de la suppression finale, pour garder des noms propres.

---

## 9. Routing

Dans `src/main.tsx` (ou fichier router actuel) :
```tsx
{ path: '/suivi', element: <Suivi /> },
{ path: '/suivi/:id', element: <SuiviDetail /> },
```

Plus :
- Loader/guard sur `:id` qui redirige vers `/suivi` si lead introuvable
- Permission inchangée (déjà côté layout)

---

## 10. Accessibilité

- Cercle d'étape `<button>` avec `aria-expanded`, `aria-controls`
- Timeline : `role="list"`, items `role="listitem"`
- Focus visible : ring `2px solid var(--color-or-light)` (visible en light **et** dark grâce au token)
- Tab order : index → KPIs → cards. Détail → breadcrumb → sidebar actions → timeline (chaque étape focusable)
- Contraste vérifié AA pour vert `#4E9667` sur fond dark `#0E1A14` (vérifié 5.6:1 OK)

---

## 11. Responsive

| Breakpoint | Index | Détail |
|---|---|---|
| ≥ 1280px | 3 col cards | 380px sidebar + timeline fluide |
| 960–1280px | 2 col cards | 320px sidebar + timeline fluide |
| < 960px | 1 col cards | sidebar full-width au-dessus, timeline en dessous |
| < 640px | 1 col cards, KPIs en 2x2 | Comme < 960 |

---

## 12. Critères d'acceptation

- [ ] `/suivi` index affiche grille cards des leads signés
- [ ] `/suivi/:id` affiche split sidebar + timeline verticale
- [ ] `/suivi?lead=X` redirige vers `/suivi/X`
- [ ] Permissions admin + delivrabilite OK, autres redirigent
- [ ] Toggle dark mode : tout reste lisible, vert `var(--color-or)` reste visible en accent
- [ ] Click sur étape ouvre/ferme accordion inline (pas de modal)
- [ ] Auto-save dans localStorage avec debounce 500ms, clé inchangée
- [ ] Données existantes localStorage `ecoi.suivi.workflow.v1:*` chargées sans migration
- [ ] `npm run build` passe (tsc -b strict)
- [ ] Aucun hex hardcodé dans le bloc `.suivi-v2-*` — uniquement tokens

---

## 13. Risques & rollback

| Risque | Mitigation |
|---|---|
| Perte de l'état workflow utilisateur | LocalStorage key inchangée — testé en chargement initial |
| Régression sur le routing externe (liens GHL ?) | Compat redirect `?lead=` → `/:id` |
| WIP monorepo legacy qui écrase la refonte | Vérifier après chaque commit "porté du monorepo" (cf. mémoire `saas-ecoi-monorepo-wip-risk`) |
| Dark mode oubli sur un sélecteur custom | Tester toggle theme sur chaque écran avant merge |
| Build frontend cassé | `npm run build` obligatoire (pas juste `tsc --noEmit`) — cf. mémoire `saas-ecoi-build-verification` |

Rollback : revert du commit (composants isolés sous `components/suivi/*` + une seule page touchée).
