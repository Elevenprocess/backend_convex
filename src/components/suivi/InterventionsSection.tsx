import { useState } from 'react'
import { useInterventions } from '../../lib/hooks'
import { interventionFileRawUrl, uploadInterventionFiles } from '../../lib/api'
import { FileDropzone } from '../FileDropzone'
import { displayFilename } from '../../lib/filename'
import type { InterventionResponse, InterventionStatus, InterventionType } from '../../lib/types'

const TYPE_LABEL: Record<InterventionType, string> = {
  reparation: 'Réparation',
  maintenance: 'Maintenance',
  garantie: 'Garantie',
  autre: 'Autre',
}

const STATUS_LABEL: Record<InterventionStatus, string> = {
  planifiee: 'Planifiée',
  realisee: 'Réalisée',
  a_refaire: 'À refaire',
}

const STATUS_CLS: Record<InterventionStatus, string> = {
  planifiee: 'bg-info/10 text-info',
  realisee: 'bg-success/10 text-success',
  a_refaire: 'bg-danger/10 text-danger',
}

function fmtDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Historique SAV d'un dossier (fiche client) : interventions post-livraison
 * avec statut, observations et photos/fiches. `canManage` (équipe délivrabilité
 * / admin / technicien) autorise l'ajout de fichiers sur une intervention.
 * La création/clôture complète se fait sur la page /interventions.
 */
export function InterventionsSection({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const { data, loading, refetch } = useInterventions({ clientId })
  const rows = data ?? []

  if (loading && rows.length === 0) return null
  if (rows.length === 0) return null

  return (
    <section className="mt-7">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Interventions SAV · {rows.length}
      </h3>
      <div className="space-y-3">
        {rows.map((row) => (
          <InterventionCard key={row.id} row={row} canManage={canManage} onChanged={refetch} />
        ))}
      </div>
    </section>
  )
}

function InterventionCard({
  row,
  canManage,
  onChanged,
}: {
  row: InterventionResponse
  canManage: boolean
  onChanged: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const realisee = fmtDate(row.dateRealisee)
  const planifiee = fmtDate(row.datePlanifiee)

  const upload = async (files: File[]) => {
    setUploading(true)
    setError(null)
    try {
      await uploadInterventionFiles(row.id, files)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible')
    } finally {
      setUploading(false)
    }
  }

  return (
    <article className="rounded-xl border border-line px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_CLS[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-line-soft text-muted">
          {TYPE_LABEL[row.type]}
        </span>
        <span className="text-xs text-muted">
          {row.status === 'realisee' && realisee ? `le ${realisee}` : planifiee ? `prévue le ${planifiee}` : null}
          {row.technicienName ? ` · ${row.technicienName}` : ''}
        </span>
      </div>
      <p className="text-sm font-semibold mt-1.5">{row.motif}</p>
      {row.observations && (
        <p className="text-xs mt-1.5 rounded-lg bg-line-soft/50 px-3 py-2 whitespace-pre-wrap">{row.observations}</p>
      )}
      {row.files.length > 0 && (
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
                className="text-xs font-semibold text-or hover:underline"
              >
                {displayFilename(f.filename)}
              </a>
            ),
          )}
        </div>
      )}
      {canManage && (
        <div className="mt-2">
          <FileDropzone
            id={`intervention-section-files-${row.id}`}
            title="Déposer photos / fiche d'intervention"
            subtitle="Images ou PDF, 25 Mo max"
            multiple
            accept="image/*,application/pdf"
            uploading={uploading}
            onFiles={(files) => void upload(files)}
          />
        </div>
      )}
      {error && <p className="wf-modal-error mt-2">{error}</p>}
    </article>
  )
}
