# Page projet — glisser-déposer sur les uploads de fichiers

Date : 2026-06-03
Périmètre : frontend uniquement (`ECOI_frontend`). Aucun changement backend.

## Problème

Les 3 zones d'upload de la page projet (`ProjectDetailView`) — onglets **Devis**,
**Photos**, **Documents** — n'acceptent aujourd'hui que le **clic** (label en
pointillés enveloppant un `<input type="file">` caché). Il n'y a pas de
glisser-déposer. Les trois zones dupliquent quasiment le même markup.

## Objectif

Ajouter le **glisser-déposer** aux 3 zones, en factorisant un composant
réutilisable. Comportement et visuel homogènes ; le clic reste fonctionnel.

Hors périmètre : upload de devis du `CommercialLeadPanel` (hors page projet),
modifications backend, barre de progression d'upload, dépôt de dossiers
(directories).

## Décisions validées

- **Composant partagé** `FileDropzone` branché dans les 3 onglets (pas de
  duplication, pas de hook seul).
- **Comportement miroir de l'existant** : zones mono-fichier (Devis, Documents) →
  on prend le 1er fichier déposé ; mauvais type → même validation/erreur qu'avec
  l'input actuel (PDF pour Devis, image pour Photos ; Documents accepte tout).

## Architecture

### Nouveau : `src/components/FileDropzone.tsx`

Composant à responsabilité unique : rendre la zone de dépôt et signaler les
fichiers choisis (par clic ou par drop). Il ne fait **aucun** appel réseau — il
délègue l'upload via `onFiles`.

**Interface**
```ts
type FileDropzoneProps = {
  id: string                          // id de l'input (htmlFor du label)
  title: string                       // libellé principal (état repos)
  subtitle: string                    // sous-libellé (état repos)
  onFiles: (files: File[]) => void    // appelé au clic-sélection ET au drop
  accept?: string                     // transmis à l'input (filtre le sélecteur OS)
  multiple?: boolean                  // transmis à l'input ; défaut false
  uploading?: boolean                 // true → Spinner + « Upload en cours… », drop ignoré
}
```

**Rendu**
- `<label htmlFor={id}>` stylé « air » (pointillés, token `or`, **sans dégradé**),
  enveloppant `<input id={id} type="file" className="hidden" accept multiple>`.
- L'`onChange` de l'input appelle `onFiles(Array.from(e.target.files ?? []))` puis
  remet `e.target.value = ''` (permet de re-sélectionner le même fichier).
- État repos : `title` + `subtitle`. État `uploading` : `<Spinner size={14} />` +
  « Upload en cours… » (markup commun, supprime la duplication actuelle).

**Drag & drop** (handlers sur le `<label>`)
- `onDragEnter` / `onDragOver` : `e.preventDefault()` (obligatoire pour autoriser le
  drop) + marque l'état survol.
- Anti-clignotement : un **compteur** en `useRef` incrémenté à `dragEnter`,
  décrémenté à `dragLeave` ; `isDragging = compteur > 0`. (Les `dragenter`/`leave`
  des enfants ne réinitialisent donc pas l'état par erreur.)
- `onDrop` : `e.preventDefault()`, remet le compteur à 0 et `isDragging=false`, puis
  si `!uploading` appelle `onFiles(Array.from(e.dataTransfer.files))`.
- Si `uploading`, le drop est ignoré (pas d'appel `onFiles`).

**Visuel en survol de dépôt** (`isDragging`) : surbrillance renforcée
(`border-or bg-or-tint`) et sous-titre remplacé par « Déposez ici ». Pas de dégradé.

### Branchement des 3 onglets (`src/components/leads/project/`)

- **`ProjectDevisTab.tsx`** : remplace le label/input manuel par
  `<FileDropzone id={`devis-upload-${project.id}`} accept="application/pdf"
  uploading={uploading} title="Déposer un devis Solteo (PDF)"
  subtitle="L'IA analysera automatiquement le PDF."
  onFiles={(f) => { if (f[0]) void handleFile(f[0]) }} />`. `handleFile` (validation
  PDF incluse) inchangé.
- **`ProjectDocumentsTab.tsx`** : idem, `onFiles={(f) => { if (f[0]) void
  handleFile(f[0]) }}`, sans `accept`. Le champ « Étiquette » reste **au-dessus** de
  la zone. `handleFile` inchangé.
- **`ProjectPhotosTab.tsx`** : `multiple accept="image/*"`,
  `onFiles={(f) => void handleFiles(f)}`. `handleFiles` est adapté pour prendre
  `File[]` au lieu de `FileList | null` ; la validation image par fichier est
  conservée à l'identique.

## Cas limites (miroir de l'existant)

- Le drop **contourne `accept`** côté navigateur ; c'est la validation par fichier
  déjà présente (PDF/devis, image/photos) qui filtre. Documents accepte tout type.
- Zone mono-fichier + plusieurs fichiers déposés → on prend `f[0]`.
- `uploading` actif → clic désactivé (input `disabled`) **et** drop ignoré.

## Tests

Test unitaire `src/components/FileDropzone.test.tsx` (Vitest + @testing-library) :
- Rend `title` et `subtitle` au repos.
- `fireEvent.drop` avec un `dataTransfer.files` factice → `onFiles` appelé avec les
  fichiers (en `File[]`).
- `fireEvent.dragEnter`/`dragOver` → l'état survol s'affiche (« Déposez ici ») ;
  `fireEvent.dragLeave` → retour à l'état repos.
- `uploading` → affiche « Upload en cours… » et un `drop` n'appelle **pas** `onFiles`.
- `onChange` de l'input → `onFiles` reçoit bien un `File[]`.

Vérification manuelle : sur chaque onglet, glisser un fichier depuis le bureau →
surbrillance puis upload ; vérifier le rejet d'un mauvais type (non-PDF sur Devis,
non-image sur Photos).
