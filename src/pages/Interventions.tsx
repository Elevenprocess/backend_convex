import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { Icon } from '../components/Icon'
import { FileDropzone } from '../components/FileDropzone'
import { useAuth } from '../lib/auth'
import { useClients, useInterventions, useUsers } from '../lib/hooks'
import { buildTerrainInterventions, TERRAIN_TYPE_LABEL, type TerrainIntervention } from '../lib/interventionsTerrain'
import {
  createIntervention,
  deleteIntervention,
  interventionFileRawUrl,
  updateIntervention,
  uploadInterventionFiles,
} from '../lib/api'
import type {
  ClientResponse,
  InterventionResponse,
  InterventionStatus,
  InterventionType,
} from '../lib/types'
import { displayFilename } from '../lib/filename'

export const INTERVENTION_TYPE_LABEL: Record<InterventionType, string> = {
  reparation: 'Réparation',
  maintenance: 'Maintenance',
  garantie: 'Garantie',
  autre: 'Autre',
}

export const INTERVENTION_STATUS_LABEL: Record<InterventionStatus, string> = {
  planifiee: 'Planifiée',
  realisee: 'Réalisée',
  a_refaire: 'À refaire',
}

const STATUS_BADGE_CLS: Record<InterventionStatus, string> = {
  planifiee: 'bg-info/10 text-info',
  realisee: 'bg-success/10 text-success',
  a_refaire: 'bg-danger/10 text-danger',
}

type StatusFilter = 'all' | InterventionStatus

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'planifiee', label: 'Planifiées' },
  { id: 'realisee', label: 'Réalisées' },
  { id: 'a_refaire', label: 'À refaire' },
]

const TEAM_ROLES = new Set(['admin', 'delivrabilite', 'responsable_technique', 'back_office'])

