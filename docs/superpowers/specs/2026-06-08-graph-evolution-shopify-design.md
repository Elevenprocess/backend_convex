# Refonte du graphique « Évolution » façon Shopify

Date : 2026-06-08
Composant : `LeadEvolutionChart` (`src/pages/Overview.tsx`)
Statut : design validé, à implémenter

## Problème

Le graphique d'évolution (SVG custom, sans librairie) souffre de deux défauts :

1. **Axe X piloté par l'index, pas par le temps.** `xFor(index)` répartit les N points
   existants sur toute la largeur du graphe. Conséquence : quand seules 2 heures de la
   journée ont des données, la courbe devient une diagonale d'un bord à l'autre, au lieu de
   refléter la vraie position temporelle des points.
2. **Aucune notion de « maintenant » ni d'espace futur.** Rien n'évoque le temps réel : pas
   de pointe « live », pas d'espace réservé à droite qui se remplit au fil de la journée.

## Objectif

Reproduire le ressenti des graphes analytics de Shopify :

- la courbe est **ancrée au temps réel**, occupe la partie écoulée de la plage et laisse du
  vide à droite qui se remplit à mesure que de nouvelles données arrivent ;
- les **labels d'axe X s'adaptent à la plage** choisie (heures / jours / semaines / mois)
  indépendamment du nombre de points de données ;
- une **pointe « live » animée** au bout de la courbe.

Aucun changement backend. Tout se joue dans `Overview.tsx` + quelques classes CSS.

## 1. Axe X piloté par le temps

### Timestamp par point

`LeadEvolutionPoint` gagne un champ numérique `t` (timestamp ms) :

- granularité `hour` : `t = new Date(`${date}T${String(hour).padStart(2,'0')}:00:00`).getTime()`
  (l'heure est aujourd'hui encodée dans `key`/`label` de `distributeTotalsAcrossHours` ;
  on la conserve explicitement pour calculer `t`).
- granularités `day` / `week` / `month` : `t = new Date(`${date}T12:00:00`).getTime()`
  (midi pour éviter les effets de fuseau).

### Domaine temporel `[start, end]`

Calculé une fois par rendu, selon la granularité et `range` (`FunnelPeriodRange`,
champs `from` / `to`) :

| Granularité | start                              | end                                |
| ----------- | ---------------------------------- | ---------------------------------- |
| `hour`      | 8h du jour de la plage             | 21h du même jour                   |
| `day`       | `startOfDay(range.from)`           | `endOfDay(range.to)`               |
| `week`      | `startOfWeek(range.from)`          | `endOfWeek(range.to)`              |
| `month`     | 1er jour du mois de `range.from`   | dernier jour du mois de `range.to` |

La fenêtre `hour` est fixée à **8h–21h** (cohérent avec le filtre existant
`point.hour >= 8 && point.hour <= 21` dans `buildLeadEvolutionPoints`). Cette fenêtre
constante est le choix retenu (pas d'heure de fermeture dynamique).

### Projection X

`xFor` devient une fonction du temps, pas de l'index :

```
xFor(t) = padX + ((t - start) / (end - start)) * chartWidth
```

Garde-fous :

- si `end === start` (cas dégénéré 1 seul instant), placer au centre comme aujourd'hui ;
- `t` est borné à `[start, end]` avant projection (clamp) pour absorber d'éventuels points
  hors plage.

La courbe (`currentPath`), l'aire (`areaPath`) et la ligne de comparaison utilisent toutes
`xFor(point.t)`. L'aire se referme verticalement sous **le premier et le dernier point réel**
(pas sous `start`/`end` du domaine), pour que le remplissage suive la courbe et laisse le
futur vide.

### Effet attendu

Un point à 9h sur une fenêtre 8h–21h se place à ~8 % de la largeur. Deux points (9h, 10h)
forment un court segment en bas à gauche, plus une diagonale plein cadre. L'espace à droite
reste vide et se remplit au fil des heures.

## 2. Labels d'axe X générés depuis le domaine

Les labels ne sont plus dérivés des points de données (`safePoints[index].label`) mais
**générés à intervalles réguliers sur le domaine** (≈ 5–6 graduations) :

- `hour` : graduations toutes les ~3h → `8h 11h 14h 17h 20h` (format `${h}h`).
- `day` : une graduation par jour si ≤ 7 jours, sinon échantillonné → `lun mar mer …`
  (via `dayLabel`).
- `week` : `sem. JJ/MM` par graduation (via `formatDayMonth`).
- `month` : `formatMonthLabel` par graduation.

Chaque graduation est un instant `tick` du domaine ; sa position X = `xFor(tick)`. Ainsi
changer la plage change l'échelle de temps affichée, que les données soient denses ou non.
`textAnchor` : `start` pour la première graduation, `end` pour la dernière, `middle` sinon.

## 3. Pointe « live » animée

Sur le **dernier point réel** de la série active (`safePoints[last]`), 4 effets combinés,
en CSS animations pures (pas de lib, pas de JS d'animation). Une `key` React dérivée de la
plage + granularité est posée sur le `<svg>` (ou le groupe animé) pour **rejouer** les
animations à chaque changement de plage.

1. **Tracé animé** : la `<path>` de la ligne utilise `stroke-dasharray` /
   `stroke-dashoffset` animé de « plein » → 0, remplissage gauche→droite à l'apparition.
2. **Montée des valeurs** : un `<g>` englobant aire + ligne reçoit une animation
   `transform: scaleY(0→1)` avec `transform-origin` en bas (`y = height - padBottom`),
   donnant l'impression que la courbe « monte » du sol.
3. **Point live pulsant** : un `<circle>` sur la pointe avec animation `scale` + `opacity`
   en boucle (respiration continue).
4. **Halo / glow + trait montant** : un second `<circle>` halo dégradé sous le point +
   un court `<line>` vertical lumineux partant de la pointe vers le haut, dont l'opacité
   pulse et s'estompe (le « petit trait qui remonte au bout »).

Respect de `prefers-reduced-motion` : les animations en boucle (pulsation, halo) sont
désactivées sous cette préférence ; le tracé/montée se contentent de l'état final.

### Classes CSS à ajouter (feuille de style du composant)

- `.lead-evolution-line--draw` (dasharray draw-on)
- `.lead-evolution-rise` (scaleY group)
- `.lead-evolution-live-dot` (pulsation)
- `.lead-evolution-live-halo` (halo)
- `.lead-evolution-live-spark` (trait vertical montant)
- `@keyframes` associés + bloc `@media (prefers-reduced-motion: reduce)`.

## Hors périmètre (YAGNI)

- Pas de migration vers une librairie de charting.
- Pas de polling temps-réel ajouté : la pointe « live » est le dernier point des données
  déjà chargées ; le rafraîchissement reste celui des hooks existants.
- Pas de modification de `FuturisticLineChart` ni de `Heatline`.
- Heure de fenêtre `hour` laissée fixe à 8h–21h (pas d'heure d'ouverture/fermeture configurable).

## Tests

Le composant est purement présentationnel (SVG dérivé de props). Vérifications visées :

- typecheck / build : `npm run build` (le `tsc -b` refuse les imports/vars inutilisés).
- test unitaire ciblé `vitest` possible sur les helpers extraits (domaine + génération de
  graduations) : pour une fenêtre `hour` avec 2 points (9h, 10h), vérifier que `xFor(t)`
  place bien les points dans la première moitié gauche et que les graduations couvrent
  8h→21h. (DB non requise, jsdom.)
