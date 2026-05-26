# Wizard step-by-step pour le débrief commercial

**Date** : 2026-05-26
**Repo** : `ECOI_frontend`
**Scope** : `src/components/leads/CommercialDebriefSidebar.tsx` (refonte complète, fichier unique)

## Contexte

Le `CommercialDebriefSidebar` actuel est une sidebar single-page scrollable où **tout est affiché en cascade** : résultat → raison → sous-cas chips → commentaire libre → objection → facteurs d'acceptation → détails vente → notes. Le commercial scrolle pour remplir.

Ce format a deux défauts :
1. **Mauvaise logique conditionnelle** — l'étape "Objection non surmontée" s'affiche pour TOUTES les raisons de non-vente, alors qu'elle n'a de sens que quand le contact était signable.
2. **Surcharge visuelle** — sous-cas chips + commentaire par raison alourdissent un formulaire de débrief rapide. Mario veut un parcours plus simple, proche du survey GHL [Wqx8zen5v0OMsyEYEHPZ](https://api.leadconnectorhq.com/widget/survey/Wqx8zen5v0OMsyEYEHPZ?notrack=true) que les commerciaux utilisent déjà sur d'autres canaux.

## Objectif

Refondre la sidebar en **wizard step-by-step** (un écran par question, navigation Continuer/Retour, progress dots), avec une logique conditionnelle plus stricte et un contenu allégé. Zéro impact backend.

## Décisions verrouillées (questions Mario, 2026-05-26)

| Décision | Choix |
|---|---|
| Pattern navigation | Wizard step-by-step style GHL (un écran à la fois, gros boutons, Continuer/Retour) |
| Objection non surmontée pour "Non Qualifié" | **Supprimée** — Non qualifié ≠ objection ratée (déviation explicite vs GHL) |
| Facteurs d'acceptation (Vente) | **Conservés** — étape dédiée (préserve `DebriefAnalytics`) |
| Sous-cas chips (Non-vente) | **Supprimés** (9 chips × 6 raisons = 54 options retirées) |
| Commentaire libre par raison (Non-vente) | **Supprimé** (fusionné dans le champ Notes final) |

## Logique conditionnelle (wireflow)

```
                         ┌─────────────────────────────┐
                         │  Step 1 — RÉSULTAT          │
                         │  [Vente] [Non-vente]        │
                         └────┬─────────────────┬──────┘
                              │                 │
                  Vente ──────┘                 └────── Non-vente
                              │                              │
        ┌─────────────────────▼─────┐         ┌──────────────▼──────────────┐
        │ Step 2V — OBJECTION       │         │ Step 2NV — RAISON           │
        │ surmontée (radio 6 opts)  │         │ (radio 6 opts)              │
        └─────────────────────┬─────┘         └──────────────┬──────────────┘
                              │                              │
        ┌─────────────────────▼─────┐                ┌───────┴────────┐
        │ Step 3V — ACCEPTATION     │     Suivi      │  Non qual.     │ No-show
        │ (multi, 10 opts)          │     prévu      │  Cont. annulé  │ Pas intéressé
        └─────────────────────┬─────┘                │  Annul. admin  │
                              │                     ▼                ▼
        ┌─────────────────────▼─────┐    ┌─────────────────┐
        │ Step 4V — DÉTAILS VENTE   │    │ Step 3NV-A — OBJ│
        │ Devis € / Date / Kits     │    │ non surmontée   │
        │ / Paiement                │    │ (radio 6 opts)  │
        └─────────────────────┬─────┘    └────────┬────────┘
                              │                   │
        ┌─────────────────────▼───────────────────▼─────┐
        │ Step final — NOTES (optionnel) + Submit       │
        └────────────────────────────────────────────────┘
```

**Total steps par branche :**
- **Vente** → 5 steps (Résultat → Objection → Acceptation → Détails → Notes)
- **Non-vente / Suivi prévu** → 4 steps (Résultat → Raison → Objection → Notes)
- **Non-vente / Non qualifié | No-show | Contact annulé | Annulation admin | Pas intéressé** → 3 steps (Résultat → Raison → Notes)

## Spec par step

Tous les steps héritent du même chrome : header sticky (nom lead + badge status + bouton X), progress dots, footer sticky (Retour / Continuer).

### Step 1 — Résultat (toutes branches)

- **Label** : "Résultat de l'appel"
- **Type** : 2 ChoicePill côte à côte (1 colonne large × 2)
  - `vente` — icon `check`, tone `success`, label "Vente réalisée"
  - `non_vente` — icon `x`, tone `rouille`, label "Vente non réalisée"
- **Required** : oui
- **Validation Continuer** : `form.outcome !== ''`
- **Reset cascade** : si l'user revient ici et change la valeur, **tous les champs des steps suivants sont reset** (sinon données fantômes incohérentes)

### Step 2V — Objection surmontée (branche Vente)

- **Label** : "Quelle objection avez-vous surmontée ?"
- **Type** : 6 ChoiceChip en grid 2 colonnes (mêmes 6 valeurs que sidebar actuel : argent, logistique, partenaire, peur, ecran_de_fumee, pas_objection — avec leur hint actuel)
- **Required** : non (peut être laissée vide → `null` en BDD)
- **Validation Continuer** : toujours active

### Step 3V — Facteurs d'acceptation (branche Vente)

- **Label** : "Facteurs d'acceptation"
- **Sublabel** : "Sélection multiple — pourquoi le prospect a dit oui."
- **Type** : 10 ChoiceChip en grid 2 colonnes (mêmes 10 valeurs que sidebar actuel : prix_convenable, confiance_commercial, roi_rapide, garanties, recommandation, batterie_autonomie, financement_attractif, aides_etat, engagement_ecolo, autre)
- **Required** : non
- **Validation Continuer** : toujours active

### Step 4V — Détails vente (branche Vente)

- **Label** : "Détails de la signature"
- **Champs** (tous sur le même step, layout vertical) :
  - Valeur devis signé (€) — `number`, `inputMode=decimal`, `min=0`, `step=0.01` — **required**
  - Date signature — `date` — **required**
  - Kits vendus — `text`, placeholder "Ex. : 8 PV + 1 onduleur + 1 batterie 5 kWh" — **required**
  - Type paiement — 4 ChoiceChip grid 2 colonnes (comptant, financement_sans_apport, apport_financement, paiement_10x) — **required**
- **Validation Continuer** : `quoteAmount && signedAt && kits && paymentMethod` tous non vides

### Step 2NV — Raison non-vente (branche Non-vente)

- **Label** : "Raison de la non-vente"
- **Type** : 6 ChoiceChip en grid 2 colonnes (mêmes 6 valeurs : suivi_prevu, non_qualifie, no_show, contact_annule, annulation_administrative, pas_interesse — avec leur hint actuel)
- **Required** : oui
- **Validation Continuer** : `form.nonSaleReason !== ''`
- **Aiguillage** : la valeur choisie détermine la branche suivante (voir wireflow)

### Step 3NV-A — Objection non surmontée (Non-vente / Suivi prévu uniquement)

- **Label** : "Quelle objection n'avez-vous pas pu surmonter ?"
- **Type** : 6 ChoiceChip grid 2 colonnes (mêmes 6 que Step 2V)
- **Required** : non
- **Validation Continuer** : toujours active
- **Skip** : si `nonSaleReason ∈ {non_qualifie, no_show, contact_annule, annulation_administrative, pas_interesse}`, ce step **n'apparaît pas** dans la séquence (le total de steps diminue, les progress dots reflètent)

### Step final — Notes + Submit (toutes branches)

- **Label** : "Notes supplémentaires"
- **Sublabel** dépend du contexte (placeholder dynamique comme aujourd'hui : `notesPlaceholder(form)`)
- **Type** : `AutoGrowTextarea` (`minRows=4`, `maxRows=20`)
- **Required** : non
- **Bouton** : "Enregistrer le débrief" au lieu de "Continuer". Vert (`bg-text text-white`) si tout requis OK, désactivé sinon.
- **Affichage erreur / succès** : juste au-dessus du bouton, comme aujourd'hui

## Mécanique navigation

### Progress dots dynamiques

Affichés en haut, juste sous le nom du lead. Le nombre total dépend de la branche :
- Vente → 5 dots
- Non-vente / Suivi prévu → 4 dots
- Non-vente / autres raisons → 3 dots

Format : `● ● ○ ○ ○   Étape 2 sur 5`. Dots remplis = steps passés ou actuel ; vides = à venir.

Le total est recalculé à chaque changement de `outcome` ou `nonSaleReason` (steps cachés ne comptent pas).

### Boutons

- **Retour** : visible dès Step 2. Pas d'animation de submit, juste change le step actif.
- **Continuer** : visible du Step 1 au step avant-dernier. Désactivé si la validation du step actuel échoue.
- **Enregistrer le débrief** : visible uniquement sur le step final. Vert. Désactivé pendant `saving=true` ou impersonation read-only.

### Animation transition

Slide horizontal `translateX` + fade :
- Continuer → step entre par la droite, step sortant glisse à gauche
- Retour → inverse
- Durée : 220ms, easing `cubic-bezier(0.22, 1, 0.36, 1)`
- Implémentation : container `overflow-hidden`, inner `flex` avec `translate-x-[-stepIndex*100%]`, `transition-transform`. Pas besoin de lib externe (Framer Motion absent du projet, on garde pur CSS).

### Reset cascade

Quand l'user revient en arrière et change un champ d'aiguillage :
- Step 1 (`outcome`) modifié → reset tous les champs des steps 2+ (`nonSaleReason`, `objection`, `acceptanceFactors`, `quoteAmount`, `signedAt`, `kits`, `paymentMethod`, `notes` **conservées**)
- Step 2NV (`nonSaleReason`) modifié → reset `objection` si on quitte la branche `suivi_prevu`

Notes ne sont jamais reset (saisie commune à toutes les branches).

### Validation finale (`canSubmit`)

Identique à aujourd'hui :
- `outcome === 'vente'` → `quoteAmount && signedAt && kits && paymentMethod`
- `outcome === 'non_vente'` → `nonSaleReason !== ''`

Mais comme les validations par step interdisent déjà d'avancer sans remplir, le step final n'aura `canSubmit=false` que dans des cas pathologiques (data corrompue, state désynchronisé).

## Backward compatibility

### Lecture des RDV déjà débriefés

Quand `selectedRdv` change, `rdvToForm` parse l'état existant pour pré-remplir le wizard. Mapping inchangé pour les champs gardés :

- `rdv.result === 'signe'` → `outcome='vente'`, sinon `outcome='non_vente'`
- `rdv.nonSaleReason` parsé via `splitNonSaleReason()` — **on garde uniquement la partie main**, la partie sub-reason (après ` — ` séparateur) **est ignorée** (perdue au prochain save)
- `rdv.notes` parsé via `splitNotes()` :
  - `[Acceptation: ...]` → rechargé dans `acceptanceFactors`
  - `[Précision: ...]` → **fusionné dans `form.notes`** sous forme `Précision : <contenu>\n\n<rest>` (préfixe visible et éditable, comme ça le commercial voit ce qui a été ajouté par l'ancien format et peut l'effacer/garder librement)
  - reste → `form.notes`

### Écriture (`handleSubmit` → `updateRdv`)

Payload identique à aujourd'hui. `composeNotes()` reste simple :
- Vente avec facteurs → `[Acceptation: f1 | f2 | ...]\n<freeText>`
- Sinon → `<freeText>` directement (plus de `[Précision: ...]`)

`composeNonSaleReason()` simplifié : juste retourner le label de la raison (plus de séparateur ` — sub`).

### Quel step ouvrir au reload ?

Quand l'user rouvre une sidebar sur un RDV déjà débriefé, le wizard **démarre au Step 1** (état rempli mais affiché en wizard du début). Justification : si le commercial ouvre pour vérifier, il peut Continuer rapidement (chaque step est déjà validé) ; si il veut éditer, il a le contexte complet.

Alternative rejetée : démarrer au step final. Risque de perdre le contexte des steps intermédiaires.

## Storage (zéro impact backend)

| Champ DB | Source wizard | Note |
|---|---|---|
| `result` | `outcomeToResult(outcome, nonSaleReason)` | Mapping inchangé |
| `nonSaleReason` | `labelFromNonSaleReason(nonSaleReason)` | Plus de suffixe ` — sub-cas` |
| `objections` | `labelFromObjection(objection)` ou `null` | Inchangé |
| `notes` | `composeNotes(form)` | Plus de `[Précision: ...]`. `[Acceptation: ...]` conservé |
| `montantTotal` | `form.quoteAmount` (Vente) ou `null` | Inchangé |
| `signatureAt` | `form.signedAt` (Vente) ou `null` | Inchangé |
| `kits` | `form.kits` (Vente) ou `null` | Inchangé |
| `financingType` | `form.paymentMethod` (Vente) ou `null` | Inchangé |
| `debriefFilledAt` | `new Date().toISOString()` | Inchangé |

**Schéma Drizzle inchangé. Pas de migration. Endpoint `PATCH /rdv/:id` inchangé.**

## Out of scope

- **Modification de `DebriefModal.tsx`** (page `/rdv/:id`) — c'est un autre point d'entrée du débrief, on le laisse tel quel pour cette itération. Si la migration vers wizard convient sur la sidebar, on portera ensuite.
- **Création d'un composant `Wizard` réutilisable** — on garde le wizard inline dans `CommercialDebriefSidebar.tsx` cette itération. Si on extrait plus tard pour `DebriefModal`, ce sera un refactor séparé.
- **Modification du backend** ou du schéma DB.
- **Migration des anciens RDV** (purge des préfixes legacy dans `notes` / cleanup des sous-raisons). Les anciens débriefs gardent leur format ; les nouveaux écrits via le wizard utilisent le format simplifié.
- **Analytics nouveau** — `DebriefAnalytics` reste tel quel, continue à parser `[Acceptation: ...]`.

## Fichiers impactés

| Fichier | Type changement |
|---|---|
| `src/components/leads/CommercialDebriefSidebar.tsx` | Refonte complète (composant principal + helpers internes) |

Aucun autre fichier touché. `useRdvList`, `updateRdv`, `DebriefAnalytics`, types `RdvResponse`/`FinancingType` — inchangés.

## Critères d'acceptation

1. Sur un lead sans RDV, le sidebar affiche `EmptyDebrief` (comportement actuel préservé)
2. Sur un lead avec ≥1 RDV, le wizard démarre au Step 1 "Résultat"
3. Choix "Vente" → 5 steps successifs, le bouton final est "Enregistrer le débrief"
4. Choix "Non-vente" + "Suivi prévu" → 4 steps
5. Choix "Non-vente" + "Non qualifié" → 3 steps (pas d'étape objection)
6. Progress dots reflètent le total correct et le step actif
7. Retour en arrière permet de modifier sans perte de saisie sur les steps non touchés ; changement d'`outcome` reset les steps de la branche abandonnée
8. Animation slide horizontale visible entre steps (220ms)
9. Re-ouverture d'un RDV déjà débriefé : le wizard pré-remplit tous les champs récupérables ; le user peut Continuer rapidement jusqu'à la fin
10. Submit envoie exactement le même payload qu'aujourd'hui (`PATCH /rdv/:id` avec result/nonSaleReason/objections/notes/montantTotal/signatureAt/kits/financingType/debriefFilledAt)
11. `DebriefAnalytics` continue d'afficher le donut des facteurs d'acceptation pour les nouveaux débriefs Vente
12. Impersonation read-only désactive le bouton final (comportement actuel préservé)
