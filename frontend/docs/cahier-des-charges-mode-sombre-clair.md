# Cahier des charges — Mode clair / sombre léger ECOI

Date: 2026-05-14
Projet: /root/ECOI_frontend
Méthode: inspection visuelle réelle des pages rendues dans le navigateur, pas seulement lecture des couleurs sources.

## 1. Correction après scan visuel

Le design actuel a évolué vers une interface beaucoup plus minimaliste.

Constat important:
- Les anciennes couleurs brand existent encore dans les sources, mais elles ne dominent plus visuellement.
- L’interface visible utilise surtout des neutres chauds, du blanc cassé, du beige grisé, de l’anthracite doux et quelques accents très ponctuels.
- Il y a peu ou pas de dégradés visibles.
- Les surfaces sont principalement en aplats doux, cartes arrondies, bordures légères et micro-ombres.

Donc le mode sombre ne doit pas partir d’une palette “brand très colorée”, mais d’un dark mode minimaliste, chaud, léger, fidèle au rendu actuel.

## 2. Design actuel réellement visible

Pages inspectées:
- Login
- Overview / Performance équipe
- Leads
- Analytics / Performance globale équipe
- Dropdown Paramètres dans la Topbar

### 2.1 Palette dominante réelle

Couleurs visibles dominantes:
- Fond général gris-beige clair: environ `#E6E3DC` / `#E9E7E1`.
- Surfaces/cartes blanc cassé: environ `#F7F6F2` à `#FFFFFF`.
- Texte principal anthracite/brun doux: environ `#2E2A26` / `#2A2520`.
- Texte secondaire gris chaud: environ `#77736B` / `#9D9890`.
- Texte faible: environ `#A7A29B`.
- Bordures discrètes: environ `#DDD9D0` / `#E1DED7`.
- Sidebar active: brun/noir doux `#2D2924`.

Accents visibles:
- Doré/moutarde: environ `#D4AF37` / `#DDB22E`, utilisé pour logo, CTA, chiffres, export, états actifs.
- Vert doux: environ `#3DA86A` / `#42B978`, utilisé pour succès, ventes, qualification.
- Orange/cuivre: environ `#B87333` / `#C87524`, utilisé pour RDV, relances, états secondaires.
- Rouille/rouge-orangé: utilisé surtout pour badge notification et danger.
- Bleu-gris: ponctuel, autour de `#6B7C8C`.

### 2.2 Style actuel

Le style réel est:
- Minimaliste.
- CRM/SaaS premium.
- Très clair.
- Très arrondi.
- Peu saturé.
- Sans dégradés marqués.
- Avec beaucoup d’espace blanc/gris-beige.
- Avec cartes en aplat doux ou translucide très léger.
- Avec ombres très subtiles.

Ce n’est plus une interface “colorée” ou “dégradée”. Les couleurs sont fonctionnelles et ponctuelles.

### 2.3 Topbar et navigation

La Topbar visible:
- Fond blanc cassé / translucide léger.
- Onglets en capsules arrondies.
- Onglet actif blanc avec ombre douce.
- Icônes dans boutons ronds blancs.
- Badge notification rouge/orange très ponctuel.

### 2.4 Sidebar

La Sidebar visible:
- Fond gris-beige clair.
- Logo `E` en doré.
- Icônes gris chaud.
- Item actif en brun/noir doux avec icône blanche.

### 2.5 Cards / tableaux

Les cards KPI et les modules:
- Fonds blanc cassé.
- Coins très arrondis.
- Bordures fines presque invisibles.
- Labels en petites capitales grisées.
- Valeurs en anthracite.
- Accents colorés uniquement sur certains chiffres, badges ou graphes.

Les tableaux:
- Header beige très clair.
- Lignes fines.
- Texte principal anthracite.
- Texte secondaire gris chaud.
- Badges pastel.

## 3. Direction mode sombre validée

