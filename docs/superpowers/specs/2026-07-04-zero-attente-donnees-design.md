# Spec — « 0 seconde d'attente » pour les données (frontend)

**Date :** 2026-07-04
**Portée :** `ECOI_frontend` uniquement (aucun changement backend)
**Objectif :** supprimer toute attente perçue sur les données : au premier chargement (app déjà visitée), à la navigation entre pages, et après une action. Sur un appareil vierge (tout premier login), l'attente est minimisée par le préchargement parallèle mais ne peut pas être strictement nulle.

## Contexte / existant

Le système actuel (`src/lib/hooks.ts`) fournit déjà :
- un cache mémoire par `path?query` avec stale-while-refetch (les events realtime marquent stale sans purger) ;
- un partage des requêtes en vol (`inflightRequests`) ;
- une persistance **localStorage** limitée à 5 routes (`/leads`, `/users`, `/analytics/summary`, `/analytics/funnel`, `/ghl-calendar/events`) ;
- un TTL de 10 min qui **supprime** l'entrée expirée → loader plein écran au retour ;
- un warmup uniquement dans Overview (presets analytics) ;
- une coalescence des events socket (~30 s, `realtimeRefreshQueue.ts`) qui retarde aussi le rafraîchissement après une action **locale**.

Quatre trous à combler → quatre chantiers.

## Chantier 1 — TTL non destructif (fondation)

Le TTL ne supprime plus jamais une entrée. Au-delà de `FETCH_CACHE_TTL_MS`, l'entrée est traitée comme `stale` : la donnée est affichée immédiatement et un refetch de fond est déclenché au montage (même mécanique que le stale realtime).

- `readCachedEntry()` : plus de `deleteCache()` sur expiration ; retourne l'entrée avec `stale: true` effectif si `age > TTL`.
- La suppression réelle ne se fait que par la politique de rétention (chantier 2 : âge > 7 jours ou pruning de taille).
- Conséquence : une page déjà visitée n'affiche **plus jamais** un loader plein écran.

## Chantier 2 — Persistance étendue en IndexedDB

Remplacer la persistance localStorage par IndexedDB pour couvrir toutes les routes principales sans plafond de taille (~5 Mo en localStorage).

