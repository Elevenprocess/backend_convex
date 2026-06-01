import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'
import { Spinner } from '../Spinner'
import { CommercialDebriefSidebar } from './CommercialDebriefSidebar'
import { ProjectDetailView } from './project/ProjectDetailView'
import {
  ApiError,
  createProject,
  listProjectsByLead,
  uploadDevis,
} from '../../lib/api'
import {
  fullName,
  PROJECT_STATUS_LABEL,
  type LeadResponse,
  type ProjectResponse,
} from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { leadDetailPath } from '../../lib/leadPaths'

type View = 'overview' | 'create' | 'project' | 'debrief'

type Props = {
  lead: LeadResponse
  onClose: () => void
  onSaved?: () => void
  className?: string
  initialView?: View
  initialProject?: ProjectResponse | null
}

export function CommercialLeadPanel({
  lead,
  onClose,
  onSaved,
  className = '',
  initialView = 'overview',
  initialProject = null,
}: Props) {
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  const [view, setView] = useState<View>(initialView)
  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [activeProject, setActiveProject] = useState<ProjectResponse | null>(initialProject)
  const [refreshKey, setRefreshKey] = useState(0)
  const leadIdRef = useRef(lead.id)

  function openFullProfile() {
    onClose()
    navigate(leadDetailPath(role, lead.id))
  }

  // Reset quand on change de lead.
  useEffect(() => {
    if (leadIdRef.current !== lead.id) {
      leadIdRef.current = lead.id
      setView(initialView)
      setActiveProject(initialProject)
    }
  }, [lead.id, initialView, initialProject])

  useEffect(() => {
    let cancelled = false
    setLoadingProjects(true)
    listProjectsByLead(lead.id)
      .then((list) => {
        if (cancelled) return
        setProjects(list)
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [lead.id, refreshKey])

  function refreshProjects() {
    setRefreshKey((k) => k + 1)
  }

  if (view === 'debrief') {
    return (
      <CommercialDebriefSidebar
        lead={lead}
        onClose={onClose}
        onBack={() => setView('overview')}
        onSaved={() => {
          onSaved?.()
          refreshProjects()
        }}
        className={className}
      />
    )
  }

  return (
    <aside
      className={`flex flex-col w-full md:w-[460px] max-w-full md:max-w-[92vw] overflow-hidden border-l border-line bg-white/95 backdrop-blur-2xl shadow-2xl ${className}`}
    >
      <Header
        lead={lead}
        view={view}
        activeProject={activeProject}
        onClose={onClose}
        onBack={view === 'overview' ? undefined : () => setView('overview')}
      />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {view === 'overview' && (
          <OverviewView
            lead={lead}
            projects={projects}
            loading={loadingProjects}
            onCreate={() => setView('create')}
            onDebrief={() => setView('debrief')}
            onOpenFullProfile={openFullProfile}
            onOpenProject={(p) => {
              onClose()
              navigate(`/projects/${p.id}`)
            }}
          />
        )}
        {view === 'create' && (
          <CreateProjectView
            lead={lead}
            onCancel={() => setView('overview')}
            onCreated={(p) => {
              setActiveProject(p)
              refreshProjects()
              setView('project')
              onSaved?.()
            }}
          />
        )}
        {view === 'project' && activeProject && (
          <ProjectDetailView
            project={activeProject}
            lead={lead}
            onBack={() => setView('overview')}
            onChanged={(updated) => {
              if (updated) setActiveProject(updated)
              refreshProjects()
              onSaved?.()
            }}
            onRdvDebrief={() => setView('debrief')}
          />
        )}
      </div>
    </aside>
  )
}

// ─── Header ─────────────────────────────────────────────────
function Header({
  lead,
  view,
  activeProject,
  onClose,
  onBack,
}: {
  lead: LeadResponse
  view: View
  activeProject: ProjectResponse | null
  onClose: () => void
  onBack?: () => void
}) {
  const title =
    view === 'overview' ? 'Fiche prospect'
    : view === 'create' ? 'Nouveau projet'
    : view === 'project' ? (activeProject?.name ?? 'Projet')
    : 'Débriefing'
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-4 backdrop-blur-2xl">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text"
          aria-label="Retour"
        >
          <Icon name="arrow-left" size={16} />
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text"
        aria-label="Fermer"
      >
        <Icon name="x" size={16} />
      </button>
      <div className={`eyebrow text-or-dark ${onBack ? 'pl-7' : ''}`}>{title}</div>
      <h2 className={`mt-1 pr-8 text-base font-black text-text ${onBack ? 'pl-7' : ''}`}>{fullName(lead)}</h2>
      <div className={`mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted ${onBack ? 'pl-7' : ''}`}>
        {lead.phone && <span className="rounded-full bg-cream px-2 py-1 font-bold text-muted">{lead.phone}</span>}
        {lead.city && <span className="rounded-full bg-cream px-2 py-1 font-bold text-muted">{lead.city}</span>}
      </div>
    </header>
  )
}

// ─── Overview ───────────────────────────────────────────────
function OverviewView(props: {
  lead: LeadResponse
  projects: ProjectResponse[]
  loading: boolean
  onCreate: () => void
  onDebrief: () => void
  onOpenFullProfile: () => void
  onOpenProject: (p: ProjectResponse) => void
}) {
  const { lead, projects, loading, onCreate, onDebrief, onOpenFullProfile, onOpenProject } = props
  const address = [lead.addressLine, lead.postalCode, lead.city].filter(Boolean).join(', ') || '—'
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-white/60 p-4 text-sm">
        <div className="eyebrow text-faint text-[10px] mb-2">Coordonnées</div>
        <Row label="Téléphone" value={lead.phone} />
        <Row label="Email" value={lead.email} />
        <Row label="Adresse" value={address} />
      </section>

      <section className="grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onOpenFullProfile}
          className="w-full px-4 py-3 rounded-2xl text-sm font-bold border border-line bg-white hover:bg-cream inline-flex items-center justify-center gap-2"
        >
          <Icon name="eye" size={16} />
          Voir la fiche complète
        </button>
        <button
          type="button"
          onClick={onDebrief}
          className="btn-primary w-full px-4 py-3 rounded-2xl text-sm font-bold inline-flex items-center justify-center gap-2"
        >
          <Icon name="phone" size={16} />
          Débrief RDV
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="w-full px-4 py-3 rounded-2xl text-sm font-bold border border-or text-or-dark bg-or/10 hover:bg-or/20 inline-flex items-center justify-center gap-2"
        >
          <Icon name="plus" size={16} />
          Créer un projet (sans débrief)
        </button>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow text-faint text-[10px]">Projets</div>
          {projects.length > 0 && <span className="text-[10px] font-bold text-muted">{projects.length}</span>}
        </div>
        {loading ? (
          <div className="py-4 text-center text-xs text-muted">Chargement…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white/40 px-4 py-4 text-xs text-muted">
            Aucun projet pour ce prospect. Crée-en un, le devis n'est pas obligatoire pour démarrer.
          </div>
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenProject(p)}
                  className="w-full text-left rounded-2xl border border-line bg-white/70 hover:bg-white px-4 py-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold truncate">{p.name}</div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {new Date(p.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2 text-[12px] py-0.5">
      <span className="text-faint w-20 shrink-0">{label}</span>
      <span className="text-text truncate">{value || '—'}</span>
    </div>
  )
}

function ProjectStatusBadge({ status }: { status: ProjectResponse['status'] }) {
  const map: Record<ProjectResponse['status'], string> = {
    qualification: 'bg-cuivre-tint text-cuivre',
    devis_en_cours: 'bg-or-tint text-or-dark',
    signature_en_cours: 'bg-info-tint text-info',
    signe: 'bg-success-tint text-success',
    perdu: 'bg-rouille-tint text-rouille',
    abandonne: 'bg-cream text-muted',
  }
  return (
    <span className={`shrink-0 inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ${map[status]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </span>
  )
}

// ─── Create Project ─────────────────────────────────────────
function CreateProjectView(props: {
  lead: LeadResponse
  onCancel: () => void
  onCreated: (p: ProjectResponse) => void
}) {
  const { lead, onCancel, onCreated } = props
  const defaultAddress = [lead.addressLine, lead.postalCode, lead.city].filter(Boolean).join(', ')
  const [name, setName] = useState('')
  const [address, setAddress] = useState(defaultAddress)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const projectName = name.trim()
    if (!projectName) return setError('Donne un nom au projet.')
    if (file && file.type !== 'application/pdf') return setError('Seul un PDF est accepté pour le devis.')
    setSubmitting(true)
    try {
      const project = await createProject({
        leadId: lead.id,
        name: projectName,
        addressLine: address.trim() || null,
      })
      // Devis optionnel : si l'user a déposé un PDF, on l'upload lié au projet.
      if (file) {
        try {
          await uploadDevis(lead.id, undefined, file, {
            projectName,
            installationAddress: address.trim(),
            projectId: project.id,
          })
        } catch (uploadErr) {
          // On crée quand même le projet, mais on informe que le PDF a échoué.
          const msg = uploadErr instanceof Error ? uploadErr.message : 'Devis non uploadé'
          setError(`Projet créé, mais upload devis échoué : ${msg}`)
        }
      }
      onCreated(project)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Échec de la création.'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-info/20 bg-info-tint/40 px-4 py-3 text-[11px] text-info">
        Le devis PDF est optionnel. Tu peux créer un projet en qualification et déposer le PDF plus tard.
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Nom du projet</label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex. Installation 6 kWc Valentin"
          className="w-full bg-white border border-line rounded-[14px] px-3 py-2 text-sm focus:outline-none focus:border-or"
        />
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Adresse d'installation (optionnel)</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Adresse complète d'installation"
          className="w-full bg-white border border-line rounded-[14px] px-3 py-2 text-sm focus:outline-none focus:border-or"
        />
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Devis Solteo (optionnel)</label>
        <label
          htmlFor="cp-pdf"
          className={`block rounded-2xl border-2 border-dashed px-6 py-6 text-center cursor-pointer transition-colors ${
            file ? 'border-or bg-or/10' : 'border-line bg-white/40 hover:bg-white/70'
          }`}
        >
          <input
            id="cp-pdf"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div>
              <div className="font-bold text-sm">{file.name}</div>
              <div className="text-xs text-muted mt-0.5">{(file.size / 1024).toFixed(0)} ko — cliquer pour remplacer</div>
            </div>
          ) : (
            <div>
              <div className="font-bold text-sm">Déposer le PDF du devis</div>
              <div className="text-xs text-muted mt-0.5">Tu peux aussi le faire plus tard depuis l'onglet Devis.</div>
            </div>
          )}
        </label>
      </div>

      {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-muted hover:text-text disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !name.trim()}
          className="btn-primary px-5 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
        >
          {submitting && <Spinner size={14} />}
          {submitting ? 'Création…' : 'Créer le projet'}
        </button>
      </div>
    </div>
  )
}
