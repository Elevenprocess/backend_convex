# Page projet — glisser-déposer sur les uploads — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter le glisser-déposer aux 3 zones d'upload de la page projet (Devis, Photos, Documents) via un composant réutilisable `FileDropzone`, le clic restant fonctionnel.

**Architecture:** Un nouveau composant `FileDropzone` encapsule le label pointillé + input caché + handlers drag/drop + état de survol, et délègue les fichiers via `onFiles(File[])`. Les 3 onglets l'utilisent en passant leur handler d'upload existant. Aucun appel réseau dans le composant ; aucun changement backend.

**Tech Stack:** React + TypeScript, Vite, Tailwind v4 (tokens `or`/`line`/`stone`, sans dégradé), Vitest 3 + @testing-library/react.

**Spec :** `docs/superpowers/specs/2026-06-03-project-upload-drag-drop-design.md`

---

## Structure des fichiers

- **Créer** `src/components/FileDropzone.tsx` — zone d'upload réutilisable (clic + drag&drop).
- **Créer** `src/components/FileDropzone.test.tsx` — tests unitaires.
- **Modifier** `src/components/leads/project/ProjectDevisTab.tsx` — utiliser FileDropzone.
- **Modifier** `src/components/leads/project/ProjectDocumentsTab.tsx` — utiliser FileDropzone.
- **Modifier** `src/components/leads/project/ProjectPhotosTab.tsx` — utiliser FileDropzone (handler adapté à `File[]`).

Note : les onglets n'ont pas de tests de rendu aujourd'hui et l'ajout de tests complets (mock api lourd) serait disproportionné. Le comportement drag/drop est couvert par le test unitaire de `FileDropzone` (Task 1) ; les tâches de branchement sont vérifiées par le typecheck (`npm run build`) + lint + vérif manuelle.

---

## Task 1: Composant `FileDropzone`

**Files:**
- Create: `src/components/FileDropzone.tsx`
- Test: `src/components/FileDropzone.test.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

```tsx
// src/components/FileDropzone.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileDropzone } from './FileDropzone'

function makeFile(name = 'a.pdf', type = 'application/pdf') {
  return new File(['x'], name, { type })
}

