# Bouton "Déjà qualifié par un spécialiste"

**Date** : 2026-05-21
**Repo** : `ECOI_frontend`
**Scope** : `src/components/SplitPanel.tsx`

## Contexte

Des spécialistes ECOI appellent parfois des leads **directement depuis GHL**, sans passer par le SaaS. Quand un setter rappelle ensuite un lead pour le qualifier, le lead peut répondre : "j'ai déjà eu un RDV avec un spécialiste".

Aujourd'hui, le setter n'a aucun bouton pour gérer ce cas proprement. Le bouton "Qualifié" actuel pousse le lead vers le flux complet (secteur + date RDV + `createGhlAppointment`) — ce qui créerait un **doublon** dans GHL puisque le spécialiste y a déjà géré.

## Objectif

Ajouter une 4ème option de qualification setter qui marque le lead comme `qualifie` dans la BDD SaaS **sans aucun appel à GHL et sans créer de RDV local**.

## Comportement utilisateur

L'écran d'appel setter (`SplitPanel.tsx`, étape "appel") affiche aujourd'hui 3 boutons en première ligne :

```
[À rappeler] [Pas de réponse] [Pas qualifié]
```

On ajoute un **4ème bouton** :

```
[À rappeler] [Pas de réponse] [Pas qualifié] [Déjà qualifié par spécialiste]
```

- **Icône** : `check-circle`
- **Titre** : "Déjà qualifié par spécialiste"
- **Sous-titre** : "Commentaire obligatoire"

Quand cliqué :
1. Affiche un `<textarea>` avec placeholder "Le lead dit avoir déjà eu un RDV avec un spécialiste. Précise lequel / quand si possible."
2. Le commentaire est **obligatoire** (validation identique à `non_qualifie`).
3. Le bouton **Valider** apparaît une fois le commentaire saisi.

## Effets de Valider

| Effet | Valeur |
|---|---|
| `createCallLog` | `result: 'joint'`, `notes: <commentaire>` |
| `updateLead` status | `'qualifie'` |
| GHL appointment | **AUCUN** (`createGhlAppointment` non appelé) |
| GHL stage update | **AUCUN** |
| RDV local | **AUCUN** (`createRdv` non appelé) |
| Message succès | "Lead marqué qualifié (RDV déjà géré par un spécialiste sur GHL)." |
| Step suivant | `'done'` |

## Changements code

Tout dans `src/components/SplitPanel.tsx`.

### 1. Étendre l'union `SetterStatus` (ligne ~693)

```ts
type SetterStatus = '' | 'non_qualifie' | 'a_rappeler' | 'pas_de_reponse' | 'qualifie' | 'qualifie_specialiste'
```

### 2. Ajouter le 4ème `<StatusChoice>` (ligne ~968)

Après le `<StatusChoice>` "Pas qualifié" :

```tsx
<StatusChoice
  active={setterStatus === 'qualifie_specialiste'}
  icon="check-circle"
  title="Déjà qualifié par spécialiste"
  text="Commentaire obligatoire"
  onClick={() => { setSetterStatus('qualifie_specialiste'); setResult('joint') }}
/>
```

### 3. Ajouter le bloc commentaire (ligne ~984, après le bloc `non_qualifie`)

```tsx
{setterStatus === 'qualifie_specialiste' && (
  <textarea
    className="..."  // même classes que le textarea non_qualifie
    placeholder="Le lead dit avoir déjà eu un RDV avec un spécialiste. Précise lequel / quand si possible."
    value={commentaire}
    onChange={(e) => setCommentaire(e.target.value)}
  />
)}
```

### 4. Branche `qualifie_specialiste` dans `saveCallAndLead` (ligne ~822)

Après la branche `a_rappeler`, avant le `else` final :

```ts
} else if (kind === 'qualifie_specialiste') {
  if (!commentaire.trim()) throw new Error('Ajoute un commentaire expliquant que le lead a déjà été qualifié par un spécialiste.')
  await createCallLog({ leadId: lead.id, result: 'joint', notes: commentaire })
  await updateLead(lead.id, { status: 'qualifie' })
  setResult('')
  setSuccess('Lead marqué qualifié (RDV déjà géré par un spécialiste sur GHL).')
  setStep('done')
}
```

### 5. Inclure dans la condition du bouton Valider (ligne ~993)

```tsx
{(setterStatus === 'a_rappeler' || setterStatus === 'pas_de_reponse' || setterStatus === 'non_qualifie' || setterStatus === 'qualifie_specialiste') && (
  <Button onClick={() => saveCallAndLead(setterStatus)}>...</Button>
)}
```

### 6. `statusToSetterStatus` (ligne ~1529)

**Pas de changement** — un lead avec `status === 'qualifie'` reste mappé sur `'qualifie'` (cas par défaut). On ne peut pas distinguer après coup un lead qualifié par flux normal vs par spécialiste à partir du `LeadStatus` seul.

## Hors scope

- ❌ **Pas de nouveau `LeadStatus`** backend — réutilise `'qualifie'` existant.
- ❌ **Pas de flag/colonne dédiée** dans la table `leads`. Traçabilité = call log notes.
- ❌ **Pas de filtre dédié** dans `LeadsList` / `LeadsSplit`.
- ❌ **Pas de label/badge spécifique** dans la liste — affichage identique à un "Qualifié" classique.
- ❌ **Pas de changement backend** — toutes les API utilisées (`createCallLog`, `updateLead`) existent déjà.

Si un besoin futur de distinguer ces leads dans listes/analytics émerge, prévoir une seconde itération avec ajout d'un champ backend (`qualifiedBySpecialist: boolean` ou enum dédié).

## Critères d'acceptation

1. Le 4ème bouton apparaît dans la première ligne de StatusChoice de l'étape appel.
2. Cliquer dessus affiche le textarea commentaire.
3. Sans commentaire, le clic sur Valider produit une erreur claire.
4. Avec commentaire, Valider :
   - Crée un call log avec `result: 'joint'` et `notes` = commentaire saisi
   - Met à jour le lead avec `status: 'qualifie'`
   - **N'appelle PAS** `createGhlAppointment` ni `createRdv`
   - Affiche le message succès
   - Passe à `step: 'done'`
5. Le lead apparaît bien comme "Qualifié" dans LeadsList après l'action.
6. `npm run build` passe sans erreur TS (build complet, pas juste `tsc --noEmit`).

## Risques

- **Risque de doublon avec le bouton "Qualifié" classique** si un setter mal formé clique sur le mauvais bouton → un RDV est créé dans GHL alors qu'il existe déjà. Mitigation : libellé clair "Déjà qualifié par spécialiste" et formation setters.
- **Pas de garde-fou côté backend** — n'importe quel client peut envoyer `updateLead({ status: 'qualifie' })` sans créer de RDV. C'est déjà le cas aujourd'hui, ce n'est pas régressif.
