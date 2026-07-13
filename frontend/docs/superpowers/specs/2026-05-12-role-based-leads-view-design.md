# Vues Leads par rôle, contrôlées par l'admin

**Date :** 2026-05-12
**Auteur :** Erwan + Claude
**Statut :** Design validé, prêt pour planification

## Contexte

Le SaaS ECOI a 4 rôles (`admin`, `setter`, `commercial`, `delivrabilite`). Aujourd'hui :

- La table Leads (`/leads`) affiche **un catalogue de colonnes hardcodé** dans le frontend (`SETTER_COLUMNS` 11 cols, `ADMIN_COLUMNS` 40+ cols).
- Chaque utilisateur peut localement masquer/afficher des colonnes via un menu, persisté en localStorage.
- Il n'existe **pas** de notion de "vue commercial" — les commerciaux utilisent le composant `LeadsSetter`.
- L'admin n'a aucun contrôle centralisé sur ce que chaque rôle voit.

Dans Airtable (la solution actuelle), chaque rôle dispose d'une **interface dédiée** (`Espace Setter`, `Espace Commercial`) avec ses propres colonnes. C'est ce concept qu'on veut reproduire dans le SaaS.

## Objectif

Permettre à un administrateur de définir, depuis l'UI, les colonnes visibles dans la table Leads pour les rôles `setter` et `commercial`. Lui donner aussi un mode "Voir en tant que setter / commercial" pour prévisualiser le rendu.

## Hors scope (V1)

- Configuration des autres tables (RDV, Notifications…)
- Configuration des widgets dashboard (Overview, Analytics)
- Personnalisation par utilisateur individuel
- Filtres par défaut, tri par défaut, regroupements (uniquement colonnes visibles + ordre)
- Vraie impersonation (filtrage des données par identité simulée)
- Synchronisation temps réel via Socket.io (refresh page suffit)

## Décisions clés

| Décision | Choix | Raison |
|---|---|---|
| Storage backend | Table générique `view_configs` (`role`, `page_key`, `config` JSONB) | Extensible à RDV / dashboard sans migration |
| Granularité | Par rôle, pas par user | Cohérent avec le besoin ("c'est l'admin qui attribue") |
| Override perso | Aucun (config admin = absolue) | Plus simple, conforme à la demande |
| Mode "Voir en tant que" | Preview de mise en page seulement (données admin) | MVP simple, pas de plomberie data-side |
| Realtime | Non (V1) | Refresh suffit, on rajoutera si besoin |
| Page concernée | `leads` uniquement | MVP focalisé |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (NestJS)                                           │
│  ┌──────────────────────┐   ┌────────────────────────────┐  │
│  │ view_configs table   │   │ ViewConfigsModule          │  │
│  │ (role, page_key,     │←──│ GET  /view-configs/:role/  │  │
│  │  config JSONB)       │   │       :page                │  │
│  │                      │   │ PUT  /view-configs/:role/  │  │
│  │                      │   │       :page   (admin only) │  │
│  └──────────────────────┘   │ GET  /view-configs/leads/  │  │
│                              │       catalog              │  │
│                              └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP
                              │
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React)                                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ leadsColumnCatalog.ts                               │    │
│  │ - LEADS_COLUMN_CATALOG: tous les ColumnDef          │    │
│  │ - une seule source de vérité                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│           ┌──────────────┼────────────────┐                 │
│           ▼              ▼                ▼                 │
│  ┌────────────┐  ┌─────────────┐  ┌────────────────────┐    │
│  │ useView    │  │ useViewAs   │  │ Settings page →    │    │
│  │ Config     │  │ store       │  │ ViewConfigEditor   │    │
│  │ (role,page)│  │ (zustand)   │  │ (admin uniquement) │    │
│  └────────────┘  └─────────────┘  └────────────────────┘    │
│           │              │                                  │
│           ▼              ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ LeadsList.tsx                                       │    │
│  │ effectiveRole = useViewAs() ?? user.role            │    │
│  │ columns = useViewConfig(effectiveRole, 'leads')     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Backend

