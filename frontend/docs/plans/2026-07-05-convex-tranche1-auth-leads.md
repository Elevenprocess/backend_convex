# Convex tranche 1 — Auth + page Leads : plan d'implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Le frontend s'authentifie sur Convex (`dev:spotted-horse-257`, provider Password) et la page Leads lit ses données via Convex — sans toucher au contrat des composants (mêmes types `UserResponse`/`LeadResponse`, même store `useAuth`).

**Architecture:** On garde le store zustand `useAuth` et les hooks `useLeads`/`useUsers`/`useRdvList` comme seams : leurs *internes* branchent sur Convex quand `VITE_CONVEX_URL` est défini (`convexAuthEnabled`), sinon rien ne change (NestJS). Pas de copie des `_generated` de ECOI_convex (leurs `.d.ts` importent les sources serveur) : on déclare des références de fonctions typées à la main via `makeFunctionReference` — YAGNI, ~6 références pour cette tranche. Le realtime socket.io est désactivé en mode Convex (les `useQuery` Convex sont réactifs nativement).

**Tech Stack:** convex@1.x (`ConvexReactClient` déjà en place), `@convex-dev/auth@^0.0.81` (même version que ECOI_convex), zustand, vitest.

**Contexte d'exécution :**
- Le workspace EST le Mac de Valentino (bind-mount). L'app tourne via `docker compose up` (Vite 8, node 22). Les vérifs (`vitest`, `tsc -b`) se lancent depuis le conteneur Claude après `npm install` local (binaires Linux — ils ne gênent pas le conteneur Vite qui a son propre volume node_modules).
- Déploiement Convex : `ECOI_convex/.env.local` → `dev:spotted-horse-257`. Données = seed uniquement. `SITE_URL=http://localhost:5173` déjà posé. Google OAuth NON configuré → Password uniquement.
- Les comptes seed ont des mots de passe inconnus → on crée son compte via le flow `signUp`, puis on le promeut admin via une mutation interne CLI (Task 8).

---

### Task 0 : Baseline verte

