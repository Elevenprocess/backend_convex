# Coloration des cartes RDV dans le calendrier (admin + commercial_lead)

Date : 2026-06-10
Statut : validé (design), prêt pour plan d'implémentation

## Objectif

Dans la page calendrier RDV (`/rdv`, `RdvCalendar.tsx`), colorer le fond des
cartes de RDV **ECOI locales** selon l'état du RDV, en teintes légères, pour que
l'admin et le commercial_lead repèrent d'un coup d'œil les RDV à débriefer, ceux
avec un devis en attente, etc.

Quatre couleurs demandées :

- 🟢 **Vert** — débrief fait.
- ⬜ **Blanc** — RDV à venir.
- 🟡 **Jaune** — devis en attente.
- 🔴 **Rouge** — RDV passé sans débrief.

## Périmètre

- S'applique **uniquement** aux cartes RDV **locales** (source `local`) rendues
  par `RdvBlock` (vue semaine/jour) et `RdvButton` (vue mois) dans
  `src/pages/rdv/RdvCalendar.tsx`.
- Les événements **GHL** et **VT** (visites techniques) conservent leur style
  actuel (`vtKindTone`, tone GHL).
- La coloration n'est active que pour les rôles **`admin`** et
  **`commercial_lead`**. Pour tout autre rôle voyant le calendrier (setter,
  setter_lead, délivrabilité, …), les cartes locales gardent le rendu neutre
  actuel (`CARD_TONE = bg-cream-darker`).
- Pour mémoire : le rôle `commercial` individuel n'a plus accès à `/rdv`
  (changement précédent), il n'est donc pas concerné.

## Arbre de décision (premier cas qui matche)

Entrée : un `RdvResponse` local + l'instant courant `now`.

1. `hasDevisEnAttente === true` → **`devis`** (🟡 jaune) — prioritaire sur le vert.
2. `debriefFilledAt != null` → **`debrief`** (🟢 vert).
3. `status ∈ { 'no_show', 'annule', 'reporte' }` → **`autre`** (⚪ gris neutre).
4. `scheduledAt >= now` (planifié à venir) → **`avenir`** (⬜ blanc).
5. sinon (passé, sans débrief, sans devis en attente) → **`absent`** (🔴 rouge).

Notes :

- La priorité jaune > vert reflète qu'un devis en attente est une action plus
  urgente que « débrief fait ».
- `no_show` / `annulé` / `reporté` sont volontairement neutres (gris), hors des
  quatre couleurs métier.
- Comparaison de dates en ISO (lexicographique), cohérente avec le reste de la
  base de code (`scheduledAt` est un ISO string).

## Couleurs (teintes légères, design system existant)

| Catégorie | Fond | Variable CSS | Bordure |
|---|---|---|---|
| `devis` (jaune) | `#F5EBD0` | `--color-cuivre-tint` | `--color-cuivre` |
| `debrief` (vert) | `#E0F1E6` | `--color-success-tint` | `--color-success` |
| `avenir` (blanc) | `#FFFFFF` | blanc | `--color-line` |
| `absent` (rouge) | `#F3DDC8` | `--color-rouille-tint` | `--color-rouille` |
| `autre` (gris) | `#EEF2EF` | `--color-info-tint` | `--color-line` |

Bordures et texte gardés sobres pour rester « léger ».

## Données : flag `hasDevisEnAttente` (approche A)

Le « devis en attente » correspond au **vrai statut** `Devis.status === 'en_attente'`
(entité `devis` liée au RDV par `rdvId`), pas à un proxy.

Comme le calendrier charge déjà les RDV via `useRdvList`, on enrichit la réponse
RDV d'un booléen plutôt que de faire des requêtes devis séparées :

- **Backend** (`ECOI_backend`) :
  - `rdv.findAll` (`src/modules/rdv/rdv.service.ts`) : ajouter une expression
    SQL `EXISTS (SELECT 1 FROM devis WHERE devis.rdv_id = rdv.id AND devis.status
    = 'en_attente' AND devis.deleted_at IS NULL)` projetée en colonne booléenne.
    Index présents : `devis_rdv_idx`, `devis_status_idx` → requête efficace.
  - `toRdvResponse` (`src/modules/rdv/dto/rdv-response.dto.ts`) : exposer
    `hasDevisEnAttente: boolean` (défaut `false` si non fourni).
- **Frontend** (`ECOI_frontend`) :
  - `RdvResponse` (`src/lib/types.ts`) : ajouter `hasDevisEnAttente: boolean`.

Hypothèse à vérifier à l'implémentation : nom exact de la colonne `deleted_at`
sur `devis` (soft-delete). Si `devis` n'a pas de soft-delete, retirer la clause.

## Structure technique (frontend)

- **Fonction pure** `rdvCardCategory(rdv: RdvResponse, now: string): RdvCardCategory`
  où `RdvCardCategory = 'devis' | 'debrief' | 'avenir' | 'absent' | 'autre'`.
  Implémente l'arbre de décision ci-dessus. Placée dans un module dédié
  (`src/pages/rdv/rdvCardCategory.ts`) pour test unitaire isolé.
- **Mapping catégorie → classe** : `rdv-card--devis|debrief|avenir|absent|autre`.
- **Application** dans `RdvBlock` et `RdvButton` : pour un RDV `source === 'local'`
  **et** rôle ∈ { admin, commercial_lead }, remplacer `CARD_TONE` par la classe
  de catégorie ; sinon comportement inchangé. Le rôle est lu via `useAuth`/`useRole`.
- **CSS** (`src/index.css`, section « Calendrier RDV ») : 5 variantes
  `.rdv-card--<cat>` (fond + bordure légère), appliquées aussi sur `.rdv-block`
  (vue mois). Hover conservé.
- **Légende** : petit bandeau discret dans l'en-tête du calendrier listant les
  quatre couleurs métier (jaune/vert/blanc/rouge) avec leur libellé. Affichée
  uniquement quand la coloration est active (admin / commercial_lead).

## Tests

- **Unitaire (TDD)** sur `rdvCardCategory` : un cas par branche de l'arbre
  (devis en attente prioritaire sur débrief fait ; débrief fait ; no_show/annulé/
  reporté → autre ; futur → avenir ; passé sans débrief → absent ; frontière
  `scheduledAt === now`).
- **Composant** : vérifier qu'un RDV local reçoit la bonne classe pour un rôle
  admin/commercial_lead, et le rendu neutre pour un autre rôle ; que GHL/VT ne
  sont pas affectés. (Sur le modèle des tests `RdvCalendar.*.test.tsx` existants.)
- Backend : la DB de test étant indisponible, valider la requête `EXISTS` par
  revue + typecheck ; pas de test d'intégration DB dans ce lot.

## Hors périmètre

- Pas de changement du feed de données GHL/VT.
- Pas de nouvel endpoint devis (approche B écartée).
- Pas de re-style des badges de statut existants.
