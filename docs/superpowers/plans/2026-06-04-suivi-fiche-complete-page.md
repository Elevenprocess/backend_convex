# Page « Fiche complète » du client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le panneau slide-over « Fiche complète » par une page dédiée `/suivi/:id/fiche` : fiche client à gauche, dossiers (devis, photos, documents, débriefs) groupés par projet à droite.

**Architecture:** Démanteler `FicheComplete.tsx` en composants présentationnels partagés (`fiche-parts.tsx`), un panneau gauche (`FicheClientPanel`) et une section par projet (`ProjectDossierSection`). Une nouvelle page (`SuiviFiche.tsx`) reconstruit le dossier comme `SuiviDetail`, charge les détails projet via l'API existante et compose le tout dans le layout `suivi-split`. Le bouton du `DossierSidebar` devient un `<Link>`.

**Tech Stack:** React 19, react-router-dom 7 (hash router), Vite, Vitest + Testing Library, Tailwind (classes utilitaires) + `src/index.css`.

---

## File Structure

- **Create** `src/components/suivi/fiche-parts.tsx` — sous-composants présentationnels partagés : `Section`, `Field`, `Empty`, `DevisRow`, `AttachmentRow`, `DebriefCard`.
- **Create** `src/components/suivi/FicheClientPanel.tsx` — colonne gauche : coordonnées/données + historique global (note setter + débriefs sans projet).
- **Create** `src/components/suivi/ProjectDossierSection.tsx` — une section par projet (en-tête + devis/photos/documents/débriefs).
- **Create** `src/pages/SuiviFiche.tsx` — page `FicheCompletePage` (data + layout + gardes).
- **Create** `src/pages/SuiviFiche.test.tsx` — test d'intégration de la page.
- **Modify** `src/main.tsx` — import + route `/suivi/:id/fiche`.
- **Modify** `src/components/suivi/DossierSidebar.tsx` — supprimer le panneau, bouton → `<Link>`.
- **Delete** `src/components/suivi/FicheComplete.tsx` — remplacé.

Aucune modification backend.

---

## Task 1 : Composants partagés `fiche-parts.tsx`

**Files:**
- Create: `src/components/suivi/fiche-parts.tsx`

- [ ] **Step 1: Créer le fichier avec tous les sous-composants**

Ce sont des extractions à l'identique des sous-composants déjà présents dans `FicheComplete.tsx` (Section/Field/Empty/DevisRow/AttachmentRow) plus une `DebriefCard` extraite du bloc « article » de débrief.

```tsx
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { formatDate } from '../../lib/suivi'
import { attachmentRawUrl, downloadDevisPdf } from '../../lib/api'
import {
  DEBRIEF_OUTCOME_LABEL,
  type Devis,
  type ProjectAttachmentResponse,
  type DebriefResponse,
} from '../../lib/types'

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-cuivre">
        {title}
        {count != null && count > 0 && (
          <span className="rounded-full bg-or-tint px-1.5 py-0.5 text-[10px] font-black text-or-dark">{count}</span>
        )}
      </h3>
      {children}
    </section>
  )
}

export function Field({ label, value, href, wide }: { label: string; value: string | null | undefined; href?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="break-words text-[13px] font-bold text-text">
        {value ? (href ? <a href={href} className="text-or-dark hover:text-or">{value}</a> : value) : '—'}
      </dd>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">{children}</div>
}

export function DevisRow({ devis }: { devis: Devis }) {
  const montant = devis.montantTtc ?? devis.montantNet ?? devis.montantHt
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-or-tint text-or-dark">
        <Icon name="tag" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold text-text">{devis.devisNumber || devis.filename}</div>
        <div className="text-[10px] text-muted">
          {montant ? `${Number(montant).toLocaleString('fr-FR')} €` : '—'} · {devis.status}
          {devis.devisDate ? ` · ${formatDate(devis.devisDate)}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void downloadDevisPdf(devis.id, devis.filename)}
        className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-muted transition-colors hover:bg-cream hover:text-text"
      >
        <Icon name="download" size={13} />
      </button>
    </li>
  )
}

