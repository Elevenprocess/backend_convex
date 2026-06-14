import { useState } from 'react'
import { Icon } from '../Icon'
import { useClients, useUsers } from '../../lib/hooks'
import { assignTechnicienVt } from '../../lib/api'
import { useAuth } from '../../lib/auth'

type Props = { leadId: string }

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function TechnicienVtPicker({ leadId }: Props) {
  const role = useAuth((s) => s.user?.role)
  const canAssign = role === 'admin' || role === 'responsable_technique' || role === 'back_office'
  const { data: clients = [], refetch } = useClients({ leadId })
  const { data: users = [] } = useUsers()
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  const client = (clients ?? [])[0]
  const techniciens = (users ?? []).filter((u) => u.role === 'technicien')

  // Le bloc technicien VT ne concerne que les rôles qui l'attribuent réellement
  // (amont technique). Pour la délivrabilité / finances qui ne font que des
  // démarches administratives, on ne l'affiche pas du tout — il polluait l'en-tête.
  if (!client || !canAssign) return null

  const current = techniciens.find((t) => t.id === client.technicienVtId) ?? null

  const onChange = async (technicienVtId: string) => {
    setSaving(true)
    try {
      await assignTechnicienVt(client.id, technicienVtId || null)
      await refetch()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  // Vue par défaut : carte du technicien attribué (ou état « à attribuer »).
  const showCard = !editing

  return (
    <aside className="suivi-side glass-card tech-picker">
      <header className="suivi-side-head tech-picker-head">
        <strong><Icon name="users" size={14} /> Technicien VT</strong>
        {current && !editing && (
          <button type="button" className="tech-picker-edit" onClick={() => setEditing(true)} disabled={saving}>
            Modifier
          </button>
        )}
      </header>

      {showCard ? (
        current ? (
          <div className="tech-picker-card is-assigned">
            <span className="tech-picker-avatar">{initials(current.name)}</span>
            <div className="tech-picker-info">
              <span className="tech-picker-name">{current.name}</span>
              <span className="tech-picker-role"><Icon name="check" size={11} /> Technicien attribué</span>
            </div>
          </div>
        ) : (
          <button type="button" className="tech-picker-card is-empty" onClick={() => setEditing(true)} disabled={saving}>
            <span className="tech-picker-avatar is-empty">?</span>
            <div className="tech-picker-info">
              <span className="tech-picker-name">Aucun technicien</span>
              <span className="tech-picker-role">Cliquer pour attribuer →</span>
            </div>
          </button>
        )
      ) : (
        <div className="tech-picker-editor">
          <select
            className="tech-picker-select"
            value={client.technicienVtId ?? ''}
            disabled={saving}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Aucun technicien — à attribuer</option>
            {techniciens.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {current && (
            <button type="button" className="tech-picker-cancel" onClick={() => setEditing(false)} disabled={saving}>
              Annuler
            </button>
          )}
          {saving && <span className="tech-picker-saving">Enregistrement…</span>}
        </div>
      )}
    </aside>
  )
}
