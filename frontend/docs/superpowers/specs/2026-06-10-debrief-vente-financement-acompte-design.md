# Débrief vente — kits en tags, date auto, financement + acompte

Date : 2026-06-10
Périmètre : ECOI_frontend (wizard `CommercialDebriefSidebar`) + ECOI_backend (persistance debriefs)

## Contexte

L'étape « Vente signée » du wizard de débrief (`Step4VDetails` dans
`ECOI_frontend/src/components/leads/CommercialDebriefSidebar.tsx`) capture
aujourd'hui : montant du devis, date de signature, kits (texte libre), et un
type de paiement (3 pills `comptant` / `financement` / `paiement_10x` mappés
directement sur l'enum `financing_type`).

On remplace cette étape par une saisie plus riche : date auto, kits en tags,
et un bloc financement à choix en cascade avec calcul d'acompte.

## Changements UI (frontend)

### Date de signature
- Champ **supprimé** de l'UI.
- `signedAt` est rempli automatiquement avec **la date du jour** (date du
  débrief), au format `YYYY-MM-DD`, au moment de l'init du formulaire.
- Reste envoyé au backend comme aujourd'hui.

### Kits vendus — saisie par tags
- Le champ texte unique devient une **saisie par étiquettes** :
  - un input + bouton « Ajouter » (Entrée valide aussi) ;
  - chaque ajout crée une étiquette supprimable (croix) ;
  - les étiquettes s'affichent côte à côte et passent à la ligne (wrap).
- **Au moins 1 kit requis** pour valider l'étape.
- Pas de liste prédéfinie, pas de section « Autres » séparée : texte libre.
- Stockage : étiquettes jointes en une chaîne dans la colonne `kits`
  existante (séparateur ` · `). Pas de migration sur ce champ. Au rechargement
  d'un débrief existant, la chaîne est re-découpée sur le séparateur pour
  reconstituer les étiquettes.

### Financement (remplace « Type de paiement »)

Choix de la **méthode** (4 pills) :
`Comptant` · `Financement` · `Paiement 10x` · `Paiement 12x`.

Puis sous-section conditionnelle selon la méthode :

| Méthode        | Sous-choix                        | Options d'acompte             |
|----------------|-----------------------------------|-------------------------------|
| Comptant       | Chèque / Espèces / Virement       | 40 % · 30 % · montant direct  |
| Financement    | Organisme : CMOI / Sofider        | 30 % · 20 % · montant direct  |
| Paiement 10x   | Chèque / Espèces / Virement       | 30 % · montant direct         |
| Paiement 12x   | Chèque / Espèces / Virement       | 30 % · montant direct         |

- Le **montant du devis saisi en haut est le TTC**.
- L'**acompte calculé** s'affiche en direct sous les boutons d'acompte :
  `montantDevisTTC × pourcentage`, ex. *« Acompte : 12 000 € TTC »*.
- Si l'utilisateur choisit « montant direct », il saisit lui-même le montant
  d'acompte en € (et aucun pourcentage n'est retenu).

### Validation / bouton Continuer
Le bouton **Continuer** de l'étape `details_v` reste désactivé tant que tout
n'est pas renseigné :
- montant du devis (TTC) > 0 ;
- au moins 1 kit ;
- méthode de paiement choisie ;
- sous-choix selon la méthode (sous-méthode chèque/espèces/virement, ou
  organisme CMOI/Sofider) ;
- acompte renseigné : soit un pourcentage sélectionné, soit un montant direct
  > 0.

## Persistance (backend)

### Nouvelles colonnes sur la table `debriefs`
- `payment_sub_method` (text, nullable) — `cheque` | `especes` | `virement`
  (renseigné pour comptant, 10x, 12x ; null pour financement).
- `financing_org` (text, nullable) — `cmoi` | `sofider` (renseigné pour
  financement ; null sinon).
- `acompte_percent` (integer, nullable) — pourcentage retenu (40, 30, 20) ;
  null si montant direct.
- `acompte_amount` (numeric, nullable) — montant d'acompte en €, **toujours
  persisté** : valeur calculée (devis × %) si pourcentage, ou valeur saisie si
  montant direct.

### Enum
- Ajout de la valeur `paiement_12x` à l'enum `financing_type`
  (`comptant` / `financement` / `financement_sans_apport` /
  `apport_financement` / `paiement_10x` / **`paiement_12x`**).
- Les valeurs `financement_sans_apport` et `apport_financement` ne sont plus
  proposées dans l'UI mais restent dans l'enum (données historiques).

### Migration
Migration Drizzle (nouveau fichier `0013_*`) appliquée via le **cron job
postgres jetable sur Render** (port 5432 sortant bloqué, DB de test indispo —
cf. mémoire). Preuve d'application par code de sortie du job.

### DTO / types
- `create-debrief.dto.ts` : ajouter `paymentSubMethod`, `financingOrg`,
  `acomptePercent`, `acompteAmount` (tous optionnels, validés Zod).
- `ECOI_frontend/src/lib/types.ts` : étendre `DebriefResponse` et les payloads
  d'API avec les nouveaux champs ; ajouter `paiement_12x` à `FinancingType` ;
  labels pour sous-méthode et organisme.
- `api.ts` : `createDebrief` / `createLeadDebrief` transmettent les nouveaux
  champs.

### Affichage
- Le récapitulatif du wizard (cartes) et `DebriefCard` affichent un résumé
  compact du financement, ex. *« Comptant · virement · acompte 40 % = 12 000 € »*.
- Pas de nouveau graphe analytics dans ce lot (persistance seulement ;
  l'exploitation analytics pourra venir ensuite).

## Hors périmètre (YAGNI)
- Pas de liste de kits prédéfinie / structurée.
- Pas de nouvel écran ou graphe d'analytics dédié au financement.
- Pas de suppression des valeurs d'enum obsolètes.

## Tests
- Frontend : logique pure de calcul d'acompte (devis × % et montant direct),
  validation `details_v` (continue activé/désactivé selon les champs),
  round-trip des kits (join/split).
- Backend : `debriefs.service.spec.ts` — persistance des nouveaux champs ;
  DTO Zod (valeurs valides/invalides pour sous-méthode, organisme, acompte).