export function AttachmentRow({ attachment }: { attachment: ProjectAttachmentResponse }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream text-muted">
        <Icon name="tag" size={15} />
      </span>
      <button
        type="button"
        onClick={() => window.open(attachmentRawUrl(attachment.id), '_blank')}
        className="min-w-0 flex-1 text-left"
        title={attachment.label || attachment.filename}
      >
        <div className="truncate text-[13px] font-bold text-text">{attachment.label || attachment.filename}</div>
        <div className="text-[10px] text-muted">
          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko · {formatDate(attachment.createdAt)}
        </div>
      </button>
    </li>
  )
}

export function DebriefCard({ debrief }: { debrief: DebriefResponse }) {
  return (
    <article className="rounded-xl border border-line bg-white p-3.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-black text-text">
          Débrief · {DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-faint">{formatDate(debrief.createdAt)}</span>
      </div>
      {debrief.notes && <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{debrief.notes}</p>}
      {debrief.objection && <p className="mt-1 text-[11px] font-semibold text-faint">Objection : {debrief.objection}</p>}
    </article>
  )
}
```

- [ ] **Step 2: Vérifier la compilation du fichier**

Run: `cd "ECOI_frontend" && npx tsc -b`
Expected: PASS (aucune erreur). Le fichier compile même s'il n'est pas encore importé.

- [ ] **Step 3: Commit**

```bash
cd "ECOI_frontend"
git add src/components/suivi/fiche-parts.tsx
git commit -m "feat(suivi): extract shared fiche presentational parts"
```

---

## Task 2 : Composant `FicheClientPanel` (colonne gauche)

**Files:**
- Create: `src/components/suivi/FicheClientPanel.tsx`

- [ ] **Step 1: Créer le composant**

Reprend les sections « Coordonnées & données » et « Historique » de l'actuel `FicheComplete`, mais : (a) prend `dossier` + `debriefs` en props (pas de chargement interne), (b) ne garde dans l'historique que les débriefs **sans projet** (`projectId == null`).

```tsx
import { Icon } from '../Icon'
import type { Dossier } from '../../lib/suivi'
import { formatCurrency, formatDate } from '../../lib/suivi'
import { fullName, initials, STATUS_LABEL, type DebriefResponse } from '../../lib/types'
import { Section, Field, DebriefCard } from './fiche-parts'

type Props = {
  dossier: Dossier
  debriefs: DebriefResponse[]
}

/**
 * Colonne gauche de la page Fiche complète : identité, coordonnées & données
 * collectées, puis l'historique « global » du client (note setter + débriefs
 * non rattachés à un projet précis).
 */
export function FicheClientPanel({ dossier, debriefs }: Props) {
  const lead = dossier.lead
  const setterNote = lead.latestCallComment
  const generalDebriefs = [...debriefs]
    .filter((d) => d.projectId == null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <aside className="space-y-7 rounded-2xl border border-line bg-white p-5 lg:sticky lg:top-4">
      <header className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-or-tint text-base font-black text-or-dark">
          {initials(lead)}
        </span>
        <div className="min-w-0">
          <div className="eyebrow text-or-dark">Fiche client</div>
          <h2 className="truncate text-lg font-black text-text">{fullName(lead) || 'Client sans nom'}</h2>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-cream px-2 py-0.5 font-bold text-or-dark">{STATUS_LABEL[lead.status]}</span>
            {lead.city && <span>· {lead.city}</span>}
          </div>
        </div>
      </header>

      <Section title="Coordonnées & données">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Field label="Téléphone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
          <Field label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
          <Field label="Adresse" value={lead.addressLine} wide />
          <Field label="Code postal" value={lead.postalCode} />
          <Field label="Ville" value={lead.city} />
          <Field label="Logement" value={lead.typeLogement} />
          <Field label="Revenu fiscal" value={lead.revenuFiscal ? `${lead.revenuFiscal.toLocaleString('fr-FR')} €` : null} />
          <Field label="Source" value={lead.source} />
          <Field label="Canal" value={lead.canalAcquisition} />
          <Field label="Campagne" value={lead.campaign} />
          <Field label="Setter" value={dossier.setter?.name} />
          <Field label="Commercial" value={dossier.commercial?.name} />
          <Field label="RDV" value={dossier.rdv?.scheduledAt ? formatDate(dossier.rdv.scheduledAt) : null} />
          <Field label="Montant" value={dossier.amount ? formatCurrency(dossier.amount) : null} />
          <Field label="Financement" value={dossier.rdv?.financingType ?? null} />
          <Field
            label="Signé le"
            value={dossier.rdv?.signatureAt ? formatDate(dossier.rdv.signatureAt) : (dossier.signedAt ? formatDate(dossier.signedAt) : null)}
          />
        </dl>
      </Section>

      {(generalDebriefs.length > 0 || setterNote) && (
        <Section title="Historique" count={generalDebriefs.length + (setterNote ? 1 : 0)}>
          <div className="space-y-3">
            {generalDebriefs.map((d) => (
              <DebriefCard key={d.id} debrief={d} />
            ))}
            {setterNote && (
              <article className="rounded-xl border border-line bg-white p-3.5 [border-left:3px_solid_var(--color-cuivre)]">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-black text-text">
                    Note setter{dossier.setter?.name ? ` · ${dossier.setter.name}` : ''}
                  </span>
                  {lead.latestCallAt && <span className="shrink-0 text-[10px] font-bold text-faint">{formatDate(lead.latestCallAt)}</span>}
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{setterNote}</p>
              </article>
            )}
          </div>
        </Section>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd "ECOI_frontend" && npx tsc -b`
Expected: PASS.

> Note : `Icon` est importé pour cohérence d'API mais peut ne pas être utilisé ici — si `tsc` signale un import inutilisé, retirer la ligne `import { Icon } ...`.

- [ ] **Step 3: Commit**

```bash
cd "ECOI_frontend"
git add src/components/suivi/FicheClientPanel.tsx
git commit -m "feat(suivi): add FicheClientPanel (left column)"
```

---

## Task 3 : Composant `ProjectDossierSection` (une section par projet)

**Files:**
- Create: `src/components/suivi/ProjectDossierSection.tsx`

- [ ] **Step 1: Créer le composant**

```tsx
import { Icon } from '../Icon'
import { formatDate } from '../../lib/suivi'
import { attachmentRawUrl } from '../../lib/api'
import { PROJECT_STATUS_LABEL, type ProjectDetailResponse } from '../../lib/types'
import { Section, Empty, DevisRow, AttachmentRow, DebriefCard } from './fiche-parts'

type Props = {
  project: ProjectDetailResponse
  commercialName?: string
}

/**
 * Un « dossier » de projet du client : en-tête (nom, statut, date, commercial)
 * puis les éléments créés par les commerciaux — devis, photos, documents,
 * débriefs — scopés à ce projet.
 */
export function ProjectDossierSection({ project, commercialName }: Props) {
  const photos = project.attachments.filter((a) => a.kind === 'photo')
  const documents = project.attachments.filter((a) => a.kind !== 'photo')
  const debriefs = [...project.debriefs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return (
    <article className="space-y-6 rounded-2xl border border-line bg-cream p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <h2 className="text-base font-black text-text">{project.name || 'Projet'}</h2>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="rounded-full bg-or-tint px-2 py-0.5 font-bold text-or-dark">
            {PROJECT_STATUS_LABEL[project.status] ?? project.status}
          </span>
          <span>· créé le {formatDate(project.createdAt)}</span>
          {commercialName && <span>· {commercialName}</span>}
        </div>
      </header>

      <Section title="Devis" count={project.devis.length}>
        {project.devis.length === 0 ? (
          <Empty>Aucun devis.</Empty>
        ) : (
          <ul className="space-y-2">
            {project.devis.map((d) => (
              <DevisRow key={d.id} devis={d} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Photos" count={photos.length}>
        {photos.length === 0 ? (
          <Empty>Aucune photo.</Empty>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => window.open(attachmentRawUrl(p.id), '_blank')}
                className="aspect-square overflow-hidden rounded-xl border border-line bg-white"
                title={p.label || p.filename}
              >
                <img
                  src={attachmentRawUrl(p.id)}
                  alt={p.label || p.filename}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Documents" count={documents.length}>
        {documents.length === 0 ? (
          <Empty>Aucun document.</Empty>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <AttachmentRow key={doc.id} attachment={doc} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Débriefs" count={debriefs.length}>
        {debriefs.length === 0 ? (
          <Empty>Aucun débrief.</Empty>
        ) : (
          <div className="space-y-3">
            {debriefs.map((d) => (
              <DebriefCard key={d.id} debrief={d} />
            ))}
          </div>
        )}
      </Section>
    </article>
  )
}
```

- [ ] **Step 2: Vérifier que `PROJECT_STATUS_LABEL` existe ; sinon fallback**

Run: `cd "ECOI_frontend" && grep -n "PROJECT_STATUS_LABEL" src/lib/types.ts`
Expected: une ligne d'export. **Si absent** (grep vide), remplacer dans le composant l'import `PROJECT_STATUS_LABEL, ` par rien et la ligne d'affichage par `{project.status}` :
```tsx
import { type ProjectDetailResponse } from '../../lib/types'
// ...
<span className="rounded-full bg-or-tint px-2 py-0.5 font-bold text-or-dark">{project.status}</span>
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd "ECOI_frontend" && npx tsc -b`
Expected: PASS. (Si `Icon` non utilisé est signalé, retirer son import.)

- [ ] **Step 4: Commit**

```bash
cd "ECOI_frontend"
git add src/components/suivi/ProjectDossierSection.tsx
git commit -m "feat(suivi): add ProjectDossierSection (per-project dossier)"
```

---

## Task 4 : Page `SuiviFiche.tsx` + test (TDD)

**Files:**
- Create: `src/pages/SuiviFiche.test.tsx`
- Create: `src/pages/SuiviFiche.tsx`

- [ ] **Step 1: Écrire le test qui échoue**

Crée `src/pages/SuiviFiche.test.tsx`. Le test monte la page via un `MemoryRouter` initialisé sur `/suivi/lead-1/fiche`, avec hooks et API mockés. `buildDossiers` réel est utilisé (un lead `status: 'signe'` produit un dossier d'`id` = `lead.id`).

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { LeadResponse, UserResponse, ProjectResponse, ProjectDetailResponse } from '../lib/types'

vi.mock('../components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))

const useLeadsMock = vi.fn()
const useRdvListMock = vi.fn()
const useUsersMock = vi.fn()
const useLeadDebriefsMock = vi.fn()
vi.mock('../lib/hooks', () => ({
  useLeads: (...a: unknown[]) => useLeadsMock(...a),
  useRdvList: (...a: unknown[]) => useRdvListMock(...a),
  useUsers: (...a: unknown[]) => useUsersMock(...a),
  useLeadDebriefs: (...a: unknown[]) => useLeadDebriefsMock(...a),
}))

const listProjectsByLeadMock = vi.fn()
const getProjectDetailMock = vi.fn()
vi.mock('../lib/api', () => ({
  listProjectsByLead: (...a: unknown[]) => listProjectsByLeadMock(...a),
  getProjectDetail: (...a: unknown[]) => getProjectDetailMock(...a),
  attachmentRawUrl: (id: string) => `/raw/${id}`,
  downloadDevisPdf: vi.fn(),
}))

const authStateRef = { user: { id: 'admin-1', name: 'Admin', role: 'admin', active: true } as UserResponse }
vi.mock('../lib/auth', () => ({
  useAuth: (selector: (s: { user?: UserResponse }) => unknown) => selector(authStateRef),
}))

import { FicheCompletePage } from './SuiviFiche'

const lead: LeadResponse = {
  id: 'lead-1',
  firstName: 'Jean',
  lastName: 'Dupont',
  status: 'signe',
  city: 'Saint-Denis',
} as LeadResponse

const commercial: UserResponse = { id: 'com-1', name: 'Alice Commercial', role: 'commercial', active: true } as UserResponse

const project: ProjectResponse = {
  id: 'proj-1',
  leadId: 'lead-1',
  commercialId: 'com-1',
  name: 'Installation 8 kWc',
  addressLine: null,
  postalCode: null,
  city: null,
  status: 'en_cours' as ProjectResponse['status'],
  notes: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
}

const projectDetail: ProjectDetailResponse = {
  ...project,
  devis: [
    { id: 'dev-1', filename: 'devis.pdf', devisNumber: '2605-0393', status: 'valide', montantTtc: 19425 } as ProjectDetailResponse['devis'][number],
  ],
  debriefs: [],
  attachments: [
    { id: 'att-1', projectId: 'proj-1', uploadedById: 'com-1', kind: 'document', label: 'Mandat', filename: 'mandat.pdf', contentType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-05-02T10:00:00.000Z' },
  ],
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/suivi/:id/fiche" element={<FicheCompletePage />} />
        <Route path="/overview" element={<div>OVERVIEW</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authStateRef.user = { id: 'admin-1', name: 'Admin', role: 'admin', active: true } as UserResponse
  useLeadsMock.mockReturnValue({ data: [lead], loading: false })
  useRdvListMock.mockReturnValue({ data: [], loading: false })
  useUsersMock.mockReturnValue({ data: [commercial] })
  useLeadDebriefsMock.mockReturnValue({ data: [] })
  listProjectsByLeadMock.mockResolvedValue([project])
  getProjectDetailMock.mockResolvedValue(projectDetail)
})

describe('FicheCompletePage', () => {
  it('affiche la fiche client et les dossiers groupés par projet', async () => {
    renderAt('/suivi/lead-1/fiche')

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument()
    const projectHeading = await screen.findByText('Installation 8 kWc')
    expect(projectHeading).toBeInTheDocument()
    expect(await screen.findByText('2605-0393')).toBeInTheDocument()
    expect(await screen.findByText('Mandat')).toBeInTheDocument()
  })

  it('affiche « Dossier introuvable » pour un id inconnu', async () => {
    renderAt('/suivi/inconnu/fiche')
    expect(await screen.findByText('Dossier introuvable.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd "ECOI_frontend" && npx vitest run src/pages/SuiviFiche.test.tsx`
Expected: FAIL — `Failed to resolve import "./SuiviFiche"` (le module page n'existe pas encore).

- [ ] **Step 3: Implémenter la page**

Crée `src/pages/SuiviFiche.tsx`.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers, useLeadDebriefs } from '../lib/hooks'
import { buildDossiers } from '../lib/suivi'
import { listProjectsByLead, getProjectDetail } from '../lib/api'
import { fullName, type ProjectDetailResponse } from '../lib/types'
import { FicheClientPanel } from '../components/suivi/FicheClientPanel'
import { ProjectDossierSection } from '../components/suivi/ProjectDossierSection'

/**
 * Page « Fiche complète » d'un client : la fiche (coordonnées + historique
 * global) à gauche, et tous les dossiers créés par les commerciaux regroupés
 * par projet (devis, photos, documents, débriefs) à droite.
 */
export function FicheCompletePage() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()

  const dossier = useMemo(() => {
    if (!id || !leads) return null
    return buildDossiers(leads ?? [], rdvs ?? [], users ?? [], {}).find((d) => d.id === id) ?? null
  }, [id, leads, rdvs, users])

  const { data: leadDebriefs } = useLeadDebriefs(dossier?.lead.id)

  const [details, setDetails] = useState<ProjectDetailResponse[] | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const leadId = dossier?.lead.id
  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    setLoadingProjects(true)
    setError(null)
    listProjectsByLead(leadId)
      .then(async (projects) => {
        const loaded = await Promise.all(projects.map((p) => getProjectDetail(p.id).catch(() => null)))
        if (cancelled) return
        setDetails(loaded.filter((d): d is ProjectDetailResponse => Boolean(d)))
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger les projets du client.')
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const usersById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users ?? []) m.set(u.id, u.name)
    return m
  }, [users])

  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
    && role !== 'technicien'
  ) return <Navigate to="/overview" replace />
  if (!id) return <Navigate to="/suivi" replace />

  const isLoading = leadsLoading || rdvLoading

  return (
    <AppShell flat>
      <Topbar
        eyebrow="FICHE CLIENT"
        title={dossier ? (fullName(dossier.lead) || 'Client sans nom') : 'Fiche complète'}
      />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-breadcrumb">
          <Link to={`/suivi/${id}`}>← Retour au dossier</Link>
        </nav>

        {isLoading ? (
          <LoadingBlock label="Chargement de la fiche…" />
        ) : !dossier ? (
          <div className="suivi-empty">
            <p>Dossier introuvable.</p>
            <Link to="/suivi">Retour à la liste</Link>
          </div>
        ) : (
          <div className="suivi-split">
            <FicheClientPanel dossier={dossier} debriefs={leadDebriefs ?? []} />
            <div className="suivi-main-col">
              {error && (
                <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>
              )}
              {loadingProjects ? (
                <LoadingBlock label="Chargement des dossiers…" />
              ) : details && details.length > 0 ? (
                details.map((p) => (
                  <ProjectDossierSection key={p.id} project={p} commercialName={usersById.get(p.commercialId)} />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
                  Aucun projet pour ce client.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `cd "ECOI_frontend" && npx vitest run src/pages/SuiviFiche.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd "ECOI_frontend"
git add src/pages/SuiviFiche.tsx src/pages/SuiviFiche.test.tsx
git commit -m "feat(suivi): add dedicated Fiche complète page with test"
```

---

## Task 5 : Brancher la route dans `main.tsx`

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Ajouter l'import de la page**

Près des autres imports de pages de suivi (`SuiviDetail`), ajouter :
```tsx
import { FicheCompletePage } from './pages/SuiviFiche'
```

- [ ] **Step 2: Ajouter la route après `/suivi/:id`**

Dans le tableau de routes, juste après la ligne `{ path: '/suivi/:id', element: <SuiviDetail /> },`, insérer :
```tsx
          { path: '/suivi/:id/fiche', element: <FicheCompletePage /> },
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd "ECOI_frontend" && npx tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd "ECOI_frontend"
git add src/main.tsx
git commit -m "feat(suivi): wire /suivi/:id/fiche route"
```

---

## Task 6 : Remplacer le panneau par un lien et supprimer `FicheComplete.tsx`

**Files:**
- Modify: `src/components/suivi/DossierSidebar.tsx`
- Delete: `src/components/suivi/FicheComplete.tsx`

- [ ] **Step 1: Retirer l'import et l'usage du panneau dans `DossierSidebar.tsx`**

Supprimer la ligne d'import (`src/components/suivi/DossierSidebar.tsx:8`) :
```tsx
import { FicheComplete } from './FicheComplete'
```
Supprimer la déclaration d'état (`:33`) :
```tsx
  const [showFiche, setShowFiche] = useState(false)
```
Supprimer le rendu conditionnel du panneau (`:148`) :
```tsx
    {showFiche && <FicheComplete dossier={dossier} onClose={() => setShowFiche(false)} />}
```

- [ ] **Step 2: Transformer le bouton en `<Link>`**

S'assurer que `Link` est importé depuis `react-router-dom` en haut du fichier (l'ajouter à l'import existant si nécessaire : `import { Link } from 'react-router-dom'`).
Remplacer le bouton (`:143-145`) :
```tsx
        <button type="button" className="suivi-side-cta" onClick={() => setShowFiche(true)}>
          Fiche complète
        </button>
```
par :
```tsx
        <Link to={`/suivi/${dossier.id}/fiche`} className="suivi-side-cta">
          Fiche complète
        </Link>
```

- [ ] **Step 3: Supprimer le fichier du panneau**

```bash
cd "ECOI_frontend"
git rm src/components/suivi/FicheComplete.tsx
```
> `FicheComplete.tsx` est un fichier non suivi par git (jamais commité) ; si `git rm` échoue avec « did not match any files », supprimer directement : `rm src/components/suivi/FicheComplete.tsx`.

- [ ] **Step 4: Vérifier qu'aucune référence ne subsiste**

Run: `cd "ECOI_frontend" && grep -rn "FicheComplete\b" src | grep -v "FicheCompletePage" | grep -v "SuiviFiche"`
Expected: aucune ligne (sortie vide). `useState` doit rester utilisé ailleurs dans `DossierSidebar` ; si l'import `useState` devient inutilisé, le retirer.

- [ ] **Step 5: Vérifier la compilation**

Run: `cd "ECOI_frontend" && npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "ECOI_frontend"
git add src/components/suivi/DossierSidebar.tsx
git commit -m "feat(suivi): replace fiche slide-over with link to dedicated page"
```

---

## Task 7 : Vérification finale (build + tests complets)

**Files:** aucun (vérification)

- [ ] **Step 1: Typecheck + build de prod**

Run: `cd "ECOI_frontend" && npm run build`
Expected: PASS (`tsc -b` sans erreur puis build Vite réussi).

- [ ] **Step 2: Suite de tests complète**

Run: `cd "ECOI_frontend" && npm run test`
Expected: PASS — tous les tests, dont les 2 de `SuiviFiche.test.tsx`, passent. Aucun test cassé par la suppression de `FicheComplete`.

- [ ] **Step 3: (Optionnel) Lint**

Run: `cd "ECOI_frontend" && npm run lint`
Expected: aucune nouvelle erreur sur les fichiers créés/modifiés.

---

## Self-Review

**Couverture du spec :**
- Route `/suivi/:id/fiche` → Task 5. ✓
- Page deux colonnes (fiche gauche / dossiers droite) → Task 4 (layout `suivi-split`). ✓
- Fiche client (coordonnées + historique global) → Task 2. ✓
- Dossiers groupés par projet (devis/photos/documents/débriefs) → Task 3. ✓
- Débriefs par projet vs lead → Task 2 filtre `projectId == null`, Task 3 utilise `project.debriefs`. ✓
- Mêmes gardes de rôles + états (chargement / introuvable / erreur) → Task 4. ✓
- Suppression du panneau + bouton → lien → Task 6. ✓
- Réutilisation des sous-composants → Task 1. ✓
- Tests → Task 4. ✓
- Aucune modif backend. ✓

**Cohérence des types :** `FicheCompletePage` (export), `FicheClientPanel({ dossier, debriefs })`, `ProjectDossierSection({ project, commercialName })`, `DebriefCard({ debrief })`, `dossier.id === lead.id`. Signatures cohérentes entre tâches. ✓

**Placeholders :** aucun — code complet à chaque étape. Deux garde-fous explicites (existence de `PROJECT_STATUS_LABEL` en Task 3 ; import `Icon`/`useState` éventuellement inutilisés). ✓