### 1. Schéma Drizzle — `backend/src/db/schema/view-configs.ts`

```typescript
import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'
import { userRoleEnum } from './enums'
import { users } from './users'

export const viewConfigs = pgTable(
  'view_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: userRoleEnum('role').notNull(),
    pageKey: text('page_key').notNull(),
    config: jsonb('config').$type<ViewConfigPayload>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedById: uuid('updated_by_id').references(() => users.id),
  },
  (t) => ({ uniqueRolePage: unique().on(t.role, t.pageKey) }),
)

export type ViewConfigPayload = {
  visibleColumns: string[]  // ordre = ordre d'affichage
}
```

Migration générée via `pnpm drizzle-kit generate`.

### 2. Module `view-configs`

```
backend/src/modules/view-configs/
├── view-configs.module.ts
├── view-configs.controller.ts
├── view-configs.service.ts
├── view-configs.service.spec.ts
├── view-configs.controller.spec.ts
├── catalogs/
│   └── leads.catalog.ts          # liste des column keys valides
└── dto/
    ├── update-view-config.dto.ts
    └── view-config-response.dto.ts
```

### 3. Endpoints

| Méthode | Route | Rôle | Description |
|---|---|---|---|
| `GET` | `/view-configs/:role/:pageKey` | tous (auth) | Config d'un rôle. Si absent en DB → renvoie le default (catalogue complet) |
| `PUT` | `/view-configs/:role/:pageKey` | admin | UPSERT config + audit log |

Pas d'endpoint `GET /catalog` : le catalogue est dupliqué (intentionnellement) entre frontend (avec fonctions `render`) et backend (juste les clés + `required` pour validation). C'est une duplication minime de 2 listes statiques, gérée à la main.

### 4. Validation

```typescript
// update-view-config.dto.ts
export const UpdateViewConfigSchema = z.object({
  visibleColumns: z.array(z.string()).min(1).max(50),
})
```

Le service vérifie en plus :
- Chaque clé ∈ catalogue (sinon `BadRequestException("Unknown column key: foo")`)
- Toutes les colonnes `required` du catalogue sont présentes (sinon `BadRequestException("Required column 'nom' missing")`)

### 5. Seed initial

Au boot, si `view_configs` est vide, insérer 2 lignes :

```typescript
// setter (basé sur l'ancien SETTER_COLUMNS)
{ role: 'setter', pageKey: 'leads', config: { visibleColumns: [
  'nom','telephone','adresseComplete','setter','jaugeAppels','dernierAppel',
  'statut','appelDate','jauge','logAppel','appelsCommercial',
]}}

// commercial (à affiner avec les besoins métier)
{ role: 'commercial', pageKey: 'leads', config: { visibleColumns: [
  'nom','telephone','adresseComplete','statut','rdv','commercialRdv','jauge','logAppel',
]}}
```

Pas de seed pour `admin` ni `delivrabilite` (admin = tout par défaut, delivrabilite = hors V1).

### 6. Audit

Endpoint `PUT` décoré `@Audit({ entityType: 'view_config', action: 'update' })`. L'audit log existant capture user, before/after.

## Frontend

### 1. Catalogue unique — `frontend/src/lib/leadsColumnCatalog.ts`

