# Refonte dashboard commercial — liste "à débriefer" + double camembert

**Date** : 2026-05-26
**Repo** : `ECOI_frontend`
**Scope** : `src/pages/Overview.tsx` (composant `OverviewCommercial`), création de `src/components/analytics/DonutChart.tsx` et `src/components/analytics/debrief-aggregations.ts`

## Contexte

Le dashboard commercial actuel (`OverviewCommercial` dans `src/pages/Overview.tsx`) affiche sous le hero + KPIs row :
1. Une carte large **"Évolution CA"** (RevenueEvolutionChart) — CA signé par mois en line chart
2. Une carte side **"Closing 100%"** — stat de closing rate avec sous-texte "5 ventes, 0 perdus, 0 en réflexion"

Mario veut remplacer ces deux cartes par du contenu plus actionnable pour le commercial connecté :
- À la place du card "Closing" : une **liste des RDV honorés non débriefés** (qu'il doit traiter en priorité)
- À la place du card "Évolution CA" : **deux camemberts** — raisons de non-vente + facteurs d'acceptation (déjà capturés par le nouveau wizard de débrief)

Le reste du dashboard (hero, KPIs row, Pipeline, RDV à venir, Actions) ne bouge pas.

## Objectif

Donner au commercial une vue immédiatement actionnable au lieu d'un graphique historique : ce qu'il doit faire **maintenant** (débrief en attente) + le pattern de ses ventes/non-ventes (pourquoi ça signe / pourquoi ça rate).

## Décisions verrouillées (questions Mario, 2026-05-26)

| Décision | Choix |
|---|---|
| Source de la liste à la place du card Closing | **RDV à débriefer** uniquement (`status='honore'` + `debriefFilledAt IS NULL`) |
| Filtre de la liste | Commercial connecté **+ période active du dashboard** |
| Camembert "qualifié" (le deuxième) | **Facteurs d'acceptation** (10 options multi-select), pas objections surmontées |

## Section 1 — Card "Mes RDV à débriefer" (remplace Closing)

### Position

Remplace la carte `<div className="overview-air-card overview-role-side"> ... Closing ... </div>` actuellement aux lignes 393-400 de `Overview.tsx`. Conserve les classes `overview-air-card overview-role-side` pour rester dans la même grille.

### Source de données

Filtre sur le `rdvs` déjà fetché ligne 241 (`useRdvList({ commercialId: me?.id, fromDate: commercialRange.from, toDate: commercialRange.to, limit: 200 })`) — **aucun nouveau fetch** :

```ts
const toDebrief = rdvs
  .filter((r) => r.status === 'honore' && !r.debriefFilledAt)
  .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()) // plus ancien en premier
```

### Format

- **Header** : titre "À débriefer" + count badge à droite (ex. `8`)
- **Liste** : max 10 visibles (`toDebrief.slice(0, 10)`)
  - Chaque ligne : initiales (avatar carré) + nom complet du lead + date RDV formatée (`21/05 14h00`, via `shortDateTime`) + chip lieu (Domicile / Agence / Visio)
  - Clic sur ligne → `navigate('/leads/' + leadId)` (la page lead détail expose déjà le wizard débrief sidebar shipped précédemment)
- **Footer si > 10** : "+ N autres" en texte gris + bouton "Voir tous →" → `navigate('/rdv')` (la page `/rdv` filtre déjà par commercial connecté, plus filtre `to-debrief` à ajouter en query param si besoin — voir Out of scope)
- **Footer si ≤ 10** : juste "Voir tous →" si > 0 RDV
- **Empty state** : icône check vert + texte "Tous tes RDV honorés sont débriefés. Bien joué."

### Nom du lead

Le `RdvResponse` ne contient pas le nom du lead nativement — il a `leadId`. Mais le wizard montre déjà `fullName(lead)` via une jointure côté frontend. Approche dans le dashboard :

```ts
// Approche : fetch leads list (déjà disponible via useLeads ailleurs dans Overview ?
// Vérifier — si useLeads est déjà appelé dans OverviewCommercial, juste mapper rdv.leadId → lead.firstName/lastName)
```

Vérification nécessaire à l'implémentation : si `useLeads` n'est pas déjà appelé dans `OverviewCommercial`, l'ajouter avec scope minimal (`useLeads({ limit: 500 })`). Sinon réutiliser. Si la jointure côté frontend devient coûteuse → fallback : afficher `leadId.slice(0, 8)` ou un placeholder "Lead #abc1234" et déférer l'enrichissement à un endpoint backend ultérieur (Out of scope ici).

## Section 2 — Card double camembert (remplace Évolution CA)

### Position

Remplace la carte `<div className="overview-air-card overview-role-wide overview-revenue-evolution-card"> <RevenueEvolutionChart ... /> </div>` actuellement aux lignes 389-391. Conserve les classes `overview-air-card overview-role-wide`.

### Layout interne

Deux sous-camemberts côte-à-côte (grid 2 colonnes sur >= md, stack vertical sur mobile) :

```
┌────────────────────────── overview-air-card overview-role-wide ─────────────────────────┐
│  ┌──────────────────────────────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Raisons de non-vente                 │  │ Facteurs d'acceptation                   │ │
│  │ 12 non-ventes                        │  │ 8 ventes                                 │ │
│  │                                      │  │                                          │ │
│  │   ◐ donut + center label             │  │   ◐ donut + center label                 │ │
│  │                                      │  │                                          │ │
│  │ ● Suivi prévu     5 (42%)           │  │ ● Prix convenable     6 (75%)            │ │
│  │ ● No-show          4 (33%)          │  │ ● ROI rapide          5 (62%)            │ │
│  │ ● Non qualifié    2 (17%)           │  │ ● Garanties           3 (38%)            │ │
│  │ ● Pas intéressé    1  (8%)          │  │ ...                                      │ │
│  └──────────────────────────────────────┘  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Camembert gauche — "Raisons de non-vente"

- **Source** : `rdvs.filter(r => r.result && r.result !== 'signe')` du `rdvs` déjà fetché (même filtre `commercialId + période` que la liste à débriefer)
- **Parsing** : `parseDebrief()` (existant dans `DebriefAnalytics.tsx`) extrait `reasonMain` depuis `rdv.nonSaleReason`
- **Agrégation** : `aggregateNonValidation(parsed)` (existant) renvoie `[{ main: string, count: number, subs: ... }, ...]`
- **Header** : titre "Raisons de non-vente" + count `${totalNonVentes} non-vente${s}`
- **Donut** : 6 segments max (les 6 raisons canoniques du wizard), couleurs depuis `PALETTE` (existant)
- **Center label** : nombre absolu + "non-ventes"
- **Légende latérale ou sous le donut** (selon largeur) : nom raison + count + `(${Math.round(count/total*100)}%)`
- **Empty state** : "Aucune non-vente sur la période."

### Camembert droit — "Facteurs d'acceptation"

- **Source** : `rdvs.filter(r => r.result === 'signe')` du même `rdvs`
- **Parsing** : `parseDebrief()` extrait `acceptance: string[]` depuis le préfixe `[Acceptation: ...]` dans `rdv.notes`
- **Agrégation** : `aggregateAcceptance(parsed)` (existant) renvoie `[{ label, count }, ...]` triée desc
- **Header** : titre "Facteurs d'acceptation" + count `${totalVentes} vente${s}`
- **Donut** : 10 segments max, couleurs depuis `PALETTE`
- **Center label** : nombre absolu + "ventes signées" (les ventes avec ≥1 facteur enregistré)
- **Particularité multi-select** : un RDV peut contribuer à plusieurs segments. Les `count` somment > `totalVentes`. Le pourcentage affiché est sur les **ventes signées** (`count / totalVentes`), pas sur la somme des counts. Donc la somme des % peut dépasser 100% — c'est attendu et le tooltip/légende doit le clarifier ("X% des ventes signées ont mentionné ce facteur").
- **Empty state** : "Aucun facteur d'acceptation enregistré."

### Réutilisation

Le composant `DonutChart` existe déjà dans `DebriefAnalytics.tsx` lignes ~159-245. Il accepte :
```ts
type DonutChartProps = {
  segments: { label: string; value: number; color: string }[]
  total: number
  centerLabel: string
  onSegmentClick?: (label: string) => void
  activeLabel?: string | null
}
```

**Extraction** : déplacer `DonutChart` dans un nouveau fichier `src/components/analytics/DonutChart.tsx` exporté. `DebriefAnalytics.tsx` continue de l'importer depuis là.

Idem pour les helpers `parseDebrief`, `aggregateNonValidation`, `aggregateAcceptance`, `PALETTE`, `ACCEPTANCE_PREFIX_RE`, `NON_SALE_REASON_SEPARATOR`, et le type `ParsedDebrief` — extraits dans `src/components/analytics/debrief-aggregations.ts`.

Le dashboard commercial importe `DonutChart` + les helpers depuis ces 2 nouveaux modules.

## Données — pas de nouveau fetch

- `rdvs` déjà fetché par `useRdvList` ligne 241 → réutilisé pour la liste ET les camemberts
- `me.id` déjà disponible (`useAuth`)
- `commercialRange` déjà calculé
- **Si besoin du nom du lead** : ajouter `useLeads({ limit: 500 })` dans `OverviewCommercial` (s'il n'y est pas déjà). Vérifier à l'implémentation.

## Storage / API impact

**Zéro impact backend.** Aucun nouvel endpoint. Aucune migration. La parsing des `[Acceptation: ...]` et `nonSaleReason` réutilise le même format que le wizard shipped.

## Out of scope

- **Query param `?filter=to-debrief` sur `/rdv`** : le bouton "Voir tous →" navigue vers `/rdv` mais le filtre serveur sur "à débriefer" reste à câbler si Mario veut une expérience plus fine. Pour cette itération, `/rdv` affiche déjà tous les RDV du commercial — l'user peut tri/filtrer manuellement.
- **Sparkline ou drill-down par segment du camembert** : on garde simple (clic affiche peut-être une expansion légère type `expandedReason` comme dans `DebriefAnalytics`). Pas de modal détail dans cette itération.
- **Évolution temporelle des camemberts** : pas de comparaison période N vs N-1. Juste les valeurs courantes.
- **Suppression de `RevenueEvolutionChart`** : on garde le composant en code (utilisé peut-être ailleurs — vérifier à l'implémentation). On remplace juste son usage dans `OverviewCommercial`. Si plus aucun usage → cleanup au cas suivant.
- **Modification du dashboard admin ou setter** : ce spec ne concerne QUE `OverviewCommercial`.

## Fichiers impactés

| Fichier | Type changement |
|---|---|
| `src/pages/Overview.tsx` | Modifier `OverviewCommercial` (lignes 380-400 environ) — remplace 2 cards par liste + double camembert |
| `src/components/analytics/DonutChart.tsx` | **Nouveau** — extrait depuis `DebriefAnalytics.tsx` |
| `src/components/analytics/debrief-aggregations.ts` | **Nouveau** — extrait des helpers (parseDebrief, aggregateNonValidation, aggregateAcceptance, PALETTE, ParsedDebrief, regex constants) |
| `src/components/analytics/DebriefAnalytics.tsx` | Refactor — importe depuis les 2 nouveaux modules, ne contient plus que la composition spécifique à la page Analytics |

## Critères d'acceptation

1. ✅ Le card "À débriefer" remplace le card "Closing" à la même position
2. ✅ Le card double camembert remplace le card "Évolution CA" à la même position
3. ✅ Liste filtrée : `status='honore' && !debriefFilledAt`, commercial connecté, période active, max 10 visibles, tri ancien→récent
4. ✅ Liste empty state affiché si aucun RDV à débriefer
5. ✅ Clic sur ligne → navigue vers `/leads/<leadId>`
6. ✅ Camembert gauche : 6 segments max (raisons de non-vente du wizard), centre = total non-ventes
7. ✅ Camembert droit : 10 segments max (facteurs d'acceptation), centre = total ventes signées avec ≥1 facteur
8. ✅ Légendes affichent count + % (sur le total des ventes/non-ventes, pas sur la somme des counts pour le multi-select)
9. ✅ Empty states sur les 2 camemberts si aucune donnée
10. ✅ Aucun nouveau fetch API (réutilise `useRdvList` ligne 241)
11. ✅ `DonutChart` extrait et utilisé par `DebriefAnalytics` + `OverviewCommercial`
12. ✅ Aucune régression sur le reste du dashboard commercial (hero, KPIs, Pipeline, RDV à venir, Actions)
13. ✅ `DebriefAnalytics` (page Analytics) continue de fonctionner identiquement
