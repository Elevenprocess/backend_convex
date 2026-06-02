import { useState } from 'react'
import { useClients, useUsers } from '../../lib/hooks'
import { assignTechnicienVt } from '../../lib/api'
import { useAuth } from '../../lib/auth'

type Props = { leadId: string }

export function TechnicienVtPicker({ leadId }: Props) {
  const role = useAuth((s) => s.user?.role)
  const canAssign = role === 'admin' || role === 'responsable_technique' || role === 'back_office'
  const { data: clients = [], refetch } = useClients({ leadId })
  const { data: users = [] } = useUsers()
  const [saving, setSaving] = useState(false)

  const client = (clients ?? [])[0]
  const techniciens = (users ?? []).filter((u) => u.role === 'technicien')

  if (!client) return null

  const currentName = techniciens.find((t) => t.id === client.technicienVtId)?.name ?? null

  const onChange = async (technicienVtId: string) => {
    setSaving(true)
    try {
      await assignTechnicienVt(client.id, technicienVtId || null)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="suivi-side glass-card">
      <header className="suivi-side-head">
        <strong>Technicien VT</strong>
      </header>
      {canAssign ? (
        <select
          className="w-full rounded-lg border border-line-soft px-3 py-2 text-sm"
          value={client.technicienVtId ?? ''}
          disabled={saving}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Aucun technicien — à attribuer</option>
          {techniciens.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ) : (
        <p className="text-sm">{currentName ?? 'Aucun technicien — à attribuer'}</p>
      )}
    </aside>
  )
}