- **Nouveau module `src/lib/cachePersist.ts`** : ouverture d'une base `velora-cache`, store `fetchCache` (clé = cacheKey, valeur = `FetchCacheEntry`).
- **Lecture synchrone préservée** : le chemin de lecture actuel est synchrone (initialiseur `useState`). On garde la `Map` mémoire comme source unique en lecture ; IndexedDB est **hydratée vers la Map au boot** (dans `main.tsx`, avant `createRoot`, avec un plafond d'attente ~150 ms — au-delà on rend quand même et l'hydratation complète la Map dès qu'elle arrive).
- **Écriture** : `writeCache()` écrit la Map (sync) puis IndexedDB (async, best-effort, débouncée par clé).
- **Couverture** : liste de préfixes élargie — `/leads`, `/clients`, `/users`, `/analytics/`, `/rdv`, `/call-logs`, `/debriefs`, `/finances`, `/acomptes`, `/projects`, `/suivi`, `/notifications`, `/ghl-calendar/events`, `/commercial-objectives`. Exclusions : tout ce qui est binaire ou sensible (`/attachments/*/raw`, `/documents/*/raw`, `/auth`).
- **Rétention** : au boot, purge des entrées de plus de 7 jours ; si le store dépasse ~15 Mo (estimation JSON), purge des plus anciennes.
- **Migration** : au premier boot, relire les anciennes clés localStorage `velora:cache:*` (préfixe actuel) vers IndexedDB puis les supprimer.
- **Sécurité** : à la déconnexion (logout), vider entièrement le store IndexedDB et la Map (les données métier ne survivent pas à un changement d'utilisateur).

## Chantier 3 — Prefetch global au boot

Dès que l'app est montée et l'utilisateur authentifié, précharger en arrière-plan les données de toutes les pages principales, pour que la **première** navigation vers chaque page trouve le cache déjà chaud.

- **Nouveau module `src/lib/prefetch.ts`** avec un registre d'entrées `{ path, query }` reflétant les requêtes **par défaut** de chaque page (Leads, Clients, Suivi, Finances, RDV période courante, users, analytics presets, notifications).
- **Point critique — dérive des clés :** la clé de cache est `path?JSON(query)`. Pour que le prefetch serve réellement les pages, les constructeurs de query par défaut sont **extraits en fonctions partagées** (ex. `defaultLeadsQuery()`, `defaultSuiviQuery()`…) utilisées à la fois par les hooks des pages et par le registre de prefetch. Un test unitaire verrouille l'égalité des clés.
- **Déclenchement** : après le premier paint (`requestIdleCallback` avec fallback `setTimeout ~1 s`), depuis `RootLayout` (zone authentifiée), une seule fois par session.
- **Débit contrôlé** : concurrence max 3 requêtes pour ne pas saturer le backend Render ; ordre de priorité = pages les plus visitées d'abord (Overview → Leads → Suivi → Clients → Finances → RDV → reste).
- **Respect du rôle** : ne précharge que ce que le rôle courant peut voir (ex. pas de `/finances` pour un setter, pas de leads pour un technicien) en réutilisant la même logique de garde que la sidebar (`role.ts` / `navSidebar.ts`).
- Si le cache persistant a déjà une entrée fraîche (< TTL), le prefetch la saute (le `sharedFetch` existant s'en charge déjà via le cache).

## Chantier 4 — Rafraîchissement immédiat après action + patchs optimistes

Deux causes d'attente après une action : (a) la coalescence socket ~30 s s'applique aussi aux actions du même onglet ; (b) aucune mise à jour locale du cache.

- **(a) Bypass local de la coalescence** : après toute mutation réussie (POST/PATCH/DELETE via `api.ts`), émettre immédiatement un `notifyRealtimeRefresh` local avec les préfixes touchés, sans passer par la file coalescée (réservée aux events **distants**). Implémentation : un mapping mutation → préfixes dans `api.ts` ou au niveau des hooks de mutation existants.
- **(b) Patch optimiste ciblé** : helper générique `patchCache(prefix, updater)` qui transforme en place les entrées de cache correspondantes (Map + IndexedDB) et notifie les composants montés. Appliqué d'abord aux flux les plus fréquents :
  - changement de statut / assignation d'un lead (listes `/leads`) ;
  - création / déplacement de RDV (listes `/rdv`, calendrier) ;
  - avancement d'étape suivi (listes `/suivi`) ;
  - enregistrement d'un débrief.
- **Gestion d'erreur** : pas de rollback fin — en cas d'échec de la mutation, on marque les caches touchés stale, on refetch immédiatement et on laisse le toast d'erreur existant informer l'utilisateur. Le refetch réécrit la vérité serveur par-dessus le patch optimiste.

## Flux de données résultant

1. **Boot** : hydratation IndexedDB → Map (≤ 150 ms) → premier paint avec les données de la dernière session → prefetch global en fond → tout se met à jour silencieusement.
2. **Navigation** : toute page lit la Map de façon synchrone → peinture immédiate (donnée fraîche ou stale) → refetch de fond si stale.
3. **Action** : patch optimiste (flux couverts) + refresh immédiat des préfixes touchés → l'UI reflète l'action sans délai perceptible.
4. **Event distant** (autre utilisateur) : inchangé — coalescence 30 s puis stale + refetch de fond.

## Tests & validation

- Tests vitest : TTL non destructif (affiche + refetch au lieu de purger), hydratation IndexedDB (mock `fake-indexeddb`), égalité des clés prefetch/pages, `patchCache`, bypass local de la coalescence.
- Les tests existants (`hooks.realtime-refresh.test.tsx`, `realtimeRefreshQueue.test.ts`) doivent rester verts.
- Validation build : `npx tsc -b` (le build Render rejette ce que `--noEmit` laisse passer).
- Vérification manuelle : naviguer Overview → Leads → Suivi → Finances sans aucun loader plein écran ; recharger l'app → peinture immédiate ; modifier un lead → liste à jour instantanément.

## Hors périmètre

- Aucun changement backend (endpoints, cache serveur, sockets inchangés).
- Pas de bascule Convex (reconstruction parallèle, cible long terme).
- Pas de service worker / mode hors-ligne complet.
- Le tout premier login d'un appareil vierge garde une attente réseau incompressible (atténuée par le prefetch parallèle et les skeletons existants).