// Un dossier est éligible au SAV quand l'installation est livrée (MES faite
// ou dossier clôturé).
export function isDeliveredClient(c: ClientResponse): boolean {
  return c.steps?.mes?.status === 'fait' || c.statusGlobal === 'cloture'
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function Interventions() {
  const me = useAuth((s) => s.user)
  const role = me?.role
  const isTeam = role != null && TEAM_ROLES.has(role)
  const { data, loading, error, refetch } = useInterventions()
  // VT + installations planifiées/réalisées dans les étapes des dossiers en
  // suivi : affichées ici aux côtés du SAV, en lecture seule.
  const { data: clients } = useClients()
  const { data: users } = useUsers()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [closing, setClosing] = useState<InterventionResponse | null>(null)

  const terrain = useMemo(() => {
    const usersById = new Map((users ?? []).map((u) => [u.id, u.name]))
    return buildTerrainInterventions(clients ?? [], usersById)
  }, [clients, users])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!q) return true
      return [row.client.fullName, row.client.city, row.motif, row.technicienName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [data, statusFilter, query])

  const terrainRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return terrain.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!q) return true
      return [row.clientName, row.city, TERRAIN_TYPE_LABEL[row.type], ...row.technicienNames]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [terrain, statusFilter, query])

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      refetch()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Action impossible')
    }
  }

  return (
    <AppShell flat>
      <Topbar eyebrow="DÉLIVRABILITÉ / SAV" title="Interventions & réparations" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <header className="suivi-hero">
          <div>
            <span className="eyebrow">Après livraison</span>
            <h1>Interventions sur installations réalisées</h1>
            <p>Réparations, maintenance et passages garantie, avec observations et photos.</p>
          </div>
          <div className="suivi-hero-actions">
            <input
              type="search"
              placeholder="Rechercher (client, motif, technicien)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="suivi-search"
            />
            {isTeam && (
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={14} /> Nouvelle intervention
              </button>
            )}
          </div>
        </header>

        <section className="suivi-filters" aria-label="Filtres de statut">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={statusFilter === f.id ? 'active' : ''}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </section>

        {loading ? (
          <LoadingBlock label="Chargement des interventions…" />
        ) : error ? (
          <p className="wf-modal-error">{error}</p>
        ) : rows.length === 0 && terrainRows.length === 0 ? (
          <div className="suivi-empty">
            <p>{statusFilter !== 'all' || query ? 'Aucune intervention ne correspond aux filtres.' : 'Aucune intervention enregistrée pour le moment.'}</p>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {terrainRows.map((row) => (
              <TerrainInterventionCard key={row.id} row={row} />
            ))}
            {rows.map((row) => {
              const canClose = row.status !== 'realisee' && (isTeam || (role === 'technicien' && row.technicienId === me?.id))
              return (
                <article key={row.id} className="glass-card p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="text-sm">{row.client.fullName || '—'}</strong>
                        {row.client.city && <span className="text-xs text-muted">· {row.client.city}</span>}
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_BADGE_CLS[row.status]}`}>
                          {INTERVENTION_STATUS_LABEL[row.status]}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-line-soft text-muted">
                          {INTERVENTION_TYPE_LABEL[row.type]}
                        </span>
                      </div>
                      <p className="text-sm mt-1">{row.motif}</p>
                      <p className="text-xs text-muted mt-1">
                        {row.technicienName ? `Technicien : ${row.technicienName} · ` : ''}
                        {row.status === 'realisee'
                          ? `Réalisée le ${fmtDate(row.dateRealisee)}`
                          : `Planifiée le ${fmtDate(row.datePlanifiee)}${row.heure ? ` à ${row.heure}` : ''}`}
                      </p>
                      {row.observations && (
                        <p className="text-xs mt-2 rounded-lg bg-line-soft/50 px-3 py-2 whitespace-pre-wrap">{row.observations}</p>
                      )}
                      <InterventionFilesRow row={row} />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canClose && (
                        <button type="button" className="text-xs font-bold text-or hover:underline" onClick={() => setClosing(row)}>
                          Clôturer
                        </button>
                      )}
                      {isTeam && row.status === 'realisee' && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-muted hover:underline"
                          onClick={() => void act(() => updateIntervention(row.id, { status: 'a_refaire' }))}
                        >
                          À refaire
                        </button>
                      )}
                      {isTeam && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-danger/70 hover:text-danger"
                          aria-label="Supprimer l'intervention"
                          onClick={() => {
                            if (window.confirm('Supprimer cette intervention ?')) void act(() => deleteIntervention(row.id))
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {creating && <NewInterventionModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch() }} />}
        {closing && <CloseInterventionModal intervention={closing} onClose={() => setClosing(null)} onSaved={() => { setClosing(null); refetch() }} />}
      </main>
    </AppShell>
  )
}

// Intervention « terrain » (VT / installation) issue des étapes du dossier :
// lecture seule ici, elle se pilote depuis la fiche suivi du dossier.
function TerrainInterventionCard({ row }: { row: TerrainIntervention }) {
  const navigate = useNavigate()
  return (
    <article className="glass-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-sm">{row.clientName || '—'}</strong>
            {row.city && <span className="text-xs text-muted">· {row.city}</span>}
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_BADGE_CLS[row.status]}`}>
              {INTERVENTION_STATUS_LABEL[row.status]}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-or/10 text-or-dark">
              {TERRAIN_TYPE_LABEL[row.type]}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            {row.technicienNames.length > 0 ? `Technicien : ${row.technicienNames.join(', ')} · ` : ''}
            {row.status === 'realisee' ? `Réalisée le ${fmtDate(row.date)}` : `Planifiée le ${fmtDate(row.date)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-xs font-bold text-or hover:underline"
            onClick={() => navigate(`/suivi/${row.leadId}/fiche`)}
          >
            Voir le dossier
          </button>
        </div>
      </div>
    </article>
  )
}

// Vignettes photos + liens fichiers d'une intervention.
function InterventionFilesRow({ row }: { row: InterventionResponse }) {
  if (row.files.length === 0) return null
  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {row.files.map((f) =>
        f.mimeType.startsWith('image/') ? (
          <a key={f.id} href={interventionFileRawUrl(row.id, f.id)} target="_blank" rel="noreferrer" title={displayFilename(f.filename)}>
            <img
              src={interventionFileRawUrl(row.id, f.id)}
              alt={displayFilename(f.filename)}
              className="h-16 w-16 object-cover rounded-lg border border-line"
            />
          </a>
        ) : (
          <a
            key={f.id}
            href={interventionFileRawUrl(row.id, f.id)}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-or hover:underline inline-flex items-center gap-1"
          >
            <Icon name="download" size={12} /> {displayFilename(f.filename)}
          </a>
        ),
      )}
    </div>
  )
}

function NewInterventionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: clients } = useClients()
  const { data: users } = useUsers()
  const techniciens = (users ?? []).filter((u) => u.role === 'technicien')
  const delivered = useMemo(() => (clients ?? []).filter(isDeliveredClient), [clients])
  const [clientId, setClientId] = useState('')
  const [type, setType] = useState<InterventionType>('reparation')
  const [motif, setMotif] = useState('')
  const [technicienId, setTechnicienId] = useState('')
  const [date, setDate] = useState('')
  const [heure, setHeure] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!clientId || !motif.trim()) {
      setError('Choisissez un dossier et renseignez le motif.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createIntervention({
        clientId,
        type,
        motif: motif.trim(),
        technicienId: technicienId || null,
        datePlanifiee: date ? new Date(`${date}T${heure || '08:00'}:00`).toISOString() : null,
        heure: heure || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible')
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Nouvelle intervention" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">SAV</span>
            <h2>Nouvelle intervention</h2>
            <p className="fiche-modal-sub">Sur une installation déjà réalisée (MES faite ou dossier clôturé).</p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>
        <div className="fiche-modal-body">
          <section className="wf-modal-section">
            <h3>Dossier</h3>
            <select className="wf-modal-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Choisir un dossier livré —</option>
              {delivered.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.lead.fullName || c.lead.phone || c.id)}{c.lead.city ? ` · ${c.lead.city}` : ''}
                </option>
              ))}
            </select>
            {delivered.length === 0 && <p className="text-xs text-faint mt-1">Aucun dossier livré pour le moment.</p>}
          </section>
          <section className="wf-modal-section">
            <h3>Type</h3>
            <select className="wf-modal-input" value={type} onChange={(e) => setType(e.target.value as InterventionType)}>
              {(Object.keys(INTERVENTION_TYPE_LABEL) as InterventionType[]).map((t) => (
                <option key={t} value={t}>{INTERVENTION_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </section>
          <section className="wf-modal-section">
            <h3>Motif</h3>
            <textarea className="wf-modal-input" rows={2} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex : onduleur en défaut, infiltration…" />
          </section>
          <section className="wf-modal-section">
            <h3>Technicien (optionnel)</h3>
            <select className="wf-modal-input" value={technicienId} onChange={(e) => setTechnicienId(e.target.value)}>
              <option value="">— Non assigné —</option>
              {techniciens.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </section>
          <section className="wf-modal-section">
            <h3>Date planifiée (optionnelle)</h3>
            <div className="flex gap-2">
              <input className="wf-modal-input flex-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <input className="wf-modal-input w-28" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
            </div>
          </section>
          {error && <p className="wf-modal-error">{error}</p>}
        </div>
        <footer className="wf-modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Création…' : "Créer l'intervention"}
          </button>
        </footer>
      </div>
    </div>
  )
}

function CloseInterventionModal({
  intervention,
  onClose,
  onSaved,
}: {
  intervention: InterventionResponse
  onClose: () => void
  onSaved: () => void
}) {
  const [observations, setObservations] = useState(intervention.observations ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (files.length) await uploadInterventionFiles(intervention.id, files)
      await updateIntervention(intervention.id, {
        status: 'realisee',
        observations: observations.trim() || null,
        dateRealisee: new Date().toISOString(),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clôture impossible')
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Clôturer l'intervention" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Clôture · {INTERVENTION_TYPE_LABEL[intervention.type]}</span>
            <h2>{intervention.client.fullName ?? 'Client'}</h2>
            <p className="fiche-modal-sub">{intervention.motif}</p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>
        <div className="fiche-modal-body">
          <section className="wf-modal-section">
            <h3>Observations</h3>
            <textarea
              className="wf-modal-input"
              rows={4}
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              placeholder="Travail effectué, pièces remplacées, points de vigilance…"
            />
          </section>
          <section className="wf-modal-section">
            <h3>Photos / fiche d'intervention</h3>
            <FileDropzone
              id={`intervention-files-${intervention.id}`}
              title="Déposer photos ou PDF"
              subtitle="Images du chantier, fiche d'intervention signée…"
              multiple
              accept="image/*,application/pdf"
              uploading={saving}
              onFiles={(list) => setFiles((prev) => [...prev, ...list])}
            />
            {files.length > 0 && (
              <p className="text-xs text-muted mt-1">{files.length} fichier{files.length > 1 ? 's' : ''} à envoyer : {files.map((f) => displayFilename(f.name)).join(', ')}</p>
            )}
          </section>
          {error && <p className="wf-modal-error">{error}</p>}
        </div>
        <footer className="wf-modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Clôture…' : 'Marquer réalisée'}
          </button>
        </footer>
      </div>
    </div>
  )
}