describe('FileDropzone', () => {
  it('affiche le titre et le sous-titre au repos', () => {
    render(<FileDropzone id="z" title="Déposer un fichier" subtitle="PDF, etc." onFiles={vi.fn()} />)
    expect(screen.getByText('Déposer un fichier')).toBeTruthy()
    expect(screen.getByText('PDF, etc.')).toBeTruthy()
  })

  it('appelle onFiles avec les fichiers déposés', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileDropzone id="z" title="T" subtitle="S" onFiles={onFiles} />)
    const label = container.querySelector('label')!
    const file = makeFile()
    fireEvent.drop(label, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0][0]).toEqual([file])
  })

  it('montre « Déposez ici » au survol puis revient au repos', () => {
    const { container } = render(<FileDropzone id="z" title="T" subtitle="Sous-titre repos" onFiles={vi.fn()} />)
    const label = container.querySelector('label')!
    fireEvent.dragEnter(label, { dataTransfer: { files: [] } })
    expect(screen.getByText('Déposez ici')).toBeTruthy()
    fireEvent.dragLeave(label, { dataTransfer: { files: [] } })
    expect(screen.getByText('Sous-titre repos')).toBeTruthy()
  })

  it('en upload : affiche le spinner et ignore le drop', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileDropzone id="z" title="T" subtitle="S" uploading onFiles={onFiles} />)
    expect(screen.getByText(/Upload en cours/i)).toBeTruthy()
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: { files: [makeFile()] } })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('onChange de l’input transmet un File[]', () => {
    const onFiles = vi.fn()
    const { container } = render(<FileDropzone id="z" title="T" subtitle="S" onFiles={onFiles} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = makeFile('b.png', 'image/png')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/components/FileDropzone.test.tsx`
Expected: FAIL — `Failed to resolve import './FileDropzone'`.

- [ ] **Step 3: Écrire l'implémentation**

```tsx
// src/components/FileDropzone.tsx
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Spinner } from './Spinner'

type FileDropzoneProps = {
  id: string
  title: string
  subtitle: string
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  uploading?: boolean
}

/**
 * Zone d'upload réutilisable : clic (label + input caché) OU glisser-déposer.
 * Ne fait aucun appel réseau — délègue les fichiers via onFiles. Style « air »,
 * tokens or/line, sans dégradé.
 */
export function FileDropzone({
  id,
  title,
  subtitle,
  onFiles,
  accept,
  multiple = false,
  uploading = false,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  // Compteur anti-clignotement : les dragenter/leave des enfants ne doivent pas
  // réinitialiser l'état de survol.
  const dragDepth = useRef(0)

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault() // obligatoire pour autoriser le drop
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setIsDragging(false)
    }
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (uploading) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  return (
    <label
      htmlFor={id}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`block rounded-2xl border-2 border-dashed px-6 py-5 text-center cursor-pointer transition-colors ${
        isDragging
          ? 'border-or bg-or-tint'
          : uploading
            ? 'border-or bg-or/10'
            : 'border-line bg-white/40 hover:bg-white/70'
      }`}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {uploading ? (
        <div className="inline-flex items-center gap-2 text-or-dark text-sm font-bold">
          <Spinner size={14} /> Upload en cours…
        </div>
      ) : (
        <div>
          <div className="font-bold text-sm text-text">{title}</div>
          <div className="text-[12px] text-muted mt-1">{isDragging ? 'Déposez ici' : subtitle}</div>
        </div>
      )}
    </label>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd "ECOI_frontend" && npx vitest run src/components/FileDropzone.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/FileDropzone.tsx src/components/FileDropzone.test.tsx
git commit -m "feat(ui): composant FileDropzone (clic + glisser-déposer)"
```

---

## Task 2: Brancher `ProjectDevisTab`

**Files:**
- Modify: `src/components/leads/project/ProjectDevisTab.tsx`

- [ ] **Step 1: Remplacer l'import Spinner par FileDropzone**

Le fichier importe actuellement (ligne 2) `import { Spinner } from '../../Spinner'`. Le Spinner devient inutilisé (porté par FileDropzone). Remplacer cette ligne par :

```tsx
import { FileDropzone } from '../../FileDropzone'
```

- [ ] **Step 2: Remplacer le bloc `<label>…</label>` par `<FileDropzone>`**

Repérer le bloc JSX du `<label htmlFor={`devis-upload-${project.id}`} …>` … `</label>` (le 1er enfant du `<div className="space-y-5">`). Le remplacer **entièrement** par :

```tsx
      <FileDropzone
        id={`devis-upload-${project.id}`}
        accept="application/pdf"
        uploading={uploading}
        title="Déposer un devis Solteo (PDF)"
        subtitle="L'IA analysera automatiquement le PDF."
        onFiles={(files) => {
          const f = files[0]
          if (f) void handleFile(f)
        }}
      />
```

`handleFile(file: File)` (qui valide déjà le type PDF) reste inchangé.

- [ ] **Step 3: Vérifier typecheck + lint du fichier**

Run: `cd "ECOI_frontend" && npx tsc -b && npx eslint src/components/leads/project/ProjectDevisTab.tsx`
Expected: aucune erreur (notamment plus de Spinner importé non utilisé).

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/project/ProjectDevisTab.tsx
git commit -m "feat(project): glisser-déposer sur l'upload de devis"
```

---

## Task 3: Brancher `ProjectDocumentsTab`

**Files:**
- Modify: `src/components/leads/project/ProjectDocumentsTab.tsx`

- [ ] **Step 1: Ajuster les imports**

Le fichier importe `Icon` (toujours utilisé pour la liste) et `Spinner` (ligne 3, deviendra inutilisé). Supprimer la ligne `import { Spinner } from '../../Spinner'` et ajouter :

```tsx
import { FileDropzone } from '../../FileDropzone'
```

(Garder l'import de `Icon`.)

- [ ] **Step 2: Remplacer le bloc `<label>…</label>` d'upload par `<FileDropzone>`**

Repérer le bloc `<label htmlFor={`docs-upload-${project.id}`} …>` … `</label>` (situé **après** le champ « Étiquette », qu'on conserve tel quel au-dessus). Le remplacer **entièrement** par :

```tsx
      <FileDropzone
        id={`docs-upload-${project.id}`}
        uploading={uploading}
        title="Déposer un document"
        subtitle="PDF, Word, Excel, etc. — 25 Mo max."
        onFiles={(files) => {
          const f = files[0]
          if (f) void handleFile(f)
        }}
      />
```

`handleFile(file: File)` reste inchangé.

- [ ] **Step 3: Vérifier typecheck + lint du fichier**

Run: `cd "ECOI_frontend" && npx tsc -b && npx eslint src/components/leads/project/ProjectDocumentsTab.tsx`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/project/ProjectDocumentsTab.tsx
git commit -m "feat(project): glisser-déposer sur l'upload de documents"
```

---

## Task 4: Brancher `ProjectPhotosTab` (handler adapté à `File[]`)

**Files:**
- Modify: `src/components/leads/project/ProjectPhotosTab.tsx`

- [ ] **Step 1: Ajuster les imports**

Supprimer `import { Spinner } from '../../Spinner'` (ligne 3) et ajouter :

```tsx
import { FileDropzone } from '../../FileDropzone'
```

(Garder l'import de `Icon`.)

- [ ] **Step 2: Adapter la signature de `handleFiles` à `File[]`**

Remplacer la fonction `handleFiles` existante par cette version (prend `File[]`, conserve la validation image par fichier à l'identique) :

```tsx
  async function handleFiles(files: File[]) {
    if (files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setError(`"${file.name}" n'est pas une image — ignoré.`)
          continue
        }
        await uploadProjectAttachment(project.id, file, { kind: 'photo' })
      }
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Upload échoué.')
    } finally {
      setUploading(false)
    }
  }
```

- [ ] **Step 3: Remplacer le bloc `<label>…</label>` par `<FileDropzone>`**

Repérer le bloc `<label htmlFor={`photos-upload-${project.id}`} …>` … `</label>` (1er enfant du `<div className="space-y-4">`). Le remplacer **entièrement** par :

```tsx
      <FileDropzone
        id={`photos-upload-${project.id}`}
        accept="image/*"
        multiple
        uploading={uploading}
        title="Déposer des photos"
        subtitle="Multi-fichiers, jusqu'à 25 Mo chacune."
        onFiles={(files) => void handleFiles(files)}
      />
```

- [ ] **Step 4: Vérifier typecheck + lint du fichier**

Run: `cd "ECOI_frontend" && npx tsc -b && npx eslint src/components/leads/project/ProjectPhotosTab.tsx`
Expected: aucune erreur (`handleFiles` n'est plus appelée avec `FileList`).

- [ ] **Step 5: Commit**

```bash
git add src/components/leads/project/ProjectPhotosTab.tsx
git commit -m "feat(project): glisser-déposer sur l'upload de photos"
```

---

## Task 5: Vérification globale

**Files:** aucun (validation).

- [ ] **Step 1: Suite de tests complète**

Run: `cd "ECOI_frontend" && npm test`
Expected: PASS — tous les fichiers verts, dont `FileDropzone.test.tsx` (5 tests).

- [ ] **Step 2: Lint des fichiers du chantier**

Run: `cd "ECOI_frontend" && npx eslint src/components/FileDropzone.tsx src/components/leads/project/ProjectDevisTab.tsx src/components/leads/project/ProjectDocumentsTab.tsx src/components/leads/project/ProjectPhotosTab.tsx`
Expected: 0 erreur sur ces fichiers (imports Spinner non utilisés supprimés).

- [ ] **Step 3: Build**

Run: `cd "ECOI_frontend" && npm run build`
Expected: build OK (`tsc -b` + vite build sans erreur).

- [ ] **Step 4: Vérification manuelle dans l'app**

Démarrer la stack locale (cf. mémoire « Local stack startup »), ouvrir un projet, puis sur chacun des onglets **Devis**, **Photos**, **Documents** :
1. Glisser un fichier depuis le bureau au-dessus de la zone → surbrillance + « Déposez ici ».
2. Lâcher → l'upload se déclenche (« Upload en cours… »).
3. Le clic sur la zone ouvre toujours le sélecteur.
4. Vérifier le rejet d'un mauvais type : non-PDF sur Devis (erreur), non-image sur Photos (« … n'est pas une image — ignoré »).

---

## Self-Review (effectuée)

- **Couverture spec :** composant `FileDropzone` + interface (T1), drag&drop + anti-clignotement + uploading (T1, code+tests), branchement Devis/Documents/Photos avec comportement miroir (T2/T3/T4), `handleFiles` adapté à `File[]` (T4), suppression des imports Spinner inutiles (T2/T3/T4), tests + vérif manuelle (T1, T5) — toutes les sections de la spec sont couvertes.
- **Placeholders :** aucun ; chaque step montre le code/commande réels.
- **Cohérence des types/noms :** `FileDropzone` props `{ id, title, subtitle, onFiles, accept?, multiple?, uploading? }` définies en T1 et utilisées à l'identique en T2/T3/T4 ; `onFiles: (files: File[]) => void` cohérent avec `handleFile(files[0])` (mono) et `handleFiles(files: File[])` (multi).
