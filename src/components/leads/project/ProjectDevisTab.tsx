import { useState } from 'react'
import { Spinner } from '../../Spinner'
import { DevisList } from '../../devis/DevisList'
import { ApiError, uploadDevis } from '../../../lib/api'
import type { Devis, ProjectResponse } from '../../../lib/types'

type Props = {
  project: ProjectResponse
  devis: Devis[]
  onChanged: () => void
}

export function ProjectDevisTab({ project, devis, onChanged }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    if (file.type !== 'application/pdf') {
      setError('Seul un PDF est accepté.')
      return
    }
    setUploading(true)
    try {
      await uploadDevis(project.leadId, undefined, file, {
        projectName: project.name,
        installationAddress: project.addressLine ?? undefined,
        projectId: project.id,
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Upload échoué.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      <label
        htmlFor={`devis-upload-${project.id}`}
        className={`block rounded-xl border-2 border-dashed px-6 py-6 text-center cursor-pointer transition-colors ${
          uploading ? 'border-or bg-or-tint' : 'border-line hover:border-or hover:bg-cream'
        }`}
      >
        <input
          id={`devis-upload-${project.id}`}
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
        {uploading ? (
          <div className="inline-flex items-center gap-2 text-or-dark text-sm font-bold">
            <Spinner size={14} /> Upload en cours…
          </div>
        ) : (
          <div>
            <div className="font-bold text-sm text-text">Déposer un devis Solteo (PDF)</div>
            <div className="text-[12px] text-muted mt-1">L'IA analysera automatiquement le PDF.</div>
          </div>
        )}
      </label>

      {error && (
        <div className="rounded-lg border border-rouille/30 bg-rouille-tint px-3 py-2 text-[12px] text-rouille">
          {error}
        </div>
      )}

      <DevisList devisList={devis} onChange={() => onChanged()} />
    </div>
  )
}
