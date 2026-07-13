import { useState } from 'react'
import { FileDropzone } from '../../FileDropzone'
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

      {error && (
        <div className="rounded-lg border border-rouille/30 bg-rouille-tint px-3 py-2 text-[12px] text-rouille">
          {error}
        </div>
      )}

      <DevisList devisList={devis} onChange={() => onChanged()} />
    </div>
  )
}