Objectif: créer un “sombre léger” minimaliste, pas un thème noir.

Le dark mode doit ressembler à une version nocturne du design actuel:
- Même structure calme.
- Même absence de dégradés marqués.
- Même usage limité des couleurs.
- Même sensation premium/CRM.
- Ne pas devenir noir, bleu nuit ou trop contrasté.

Nom de direction recommandé:
- “Dark champagne minimal”
- ou “Brun graphite doux”

## 4. Palette sombre proposée

### 4.1 Neutres sombres

Fond principal:
- `#28241F` — brun graphite chaud, pas noir.

Fond secondaire / zone app:
- `#302B25`.

Surface carte:
- `#383129` avec opacité possible `0.86`.

Surface carte plus claire:
- `#40382F` pour hover, dropdown, champs.

Topbar/sidebar:
- `rgba(48, 43, 37, 0.88)`.

Texte principal:
- `#F3EEE7`.

Texte secondaire:
- `#C8BFB3`.

Texte faible:
- `#9F9488`.

Bordure:
- `rgba(243, 238, 231, 0.14)`.

Bordure douce:
- `rgba(243, 238, 231, 0.08)`.

Ombre:
- `rgba(0, 0, 0, 0.18)` mais très légère.

### 4.2 Accents en dark mode

Garder les accents actuels, mais les utiliser avec retenue:
- Doré: `#D4AF37`, éventuellement `#E0BE55` pour texte sur fond sombre.
- Vert: `#4FBE7D` pour succès lisible.
- Cuivre/orange: `#C8894A` pour RDV/relance.
- Rouille: `#D66E3F` pour alerte/danger.
- Bleu-gris: `#8796A5` pour info.

Tints sombres:
- Or tint: `rgba(212, 175, 55, 0.14)`.
- Vert tint: `rgba(61, 168, 106, 0.16)`.
- Cuivre tint: `rgba(184, 115, 51, 0.16)`.
- Rouille tint: `rgba(183, 65, 14, 0.18)`.
- Info tint: `rgba(107, 124, 140, 0.18)`.

## 5. Ce qu’il faut éviter

À ne pas faire:
- Fond noir pur `#000`.
- Gros dégradés colorés.
- Bleu nuit dominant.
- Surfaces trop contrastées façon terminal/devtool.
- Trop d’or partout.
- Trop de couleurs saturées.
- Transformer les cartes en blocs noirs opaques.
- Perdre le style minimaliste actuel.

Le sombre doit rester léger, doux, chaud et lisible.

## 6. Fonctionnalités attendues

### 6.1 Thème clair/sombre

Ajouter un vrai système de thème:
- Valeurs: `light`, `dark`.
- Défaut: `light`.
- Persistance localStorage: `ecoi.theme`.
- Application sur `document.documentElement`, par exemple `data-theme="dark"`.
- Le choix reste après refresh.

### 6.2 Bouton dans le dropdown navbar

Ajouter un contrôle dans le dropdown Paramètres de la Topbar.

Emplacement recommandé après inspection visuelle:
- Dans le dropdown Paramètres.
- Entre “Analytics” et “Se déconnecter”.
- Avec une séparation légère avant “Se déconnecter”.

Libellé recommandé:
- Titre: `Apparence`.
- Sous-titre en mode clair: `Mode clair` ou `Activer le mode sombre`.
- Sous-titre en mode sombre: `Mode sombre` ou `Activer le mode clair`.

Design recommandé:
- Ligne compacte comme les autres entrées du menu.
- Icône soleil/lune dans une pastille douce.
- Petit switch/toggle à droite.
- Pas de gros bouton coloré.

Pourquoi:
- Le dropdown est déjà la bonne zone pour les préférences.
- La topbar ne doit pas être surchargée avec une icône en plus.
- Le contrôle reste visible sans casser le minimalisme.

### 6.3 Page Paramètres