**Step 1** — Installer les deps (workspace Linux) :
```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_frontend" && npm ci --no-audit --no-fund
```
**Step 2** — Baseline tests : `npx vitest run` → tout vert (sinon noter les échecs préexistants AVANT de commencer).
**Step 3** — Baseline types : `npx tsc -b --pretty false` → 0 erreur (mémoire projet : c'est `tsc -b` que Render exécute, pas `--noEmit`).

### Task 1 : Dépendance @convex-dev/auth

**Files:** Modify `package.json`, `package-lock.json`.

**Step 1** — `npm install @convex-dev/auth@^0.0.81 --no-audit --no-fund`
**Step 2** — Vérifier : `npx tsc -b --pretty false` toujours 0 erreur.
**Step 3** — Commit : `chore(deps): @convex-dev/auth pour le login Convex (tranche 1)`

### Task 2 : Références de fonctions typées (`src/lib/convexApi.ts`)

**Files:** Create `src/lib/convexApi.ts`.

Pas de test (déclarations de types uniquement). Contenu :

```ts
import { makeFunctionReference } from 'convex/server'
import type { PaginationResult } from 'convex/server'

// Docs Convex minimaux consommés par la tranche 1 (source de vérité :
// ECOI_convex/convex/schema.ts). Champs optionnels = absents du doc.
export type ConvexUserDoc = {
  _id: string; _creationTime: number
  email: string; name: string
  role?: string; team?: string; active?: boolean
  ghlUserId?: string; deletedAt?: number
}
export type ConvexLeadDoc = {
  _id: string; _creationTime: number
  externalId?: string; source: string; status: string
  firstName?: string; lastName?: string; email?: string; phone?: string
  addressLine?: string; city?: string; postalCode?: string; localisationMap?: string
  revenuFiscal?: number; typeLogement?: string
  utmSource?: string; utmMedium?: string; utmCampaign?: string
  campaign?: string; adset?: string; ad?: string; canalAcquisition?: string
  setterId?: string; assignedToId?: string; referrerId?: string
  lastContactAt?: number; latestCallAt?: number; firstCallAt?: number
  latestCallComment?: string; latestCallSetterId?: string
  // tout champ supplémentaire du schéma passe en `unknown` sans casser
  [k: string]: unknown
}

export const usersMe = makeFunctionReference<'query', Record<string, never>, ConvexUserDoc | null>('users:me')
export const usersList = makeFunctionReference<'query', { role?: string; team?: string; active?: boolean }, ConvexUserDoc[]>('users:list')
export const leadsList = makeFunctionReference<'query', { status?: string; setterId?: string; city?: string; paginationOpts: unknown }, PaginationResult<ConvexLeadDoc>>('leads:list')
// rdv:list — vérifier la signature exacte dans ECOI_convex/convex/rdv.ts au moment du câblage
```

**Step 2** — `npx tsc -b --pretty false` → 0 erreur. Commit : `feat(convex): références typées users/leads (tranche 1)`

### Task 3 : Mappers Convex → types REST (TDD)

**Files:** Create `src/lib/convexMappers.ts`, `src/lib/convexMappers.test.ts`.

**Step 1** — Tests d'abord (`convexMappers.test.ts`) :
- `mapConvexUser` : `_id`→`id` ; `role` absent → `'setter'` (même défaut que `roleOf()` serveur) ; `active` absent → `true` ; `_creationTime` → ISO `createdAt`.
- `mapConvexLead` : optionnels absents → `null` (le type REST est nullable, pas optionnel) ; timestamps numériques → ISO strings ; `_id`→`id`.
Vérifier contre `UserResponse`/`LeadResponse` de `src/lib/types.ts` (lignes ~16 et ~75).

**Step 2** — `npx vitest run src/lib/convexMappers.test.ts` → FAIL (module absent).
**Step 3** — Implémenter minimal. **Step 4** — vitest PASS. **Step 5** — Commit : `feat(convex): mappers user/lead vers les types REST`

### Task 4 : Flag + ConvexAuthProvider dans main.tsx

**Files:** Modify `src/lib/convex.ts` (export `convexAuthEnabled = convexClient !== null`), Modify `src/main.tsx:13-14,141` : remplacer `ConvexProvider` par `ConvexAuthProvider` (`@convex-dev/auth/react`) — même prop `client`. Fallback sans URL inchangé.

Vérif : `npx tsc -b` + `npx vitest run` (les tests existants de main ne doivent pas casser). Commit : `feat(auth): ConvexAuthProvider en place du ConvexProvider`

### Task 5 : Pont auth Convex → store zustand

**Files:** Modify `src/lib/auth.ts`, Create `src/components/auth/ConvexAuthBridge.tsx`, Modify `src/main.tsx` (monter le bridge sous le provider), Create `src/lib/auth.convex.test.ts`.

Principe : le store garde son contrat (`user`, `status`, `signIn`, `signOut`, viewAs…). En mode Convex :
- `auth.ts` expose `configureAuthBackend(impl: { signIn(email,pw,flow), signOut() })` ; les actions du store délèguent à l'impl configurée quand `convexAuthEnabled`, sinon code better-auth existant intact.
- `ConvexAuthBridge` (composant sans rendu) : `useAuthActions()` + `useConvexAuth()` + `useQuery(usersMe)` ; à chaque changement → `useAuth.setState({ user: mapConvexUser(me), realUser: …, status })` ; enregistre `configureAuthBackend` au mount. `hydrate()` devient no-op en mode Convex (la réactivité vient du useQuery).
- Login.tsx : ajouter (mode Convex uniquement) un lien « Créer un compte » qui bascule le submit en `flow: 'signUp'` — nécessaire car les mots de passe seed sont inconnus.

TDD sur la partie pure : test de la délégation du store (backend fake enregistré → signIn appelle l'impl, met à jour status). Le bridge lui-même se vérifie manuellement (Task 9).

Commit : `feat(auth): login/signup Convex branché sur le store useAuth`

### Task 6 : Couper socket.io en mode Convex

**Files:** Modify `src/lib/realtime.ts` (guard `if (convexAuthEnabled) return` à l'init du socket), test existant `hooks.realtime-refresh.test.tsx` doit rester vert.

Commit : `feat(realtime): pas de socket.io en mode Convex (réactivité native)`

### Task 7 : Hooks leads/users/rdv sur Convex

**Files:** Create `src/lib/convexHooks.ts`, Modify `src/lib/hooks.ts` (branchement conditionnel dans `useLeads`, `useLeadsProgressive`, `useUsers`, `useRdvList`), Create `src/lib/convexHooks.test.ts` (logique d'accumulation de pages, pure).

- `useConvexLeads()` : `usePaginatedQuery(leadsList, {}, { initialNumItems: 200 })` + `loadMore` automatique jusqu'à épuisement (LeadsList attend le tableau complet, il est virtualisé) ; retour `{ data: LeadResponse[], loading, error }`.
- `useConvexUsers()` : `useQuery(usersList, {})` ; **attention** : `users:list` exige un rôle lead/admin — attraper l'erreur et retourner `[]` pour un setter (la page tolère l'absence de noms).
- `useConvexRdvList()` : vérifier la signature `rdv:list` dans ECOI_convex avant d'écrire.
- Dans `hooks.ts`, chaque hook fait : `if (convexAuthEnabled) return useConvexX(...)` en tête (ordre des hooks stable car le flag est constant au runtime).

Vérif : vitest + tsc -b. Commit : `feat(leads): page Leads servie par Convex en mode Convex`

### Task 8 : Promotion de rôle côté ECOI_convex

**Files:** Create `ECOI_convex/convex/devTools.ts` :

```ts
import { internalMutation } from './_generated/server'
import { v } from 'convex/values'
// Dev uniquement : lancé via `npx convex run devTools:setRole` (deploy key).
export const setRole = internalMutation({
  args: { email: v.string(), role: v.string() },
  handler: async (ctx, args) => {
    const u = await ctx.db.query('users').withIndex('by_email', q => q.eq('email', args.email)).unique()
    if (!u) throw new Error(`introuvable : ${args.email}`)
    await ctx.db.patch(u._id, { role: args.role })
  },
})
```

Déployer + utiliser :
```bash
cd "/workspace/Desktop/SaaS ecoi/ECOI_convex" && npx convex dev --once   # push des fonctions
npx convex run devTools:setRole '{"email":"<ton-email>","role":"admin"}'
```
Commit (repo ECOI_convex) : `chore(dev): mutation interne setRole pour le dev local`

### Task 9 : Validation de bout en bout

1. `npx vitest run` (tout) + `npx tsc -b --pretty false` → verts.
2. Valentino : `docker compose up --build` (nouvelles deps) → http://localhost:5173.
3. « Créer un compte » → signUp → arrivée dans l'app (rôle setter par défaut).
4. Promouvoir admin (Task 8) → recharger → page **Leads** affiche les leads seed, sans aucun appel vers `api.electroconceptoi.com` (vérifier l'onglet réseau : uniquement `*.convex.cloud`).
5. Les autres pages (Overview…) afficheront leurs états d'erreur — attendu en tranche 1.

**Limites connues de la tranche (assumées) :** viewAs/impersonation n'affecte pas le scoping Convex ; pages non câblées en erreur ; Google OAuth non configuré ; données seed.

**Tranche 2 (plus tard) :** Overview/Analytics (fonctions `analytics:*` prêtes côté serveur), Suivi/clients, notifications ; industrialiser les types (workspace npm ou artefact codegen) ; migration des données prod.
