import { useEffect, useState } from 'react'
import { Icon } from '../../Icon'
import { Spinner } from '../../Spinner'
import { getProjectDetail, updateProject } from '../../../lib/api'
import {
  PROJECT_STATUS_LABEL,
  type LeadResponse,
  type ProjectDetailResponse,
  type ProjectResponse,
  type ProjectStatus,
} from '../../../lib/types'
import { ProjectDevisTab } from './ProjectDevisTab'
import { ProjectDebriefsTab } from './ProjectDebriefsTab'
import { ProjectPhotosTab } from './ProjectPhotosTab'
import { ProjectDocumentsTab } from './ProjectDocumentsTab'
import { useAuth } from '../../../lib/auth'

type Tab = 'devis' | 'debriefs' | 'photos' | 'documents'

const TABS: { id: Tab; label: string; icon: 'edit' | 'phone' | 'eye' | 'grid' }[] = [
  { id: 'devis', label: 'Devis', icon: 'edit' },
  { id: 'debriefs', label: 'Débriefs', icon: 'phone' },
  { id: 'photos', label: 'Photos', icon: 'eye' },
  { id: 'documents', label: 'Documents', icon: 'grid' },
]

// Le dépôt/suivi de devis est réservé à l'admin et à la délivrabilité.
// Côté commercial (commercial + commercial_lead), le dossier client se limite
// aux débriefs, photos et documents.
const DEVIS_HIDDEN_ROLES = ['commercial', 'commercial_lead']

const STATUSES: ProjectStatus[] = [
  'qualification',
  'devis_en_cours',
  'signature_en_cours',
  'signe',
  'perdu',
  'abandonne',
]

type Props = {
  project: ProjectResponse
  lead: LeadResponse
  onBack: () => void
  onChanged: (updated: ProjectResponse | null) => void
  onRdvDebrief?: () => void
}

export function ProjectDetailView({ project, onChanged, onRdvDebrief }: Props) {
  const role = useAuth((s) => s.user?.role)
  const hideDevis = !!role && DEVIS_HIDDEN_ROLES.includes(role)
  const visibleTabs = hideDevis ? TABS.filter((t) => t.id !== 'devis') : TABS
  const [tab, setTab] = useState<Tab>(hideDevis ? 'debriefs' : 'devis')
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // Filet de sécurité : si le rôle se résout après le montage (ou bascule viewAs)
  // et masque le devis alors que l'onglet actif était 'devis', on rebascule sur
  // 'debriefs'. Évite qu'un commercial reste bloqué sur le dépôt de devis.
  useEffect(() => {
    if (hideDevis && tab === 'devis') setTab('debriefs')
  }, [hideDevis, tab])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProjectDetail(project.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.id, refreshKey])

  function refresh() {
    setRefreshKey((k) => k + 1)
    onChanged(project)
  }

  async function handleStatusChange(next: ProjectStatus) {
    if (next === project.status) return
    try {
      const updated = await updateProject(project.id, { status: next })
      onChanged(updated)
      refresh()
    } catch {
      /* swallowed; refresh affichera l'état réel au prochain GET */
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6">
      {/* ─── Colonne gauche : identité + KPIs + actions ─── */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-2xl border border-line bg-white p-5">
          <div className="text-faint text-[10px] uppercase tracking-[0.14em] mb-1">Projet</div>
          <h2 className="font-bold text-lg leading-tight text-text">{project.name}</h2>
          {project.addressLine && (
            <div className="text-[12px] text-muted mt-1 inline-flex items-start gap-1.5">
              <Icon name="map-pin" size={12} className="mt-0.5 text-faint shrink-0" />
              <span>{project.addressLine}</span>
            </div>
          )}
          <div className="text-[11px] text-faint mt-2">
            Créé le {new Date(project.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
          </div>

          <div className="mt-4 pt-4 border-t border-line-soft">
            <label className="block text-faint text-[10px] uppercase tracking-[0.14em] mb-1.5">Statut</label>
            <select
              value={project.status}
              onChange={(e) => void handleStatusChange(e.target.value as ProjectStatus)}
              className="w-full rounded-lg bg-cream px-3 py-2 text-[12px] font-bold border border-line cursor-pointer focus:outline-none focus:ring-2 focus:ring-or/30"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </section>

        {detail && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <div className="text-faint text-[10px] uppercase tracking-[0.14em] mb-3">Contenu du dossier</div>
            <div className="space-y-2">
              {!hideDevis && <KpiRow icon="edit" label="Devis" value={detail.devis.length} />}
              <KpiRow icon="phone" label="Débriefs" value={detail.debriefs.length} />
              <KpiRow icon="grid" label="Fichiers" value={detail.attachments.length} />
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-white p-5">
          {project.status === 'signe' ? (
            <div className="rounded-lg border border-success/30 bg-success-tint px-3 py-3 text-[12px] text-success inline-flex items-start gap-2 w-full">
              <Icon name="check" size={14} className="mt-0.5 shrink-0" />
              <span><strong className="block">Signé</strong>Le dossier a été basculé en délivrabilité.</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleStatusChange('signe')}
              className="w-full px-4 py-3 rounded-lg text-[13px] font-bold bg-success text-white hover:bg-success/90 inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Icon name="check" size={15} />
              Valider la signature
            </button>
          )}
        </section>
      </aside>

      {/* ─── Colonne droite : tabs + contenu ─── */}
      <section>
        <nav className="flex items-center gap-1 border-b border-line mb-5 overflow-x-auto -mx-1 px-1">
          {visibleTabs.map((t) => {
            const active = tab === t.id
            const count = detail ? tabBadgeCount(t.id, detail) : 0
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative px-4 py-3 text-[13px] font-bold inline-flex items-center gap-2 whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-or text-or-dark'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                <Icon name={t.icon} size={14} />
                {t.label}
                {count > 0 && (
                  <span
                    className={`text-[10px] font-black rounded-full min-w-[18px] px-1.5 py-0.5 leading-none ${
                      active ? 'bg-or text-white' : 'bg-cream text-muted'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {loading || !detail ? (
          <div className="py-12 inline-flex items-center justify-center gap-2 text-sm text-muted w-full">
            <Spinner size={16} /> Chargement…
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
            {!hideDevis && tab === 'devis' && (
              <ProjectDevisTab project={project} devis={detail.devis} onChanged={refresh} />
            )}
            {tab === 'debriefs' && (
              <ProjectDebriefsTab
                project={project}
                debriefs={detail.debriefs}
                onChanged={refresh}
                onRdvDebrief={onRdvDebrief}
              />
            )}
            {tab === 'photos' && (
              <ProjectPhotosTab project={project} attachments={detail.attachments} onChanged={refresh} />
            )}
            {tab === 'documents' && (
              <ProjectDocumentsTab project={project} attachments={detail.attachments} onChanged={refresh} />
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function KpiRow({ icon, label, value }: { icon: 'edit' | 'phone' | 'grid'; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="inline-flex items-center gap-2 text-[12px] text-muted">
        <Icon name={icon} size={14} className="text-faint" />
        {label}
      </div>
      <div className="font-black text-base text-text tabular-nums">{value}</div>
    </div>
  )
}

function tabBadgeCount(tab: Tab, detail: ProjectDetailResponse): number {
  if (tab === 'devis') return detail.devis.length
  if (tab === 'debriefs') return detail.debriefs.length
  if (tab === 'photos') return detail.attachments.filter((a) => a.kind === 'photo').length
  if (tab === 'documents') return detail.attachments.filter((a) => a.kind === 'document' || a.kind === 'autre').length
  return 0
}