Dans `Settings.tsx`, il existe déjà une ligne statique:
- `Mode sombre` avec `enabled={false}`.

À faire:
- La connecter au vrai thème.
- Permettre le toggle depuis cette page aussi.
- Garder le switch très sobre.

## 7. Architecture technique proposée

### 7.1 Store thème

Créer:
- `src/lib/theme.ts`

Responsabilités:
- Lire `localStorage.ecoi.theme`.
- Exposer `theme`, `isDark`, `setTheme`, `toggleTheme`.
- Appliquer `document.documentElement.dataset.theme`.

Zustand est déjà présent, donc un petit store Zustand est cohérent.

### 7.2 CSS global

Dans `src/index.css`:
- Garder les tokens actuels en mode clair.
- Ajouter une surcharge `[data-theme="dark"]`.
- Prioriser les variables existantes: `--color-cream`, `--color-text`, `--color-muted`, `--color-faint`, `--color-line`, `--color-line-soft`, `--color-*-tint`.

Puis adapter les classes globales:
- `.glass-card`
- `.kpi-card`
- `.big-number-card`
- `.promo-card`
- `.app-sidebar`
- `.sidebar-toggle`
- `.sidebar-item.active`
- `.app-topbar`
- `.topbar-action`
- `.topbar-profile`
- `.topbar-menu`
- `.menu-button`
- `.menu-icon-badge`
- `.profile-menu-head`
- `.btn-secondary`
- `.topbar-search-input`
- sticky cells du tableau Leads

### 7.3 Classes à surveiller

Les pages utilisent beaucoup de classes directes comme:
- `bg-white`
- `bg-white/70`
- `bg-white/40`
- `border-white/80`
- `hover:bg-white/40`

Ces classes resteront trop claires si on ne les remplace pas.

Approche recommandée:
1. Faire d’abord un socle global via variables CSS.
2. Vérifier visuellement les pages.
3. Remplacer seulement les classes blanches qui cassent vraiment le dark mode par des classes sémantiques ou CSS globales.

## 8. Pages à vérifier visuellement

Obligatoire:
- Overview
- Leads
- Analytics
- RDV
- Notifications
- Settings
- Dropdown Paramètres
- Dropdown Profil
- Recherche Topbar

À vérifier mais moins prioritaire:
- Login
- AcceptInvitation

## 9. Critères d’acceptation

Le mode sombre est accepté si:
- Le rendu reste minimaliste, sans dégradé fort.
- Le fond n’est pas noir, mais brun/gris chaud.
- Les cards restent douces, arrondies, lisibles.
- Les tableaux restent lisibles sans lignes trop fortes.
- Les accents or/vert/cuivre restent ponctuels.
- Le bouton dans le dropdown Paramètres est propre et discret.
- La ligne “Mode sombre” dans Paramètres reflète le vrai état.
- Le thème persiste après refresh.
- `npm run build` passe.

## 10. Plan d’implémentation

1. Créer le store thème.
2. Appliquer le thème au démarrage.
3. Ajouter icônes `sun` et `moon` dans `Icon.tsx`.
4. Ajouter une entrée `Apparence` + toggle dans le dropdown Paramètres de `Topbar.tsx`.
5. Connecter `PrefRow Mode sombre` dans `Settings.tsx`.
6. Ajouter `[data-theme="dark"]` dans `index.css` avec palette sombre douce.
7. Adapter les composants CSS globaux.
8. Inspecter visuellement Overview, Leads, Analytics et dropdowns.
9. Corriger les `bg-white/...` visibles qui cassent le rendu.
10. Lancer `npm run build`.

## 11. Note de design finale

Le mode sombre doit être une variation nocturne du design minimaliste actuel, pas une refonte.

Formule à suivre:
- clair actuel = gris-beige + blanc cassé + anthracite + accents dorés ponctuels.
- sombre attendu = brun graphite + surfaces brun chaud + texte ivoire + mêmes accents ponctuels.
