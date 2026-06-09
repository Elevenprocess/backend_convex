# Agenda RDV — filtres secteur + commercial

Date : 2026-06-09

## Problème
L'agenda `/rdv` (`RdvCalendar`) affiche RDV locaux + événements GHL + VT sans aucun
filtre. Les secteurs ne sont qu'une **légende** colorée. Besoin : filtrer par
commercial, et rendre les secteurs réellement filtrables.

## Mapping « commercial » par source d'événement
- RDV local → `rdv.commercialId`
- Événement GHL → `event.assignedToId`
- VT → `null` (pas de commercial)

Noms résolus via `useUsers()` (rôles `commercial` + `commercial_lead`), triés par nom.

## État (dans `RdvCalendar`)
- `selectedSectors: Set<Sector>` — vide = tous
- `selectedCommercials: Set<string>` (userId) — vide = tous

Non persisté (réinitialisé au rechargement).

## Règle de filtrage (pure, testable — `src/lib/calendarFilters.ts`)
Un item est visible si **les deux** passent :
- **secteur** : `sectors` vide **OU** `sectorOf(item)` ∈ `sectors`
- **commercial** : `commercials` vide **OU** `commercialOf(item) === null` **OU**
  `commercialOf(item)` ∈ `commercials`

→ les VT et GHL non assignés (commercial `null`) restent toujours visibles.

## UI
La ligne « Légende secteur » devient une ligne « Filtres » :
- Secteurs : les 5 pastilles deviennent des puces cliquables (toggle). Couleur conservée.
- Commerciaux : bouton « Commerciaux ▾ » ouvrant un popover de cases à cocher +
  « Tout effacer ». Le bouton affiche le compte sélectionné.
- Lien « Réinitialiser » si au moins un filtre actif.

Les deux filtres sont visibles pour tous les rôles (comme la légende actuelle).

## Tests (TDD)
Fonction pure `matchesCalendarFilters(sector, commercialId, state)` :
secteur seul, commercial seul, combiné, item sans commercial toujours visible,
sélections vides = tout passe.

## Hors scope
Persistance, filtre setter/technicien.
