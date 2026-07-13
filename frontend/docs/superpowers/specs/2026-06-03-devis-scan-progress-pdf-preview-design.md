# Devis — progression de scan OCR + aperçu PDF

Date : 2026-06-03
Périmètre : frontend uniquement (`ECOI_frontend`). Aucun changement backend ni de schéma.

## Problème

À l'upload d'un devis PDF, l'OCR (Gemini 2.5 Flash, appel unique, *fire-and-forget*
côté backend) tourne plusieurs secondes. Pendant ce temps, `DevisCard`
(`src/components/devis/DevisList.tsx`) rend déjà sa mise en page complète mais avec
des champs vides (`—`) et le **nom de fichier brut** de stockage — ce que
l'utilisateur perçoit comme « un PDF vide avec des caractères bizarres ».

De plus, le PDF d'origine n'est aujourd'hui **pas consultable** depuis l'interface
(seul un téléchargement existe via `/devis/:id/pdf`).

## Objectifs

1. Pendant le scan (`ocrStatus ∈ {pending, processing}`) : remplacer le rendu cassé
   par un **état de chargement propre avec un anneau de progression** affichant un
   **pourcentage simulé**.
2. Une fois le scan terminé (`done`) : afficher la carte normale + un bouton
   **« Voir le PDF »** qui ouvre le PDF d'origine dans une **modale plein écran**.

Hors périmètre : vraie progression backend (SSE / découpe en pages), modifications
du moteur OCR, aperçu côté-à-côté PDF/données.

## Décisions validées

- **Pourcentage simulé** (pas de vraie progression backend) — l'OCR est un appel
  Gemini unique, il n'existe pas de signal de progression granulaire.
- **Affichage du PDF en modale** au clic (pas d'aperçu inline permanent).
- **Tout passe par `DevisCard`** (composant partagé) → toutes les vues listant des
  devis sont couvertes automatiquement.

## Architecture

Trois unités, chacune à responsabilité unique :

### 1. `DevisScanLoader.tsx` (nouveau — `src/components/devis/`)
- **Rôle** : afficher l'état « scan en cours » à la place du corps de carte.
- **Props** : `devis` (ou au minimum `{ ocrStatus, filename }`).
- **Rendu** : anneau de progression SVG avec le pourcentage simulé au centre +
  libellé « Analyse du devis en cours… ». Pas de nom de fichier brut affiché.
- **Style** : langage « air » (à plat, moderne), tokens `or` / `stone`,
  **aucun dégradé de couleur**.
- **Dépendances** : la fonction pure `progress()` (ci-dessous) ; un `setInterval`
  local (~250 ms) pour faire monter le pourcentage.

### 2. `PdfPreviewModal.tsx` (nouveau — `src/components/devis/`)
- **Rôle** : afficher le PDF d'origine en modale.
- **Props** : `devisId`, `filename?`, `onClose`.
- **Rendu** : overlay plein écran + `iframe` dont la `src` est un **object URL**.
- **Source du PDF** : récupère le **blob** via la route `/devis/:id/pdf`
  (binaire renvoyé directement → pas d'URL signée `file://` bloquée en dev), puis
  `URL.createObjectURL`. L'object URL est **révoqué** à la fermeture / au démontage.
- **Fermeture** : bouton ✕, clic sur le fond, touche `Échap`.
- **États** : chargement (spinner pendant le fetch du blob), erreur (message + ✕).

### 3. `DevisCard` (modif — `src/components/devis/DevisList.tsx`)
- Branche en tête de rendu : si `ocrStatus ∈ {pending, processing}` →
  `<DevisScanLoader devis={d} />` à l'intérieur du `<li>` (le polling existant
  alimente déjà `d` jusqu'à `done`/`failed`).
- `failed` : comportement actuel inchangé (carte + erreur OCR + bouton
  « Relancer OCR »).
- `done` : carte complète actuelle + nouveau bouton **« Voir le PDF »** dans le
  footer, qui ouvre `PdfPreviewModal` (état local `showPdf`).

### 4. API (`src/lib/api.ts`)
- Nouvelle fonction `fetchDevisPdfObjectUrl(devisId): Promise<string>` qui récupère
  le blob du PDF et renvoie un object URL (réutilise le fetch de `downloadDevisPdf`
  sans forcer le téléchargement). `downloadDevisPdf` reste inchangée.

## Progression simulée

Fonction **pure** et testable, ex. dans `DevisScanLoader.tsx` (ou un petit module
voisin) :

```
progress(elapsedMs) = min(CEIL, 100 * (1 - exp(-elapsedMs / TAU)))
```

- `CEIL ≈ 92` (%) : plafond tant que l'OCR n'est pas fini (évite de « mentir » à 100 %).
- `TAU ≈ 6000` (ms) : montée rapide au début puis ralentissement.
- Transition finale : quand `ocrStatus` passe `done`, animation rapide jusqu'à
  100 % (~400 ms) puis la carte bascule sur le rendu normal.

## Flux des états

| `ocrStatus`            | Rendu de `DevisCard`                                   |
|------------------------|--------------------------------------------------------|
| `pending` / `processing` | `DevisScanLoader` (anneau + % simulé)                |
| `done`                 | Carte complète + bouton « Voir le PDF » (→ modale)     |
| `failed`               | Carte + erreur OCR + bouton « Relancer OCR » (inchangé)|

Le polling existant (toutes les 2,5 s, plafond ~100 s) reste la source de vérité du
changement de statut ; aucun nouveau mécanisme de polling.

## Gestion des erreurs

- Échec OCR : déjà couvert (état `failed`).
- Échec de récupération du PDF dans la modale : message d'erreur + fermeture
  possible ; l'object URL (s'il existe) est révoqué.
- Plafond de polling atteint sans résolution : le loader reste affiché (statut
  toujours `processing`) — comportement de secours acceptable, identique à l'actuel.

## Tests

- **Unitaire** : `progress()` — monotone croissante, ≤ `CEIL`, 0 à `elapsed = 0`,
  tend vers `CEIL`. (Pure, déterministe.)
- **Vérification manuelle** : uploader un PDF, observer l'anneau monter pendant le
  scan, puis la carte + bouton « Voir le PDF » → ouverture/fermeture de la modale.
  Vérifier en dev (storage local) que le PDF s'affiche bien (route blob, pas `file://`).
