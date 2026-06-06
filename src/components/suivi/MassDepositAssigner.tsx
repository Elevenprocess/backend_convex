import { useState } from 'react'
import type { SubstepResponse } from '../../lib/types'
import { uploadSubstepDocuments } from '../../lib/api'

type Props = {
  files: File[]
  targets: SubstepResponse[]
  onCancel: () => void
  onDone: () => void
}

/** Pré-sélection : 1re sous-étape déverrouillée dont un expectedDoc colle au type. */
function guessTarget(file: File, targets: SubstepResponse[]): string {
  const isPdf = file.type === 'application/pdf'
  const isImg = file.type.startsWith('image/')
  const match = targets.find((t) =>
    t.expectedDocs.some((d) => (isPdf && d !== 'autre') || (isImg && d === 'autre')),
  )
  return (match ?? targets[0])?.id ?? ''
}

export function MassDepositAssigner({ files, targets, onCancel, onDone }: Props) {
  const [assign, setAssign] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    files.forEach((f, i) => { init[i] = guessTarget(f, targets) })
    return init
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const bySubstep = new Map<string, File[]>()
      files.forEach((f, i) => {
        const id = assign[i]
        if (!id) return
        const list = bySubstep.get(id) ?? []
        list.push(f)
        bySubstep.set(id, list)
      })
      for (const [substepId, group] of bySubstep) {
        await uploadSubstepDocuments(substepId, group)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'upload")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mass-assign">
      <p className="mass-assign-title">Ranger {files.length} fichier{files.length > 1 ? 's' : ''}</p>
      <ul className="mass-assign-list">
        {files.map((f, i) => (
          <li key={i} className="mass-assign-row">
            <span className="mass-assign-file">{f.name}</span>
            <select
              aria-label={f.name}
              value={assign[i] ?? ''}
              onChange={(e) => setAssign((prev) => ({ ...prev, [i]: e.target.value }))}
            >
              <option value="">— choisir une étape —</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {error && <p className="mass-assign-error">{error}</p>}
      <div className="mass-assign-actions">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Dépôt…' : 'Déposer'}
        </button>
      </div>
    </div>
  )
}