```typescript
export type LeadColumnKey =
  | 'nom' | 'email' | 'telephone' | 'adresse' | 'ville' | 'codePostal'
  | 'adresseComplete' | 'statut' | 'setter' | 'commercialRdv'
  | 'jaugeAppels' | 'dernierAppel' | 'appelDate' | 'jauge' | 'logAppel'
  | 'appelsCommercial' | 'leadGenere' | 'canal' | 'campagne'
  // … toutes les clés exportées par l'ancien ADMIN_COLUMNS

export type LeadColumnDef = {
  key: LeadColumnKey
  label: string                                            // libellé éditeur admin
  header: string                                           // libellé colonne table
  width: string                                            // ex: 'w-[240px]'
  required?: boolean                                       // ex: 'nom'
  render: (lead: LeadResponse, ctx: RenderCtx) => React.ReactNode
}

export const LEADS_COLUMN_CATALOG: LeadColumnDef[] = [
  { key: 'nom', label: 'Nom', header: 'NOM', width: 'w-[240px]', required: true,
    render: (l) => <NomCell lead={l}/> },
  { key: 'telephone', label: 'Téléphone du Prospect', header: 'TÉLÉPHONE DU PROSPECT',
    width: 'w-[190px]', render: (l, c) => <PhoneCell lead={l} onStartCall={c.startCall}/> },
  // … toutes les colonnes (consolidation des 11 setter + 40+ admin actuels)
]

export const LEADS_COLUMN_CATALOG_BY_KEY: Record<LeadColumnKey, LeadColumnDef> =
  Object.fromEntries(LEADS_COLUMN_CATALOG.map((c) => [c.key, c])) as Record<LeadColumnKey, LeadColumnDef>
```

Remplace `SETTER_COLUMNS` et `ADMIN_COLUMNS` dans `LeadsList.tsx`.

### 2. Hook config — `frontend/src/lib/useViewConfig.ts`

Utilise le pattern `useFetch` existant (`frontend/src/lib/hooks.ts`), qui supporte le cache 5min et `path = null` pour désactiver.

```typescript
export function useViewConfig(role: Role, pageKey: 'leads') {
  const skip = role === 'admin'  // admin = catalogue complet par défaut, pas de fetch
  const { data, loading, refetch } = useFetch<ViewConfigResponse>(
    skip ? null : `/view-configs/${role}/${pageKey}`,
  )
  const visibleColumns = skip
    ? LEADS_COLUMN_CATALOG.map((c) => c.key)
    : data?.visibleColumns ?? null
  return { visibleColumns, loading, refetch }
}
```

### 3. Store "Voir en tant que" — `frontend/src/lib/useViewAs.ts`

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ViewAsRole = 'setter' | 'commercial' | null

export const useViewAs = create<{
  viewAs: ViewAsRole
  setViewAs: (r: ViewAsRole) => void
}>()(
  persist(
    (set) => ({ viewAs: null, setViewAs: (viewAs) => set({ viewAs }) }),
    { name: 'ecoi.viewAs' },
  ),
)

export function useEffectiveRole(): Role {
  const realRole = useAuth((s) => s.user?.role) ?? 'setter'
  const viewAs = useViewAs((s) => s.viewAs)
  if (realRole === 'admin' && viewAs) return viewAs
  return realRole
}
```

### 4. UI — sélecteur "Voir en tant que"

- Composant `<ViewAsBanner />` rendu seulement si `user.role === 'admin'`.
- Sélecteur permanent dans la Topbar : `[Aperçu : Admin ▾]` (options : Admin, Setter, Commercial).
- Si `viewAs ≠ null`, bandeau orange sticky en haut du contenu :

```
┌─────────────────────────────────────────────────────────────────┐
│ ⓘ APERÇU SETTER  —  vous voyez l'interface telle qu'un setter   │
│                     la voit (colonnes filtrées).  [✕ Quitter]   │
└─────────────────────────────────────────────────────────────────┘
```

- Sidebar filtrée par `effectiveRole` → en mode "Aperçu Setter", `/settings` disparaît. Le sélecteur de la Topbar reste lui toujours visible pour permettre de revenir.

### 5. UI — éditeur de config dans `Settings.tsx`

Nouvelle section `<ViewConfigEditor />` rendue dans `SettingsAdmin` :

```
VUES PAR RÔLE
─────────────────────────────────────────────────────────
[ Setter ] [ Commercial ]              ← tabs

Colonnes visibles pour les setters dans la table Leads :

