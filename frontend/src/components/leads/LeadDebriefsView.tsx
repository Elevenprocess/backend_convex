import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { LoadingBlock } from '../Spinner'
import {
  deleteDebrief,
  listDebriefsByProject,
  listProjectsByLead,
} from '../../lib/api'
import { fullName, type DebriefResponse, type LeadResponse } from '../../lib/types'
import { DebriefRow } from './project/ProjectDebriefsTab'

type Props = {
  lead: LeadResponse
  onClose: () => void
  onBack?: () => void
  onChanged?: () => void
  className?: string
}

type DebriefWithProject = DebriefResponse & { projectName: string }

/**
 * Vue « débriefs existants » d'un lead : agrège les débriefs de tous ses projets
 * (lecture + suppression). Remplace l'ancien wizard de débriefing commercial.
 */
export function LeadDebriefsView({ lead, onClose, onBack, onChanged, className = '' }: Props) {
  const [debriefs, setDebriefs] = useState<DebriefWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listProjectsByLead(lead.id)
      .then(async (projects) => {
        const perProject = await Promise.all(
          projects.map((p) =>
            listDebriefsByProject(p.id)
              .then((rows) => rows.map((d) => ({ ...d, projectName: p.name })))
              .catch(() => [] as DebriefWithProject[]),
          ),
        )
        if (cancelled) return
        const merged = perProject
          .flat()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setDebriefs(merged)
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger les débriefs.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lead.id, refreshKey])

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer ce débrief ?')) return
    try {
      await deleteDebrief(id)
      setRefreshKey((k) => k + 1)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression échouée.')
    }
  }

  return (
    <aside className={`flex flex-col w-full md:w-[460px] max-w-full md:max-w-[92vw] overflow-y-auto border-l border-line bg-white/95 backdrop-blur-2xl shadow-2xl ${className}`}>
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-4 backdrop-blur-2xl">
        {onBack && (
          <button type="button" onClick={onBack} className="absolute left-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Retour">
            <Icon name="arrow-left" size={16} />
          </button>
        )}
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Fermer">
          <Icon name="x" size={16} />
        </button>
        <div className="eyebrow text-or-dark">Débriefs</div>
        <h2 className="mt-1 pr-8 text-base font-black text-text">{fullName(lead)}</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 rounded-xl bg-rouille-tint px-3 py-2 text-xs text-rouille">{error}</div>
        )}
        {loading ? (
          <LoadingBlock label="Chargement des débriefs…" />
        ) : debriefs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white/40 px-4 py-6 text-center text-xs text-muted">
            Aucun débrief pour ce client. Ajoute-en un depuis l'onglet « Débriefs » d'un projet.
          </div>
        ) : (
          <ul className="space-y-2">
            {debriefs.map((d) => (
              <DebriefRow
                key={d.id}
                debrief={d}
                projectName={d.projectName}
                onDelete={() => void handleDelete(d.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
