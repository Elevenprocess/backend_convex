# Header RDV + Commercial chips dans SplitPanel

**Date** : 2026-05-21
**Repo** : `ECOI_frontend`
**Scope** : `src/components/SplitPanel.tsx`

## Contexte

Le SplitPanel (sidebar dynamique de droite) affiche l'identité du lead en haut : avatar, nom, téléphone, badge status, lien "Fiche →", bouton X.

Aujourd'hui, quand un setter ou admin clique sur un lead qualifié, **il ne voit pas en un coup d'œil** la date du RDV ni le commercial assigné — il doit ouvrir la fiche complète (`/leads/:id`) ou consulter l'onglet RDV du panneau.

## Objectif

Afficher la date+heure du RDV (envoyé à GHL via `createGhlAppointment`) et le nom du commercial assigné **directement dans le header**, à côté du badge de status.

## Conditions d'affichage

**Pas de check sur le status du lead** — condition purement basée sur la présence des données :

| `lead.latestRdvAt` | `lead.latestRdvCommercialId` résolu via userMap | Chips affichés |
|---|---|---|
| ✅ | ✅ | Chip date + chip commercial |
| ✅ | ❌ (null ou inconnu dans userMap) | Chip date seul |
| ❌ | ✅ | Chip commercial seul |
| ❌ | ❌ | Rien (état actuel) |

Conséquence : les leads "déjà qualifié par spécialiste" (status `qualifie` mais `latestRdvAt`/`latestRdvCommercialId` à null car on n'envoie rien à GHL) ne montrent aucun chip extra. Comportement naturel et désirable — l'absence de chips communique implicitement "pas de RDV en BDD".

## Layout

Le header actuel (`src/components/SplitPanel.tsx:95-116`) contient un flex row à la ligne 100-102 :

```tsx
<div className="mt-1 flex items-center gap-2 flex-wrap">
  <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
</div>
```

On ajoute 2 chips conditionnels APRÈS le `status-badge`, dans le même flex row (`flex-wrap` gère naturellement le retour à la ligne si la largeur déborde).

Résultat visuel attendu :

```
[Avatar] Jean Dupont                          Fiche →  ×
         06 12 34 56 78
         [Qualifié] [📅 28/05 14h00] [👤 Stéphane M.]
```

## Format de date

`28/05 14h00` — jour/mois 2 chiffres + heure:minute 2 chiffres, **timezone forcée à `Indian/Reunion`** (le SaaS est utilisé exclusivement à La Réunion ; `latestRdvAt` est stocké en ISO UTC).

```ts
new Date(iso).toLocaleString('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Indian/Reunion',
})
```

Justification timezone explicite : la stack utilise déjà `Indian/Reunion` ailleurs (`SplitPanel.tsx:734` pour les slots GHL, helpers `rdvAtToReunionIso`). On garantit ainsi que la date affichée correspond bien à l'heure du RDV à La Réunion, même si le navigateur est mal configuré (ex: admin connecté depuis France métropole).

## Changements code

Tout dans `src/components/SplitPanel.tsx`.

### 1. Helper `formatRdvDateTime`

Ajouter un helper local en bas du fichier (à côté des autres fonctions utilitaires comme `statusToSetterStatus`). Pattern déjà existant : `LeadDetail.tsx:239`, `AdminPipeline.tsx:462`, `Deliverability.tsx:449` ont chacun leur propre `formatDateTime`. Nous n'introduisons pas de refacto — on suit la convention locale.

```ts
function formatRdvDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Reunion',
  })
}
```

Nom choisi : `formatRdvDateTime` (pas `formatDateTime`) pour éviter une collision si quelqu'un déduplique plus tard les 3 helpers `formatDateTime` éparpillés.

### 2. Résolution du commercial dans le composant `SplitPanel`

Au-dessus du `return` du composant principal, ajouter :

```ts
const commercialName = lead.latestRdvCommercialId
  ? userMap.get(lead.latestRdvCommercialId)?.name ?? null
  : null
```

`userMap` est déjà une prop de `SplitPanel` (passée par `PersistentLeadSidebar.tsx:65`).

### 3. Header — ajouter les 2 chips

Remplacer le bloc actuel (`SplitPanel.tsx:100-102`) :

```tsx
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
          </div>
```

Par :

```tsx
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
            {lead.latestRdvAt && (
              <span className="status-badge bg-cream-darker text-text flex items-center gap-1">
                <Icon name="calendar" size={11} />
                {formatRdvDateTime(lead.latestRdvAt)}
              </span>
            )}
            {commercialName && (
              <span className="status-badge bg-cream-darker text-text flex items-center gap-1">
                <Icon name="users" size={11} />
                {commercialName}
              </span>
            )}
          </div>
```

Style : `status-badge bg-cream-darker text-text` — taille identique au badge de status, fond neutre (cream-darker) pour distinguer du badge sémantique sans introduire une couleur sémantique nouvelle.

## Hors scope

- ❌ **Pas de refactor** des 3 `formatDateTime` dupliqués (LeadDetail, AdminPipeline, Deliverability) — dette existante, pas notre boulot.
- ❌ **Pas de modification** de `CommercialLeadTrackingSidebar.tsx` (qui a déjà son propre affichage RDV à la ligne 114). Le commercial voit déjà ces infos, le besoin est setter/admin.
- ❌ **Pas de tooltip** au survol des chips.
- ❌ **Pas de format long** (jour de semaine, année).
- ❌ **Pas d'action au click** sur les chips (juste affichage).
- ❌ **Pas de gestion du status RDV** (`planifie` / `honore` / `no_show` / `reporte` / `annule`) dans le chip date — on affiche la date brute, peu importe le status du RDV. Si tu veux distinguer plus tard (ex: barrer si annulé), c'est une itération suivante.

## Critères d'acceptation

1. Quand un lead a `latestRdvAt` non null, un chip avec icône calendar et la date formatée apparaît dans le header.
2. Quand un lead a `latestRdvCommercialId` non null ET ce commercial est dans `userMap`, un chip avec icône users et le nom du commercial apparaît.
3. La date est formatée en `JJ/MM HH:MM` (format français) timezone Indian/Reunion.
4. Pour un lead sans RDV (`latestRdvAt` null), aucun chip extra n'apparaît — comportement identique à aujourd'hui.
5. Pour un lead "déjà qualifié par spécialiste" (status `qualifie` sans RDV), aucun chip extra — confirme visuellement qu'il n'y a pas de RDV en BDD.
6. Le wrap visuel fonctionne : si le nom du commercial est long, la rangée de chips wrap proprement.
7. `npm run build` passe (build complet).

## Risques

- **Si un lead a un commercial ID qui n'existe pas dans `userMap`** (ex: user supprimé) → chip commercial caché. Pas d'erreur. C'est OK — moins informatif mais robuste.
- **Si `userMap` n'est pas encore chargée** au premier render (`useUsers()` est async dans `PersistentLeadSidebar`) → `userMap.get(...)` retourne `undefined` → chip pas affiché temporairement, puis apparaît au re-render. UX acceptable.