☑ Nom (obligatoire)                              ⋮⋮ drag
☑ Téléphone du Prospect                          ⋮⋮
☑ Adresse complète                               ⋮⋮
☐ Email                                          ⋮⋮
☑ Statut opportunité                             ⋮⋮
…

                              [Annuler]  [Enregistrer]
```

- Source des colonnes : directement `LEADS_COLUMN_CATALOG` côté frontend (pas d'endpoint catalog).
- Checkbox = visible/caché ; clé `required` = checkbox désactivée.
- Drag-and-drop pour l'ordre. Lib : HTML5 drag natif (suffisant MVP). Si l'UX se révèle trop fragile, basculer sur `@dnd-kit/core` en phase 2.
- `Enregistrer` → `PUT /view-configs/setter/leads { visibleColumns: [...] }`. Toast confirmation.

### 6. Refactor de `LeadsList.tsx`

- `LeadsList` devient un composant unique paramétré par `visibleColumns` (pas de `LeadsSetter` / `LeadsAdmin` distincts pour la *présentation*).
- Les **règles métier** (`belongsToSetter` filtre "mes leads" côté setter) restent gérées par `useEffectiveRole()` et appliquées en amont du rendu.
- Suppression de `SETTER_COLUMNS`, `ADMIN_COLUMNS`, `useColumnVisibility`, `ColumnVisibilityMenu`, `localStorage 'ecoi.leads.*.columns.v2'`.
- Disparition complète du menu "Colonnes" (y compris pour admin) : l'admin voit toujours le catalogue complet par défaut, et passe par Settings → Vues par rôle pour customiser ce que voient les autres rôles.

## Data flow

### Cas 1 — Un setter ouvre `/leads`

1. `useEffectiveRole()` → `'setter'`
2. `useViewConfig('setter', 'leads')` → `GET /view-configs/setter/leads`
3. Render table avec `data.visibleColumns` uniquement
4. Pas de menu "Colonnes" affiché

### Cas 2 — Admin ouvre `/leads` en mode normal

1. `useEffectiveRole()` → `'admin'`
2. Pas de fetch view-config
3. Render avec `LEADS_COLUMN_CATALOG` complet
4. Topbar : `[Aperçu : Admin ▾]`

### Cas 3 — Admin clique "Aperçu : Setter"

1. `useViewAs.setViewAs('setter')`
2. `<ViewAsBanner />` apparaît
3. Recalcul : `effectiveRole = 'setter'`, `LeadsList` refetch config setter
4. Données affichées = TOUS les leads (admin scope), pas filtrées
5. `[✕ Quitter]` → `viewAs = null` → retour vue admin sans refresh

### Cas 4 — Admin enregistre une config

1. Coche/décoche + drag&drop dans `ViewConfigEditor`
2. `PUT /view-configs/setter/leads { visibleColumns: [...] }`
3. Backend valide (Zod + catalogue + required), UPSERT, audit log
4. 200 → toast "Vue setter enregistrée"
5. Si mode preview actif, refetch automatique (refetch hook)

### Cas 5 — Première utilisation (DB vide pour ce rôle)

`GET /view-configs/setter/leads` → ligne inexistante → backend renvoie le default `LEADS_COLUMN_CATALOG.map(c => c.key)`.

Plus le seed initial du démarrage (Section Backend §5) couvre déjà setter + commercial pour éviter l'état vide.

## Erreurs

| Cas | Backend | Frontend |
|---|---|---|
| `role` invalide (path param) | 400 | Pas censé arriver (types stricts) |
| `PUT` par non-admin | 403 (`RolesGuard`) | Bouton "Enregistrer" pas affiché côté UI (défense en profondeur) |
| Clé inconnue dans body | 400 "Unknown column key" | Toast erreur, conserve l'état formulaire |
| `nom` (required) manquant | 400 "Required column 'nom' missing" | Checkbox `nom` désactivée, donc cas en théorie impossible |
| Tableau vide | 400 (Zod min(1)) | Bouton "Enregistrer" disabled si 0 coche |
| Fetch GET fail | – | Fallback : `LEADS_COLUMN_CATALOG` complet + bandeau "Config indisponible" |
| Race (admin A + B en écriture parallèle) | Dernière écriture gagne, `updatedAt` permet debug | – |

## Tests

### Backend

`view-configs.service.spec.ts`
- `getConfig` retourne la ligne BDD si présente
- `getConfig` retourne le default catalogue complet si absente
- `updateConfig` insert ON CONFLICT DO UPDATE
- `updateConfig` rejette clé inconnue (BadRequest)
- `updateConfig` rejette si `nom` manquant (BadRequest)

`view-configs.controller.spec.ts`
- `GET` accessible auth simple
- `PUT` rejette non-admin (403)
- `PUT` body invalide → 400

Tests d'intégration via `db-test.helper.ts` (vraie Postgres).

### Frontend (smoke manuel)

1. Login admin → `/leads` → toutes colonnes visibles, pas de bandeau
2. Sélecteur "Aperçu" présent uniquement pour admin
3. Switch "Aperçu : Setter" → bandeau orange, colonnes filtrées, données admin (tous leads)
4. "✕ Quitter" → retour vue admin sans refresh
5. Login setter (autre browser) → `/leads` → colonnes setter, pas de menu "Colonnes"
6. Admin → Settings → Vues par rôle → tab Setter → modifie + Enregistrer
7. Re-login setter → colonnes mises à jour
8. Admin tente de décocher "Nom" → checkbox disabled
9. Admin tente PUT direct via curl en tant que setter → 403

## Extensions futures (non V1)

- `page_key = 'rdv'` (sélecteur colonnes pour l'agenda RDV)
- `page_key = 'overview'` (sélecteur de widgets dashboard)
- `config.filters[]` (filtre par défaut par rôle)
- Override par utilisateur (`view_configs_user_overrides` table séparée, ou champ `user_id` sur `view_configs`)
- Realtime via Socket.io (event `view-config.updated` push à la room `role:setter`)
- Vraie impersonation (`view-as` propage côté backend dans les query filters)

## Fichiers touchés (estimation)

**Création**
- `backend/src/db/schema/view-configs.ts`
- `backend/src/db/migrations/00XX_view_configs.sql` (généré)
- `backend/src/modules/view-configs/` (8 fichiers)
- `backend/src/seed/view-configs.seed.ts` (ou intégré à `bootstrap.ts`)
- `frontend/src/lib/leadsColumnCatalog.ts`
- `frontend/src/lib/useViewConfig.ts`
- `frontend/src/lib/useViewAs.ts`
- `frontend/src/components/ViewAsBanner.tsx`
- `frontend/src/components/ViewAsSelector.tsx`
- `frontend/src/components/settings/ViewConfigEditor.tsx`
- `docs/superpowers/specs/2026-05-12-role-based-leads-view-design.md` (ce fichier)

**Modification**
- `backend/src/app.module.ts` (register `ViewConfigsModule`)
- `backend/src/db/schema/index.ts` (export `viewConfigs`)
- `backend/src/bootstrap.ts` (seed si DB vide)
- `frontend/src/pages/leads/LeadsList.tsx` (refactor majeur : catalogue + hooks)
- `frontend/src/pages/Settings.tsx` (ajouter section `<ViewConfigEditor />`)
- `frontend/src/components/shell/Topbar.tsx` (ajouter `<ViewAsSelector />` pour admin)
- `frontend/src/components/shell/Sidebar.tsx` (utiliser `useEffectiveRole`)
- `frontend/src/components/shell/AppShell.tsx` (utiliser `useEffectiveRole`)
- `frontend/src/lib/role.ts` : remplacer l'implémentation de `useRole(selector)` pour qu'elle lise `useEffectiveRole()` au lieu de `useAuth(s => s.user?.role)`. Aucun call site existant à toucher → toutes les pages (`Sidebar`, `AppShell`, `PersistentLeadSidebar`, etc.) bénéficient automatiquement du mode "voir en tant que".
