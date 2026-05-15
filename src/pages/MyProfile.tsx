import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { updateMyProfile, useGhlMySector } from '../lib/hooks'
import { useAuth, useCurrentUser } from '../lib/auth'
import { roleLabel, teamLabel } from '../lib/role'
import { Icon } from '../components/Icon'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'

const formatDate = (value: string | null) => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function MyProfile() {
  const user = useCurrentUser()
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [image, setImage] = useState<string | null>(user.image ?? null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: ghlSector } = useGhlMySector(user.role === 'commercial' && Boolean(user.ghlUserId))
  const sectorInfo = useMemo(() => deriveSectorInfo(user, ghlSector), [ghlSector, user])

  const initials = useMemo(() => {
    const parts = (name || user.email).split(/[\s@._-]+/).filter(Boolean)
    return (parts[0]?.[0] ?? 'U') + (parts[1]?.[0] ?? '')
  }, [name, user.email])

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setMessage(null)
    if (!file.type.startsWith('image/')) {
      setError('Choisis une image valide.')
      return
    }
    try {
      const resized = await resizeProfilePhoto(file)
      setImage(resized)
      setMessage('Photo prête. Clique sur Enregistrer pour la sauvegarder.')
    } catch (e) {
      setError((e as Error).message || 'Impossible de lire cette photo.')
    } finally {
      event.target.value = ''
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await updateMyProfile({
        name: name.trim(),
        phone: phone.trim() || null,
        image,
      })
      useAuth.setState({ user: updated, status: 'authed', error: null })
      setMessage('Profil mis à jour.')
    } catch (e) {
      setError((e as Error).message || 'Impossible de mettre à jour le profil.')
    } finally {
      setSaving(false)
    }
  }

  const accountRows = [
    ['Email', user.email],
    ['Téléphone', user.phone || '—'],
    ['Dernière connexion', formatDate(user.lastLoginAt)],
    ['Dernière activité', user.lastActionAt ? `${formatDate(user.lastActionAt)}${user.lastActionType ? ` · ${user.lastActionType}` : ''}` : '—'],
    ['Créé le', formatDate(user.createdAt)],
    ['Mis à jour le', formatDate(user.updatedAt)],
  ]

  const integrationRows = [
    ['Secteur principal', sectorInfo.label],
    ['Tous secteurs', sectorInfo.allLabels],
    ['GHL user ID', user.ghlUserId || '—'],
    ['GHL calendar ID', user.ghlCalendarId || sectorInfo.calendarId || '—'],
    ['GHL location ID', user.ghlLocationId || '—'],
  ]

  const profileStats = [
    ['Rôle', roleLabel(user.role)],
    ['Équipe', teamLabel(user.team)],
    ['Statut', user.active ? 'Actif' : 'Inactif'],
  ]

  return (
    <AppShell flat>
      <Topbar eyebrow="MON COMPTE" title="Voir mon profil" />
      <main className="profile-page flex-grow overflow-auto px-6 pt-4 pb-8 md:px-8">
        <div className="mx-auto max-w-6xl space-y-5">
          <section className="profile-hero-card glass-card border border-line-soft bg-white p-5 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <div className="profile-avatar-shell shrink-0 self-center md:self-auto">
                <div className="profile-avatar-ring">
                  <div className="profile-avatar-photo">
                    {image ? (
                      <img src={image} alt="Photo de profil" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-5xl font-black text-or-dark uppercase">{initials}</span>
                    )}
                  </div>
                </div>
                <span className="profile-avatar-badge">ECOI</span>
              </div>

              <div className="min-w-0 flex-1 text-center md:text-left">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="eyebrow text-or-dark">Profil professionnel</p>
                    <h1 className="mt-1 truncate text-3xl font-black tracking-tight md:text-4xl">{user.name}</h1>
                    <p className="mt-1 truncate text-sm font-semibold text-muted">{user.email}</p>
                  </div>
                  <label className="profile-photo-button mx-auto md:mx-0">
                    <Icon name="plus" size={15} />
                    Changer la photo
                    <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
                  </label>
                </div>

                <div className="profile-stat-strip mt-5">
                  {profileStats.map(([label, value]) => (
                    <div key={label} className="profile-stat-pill">
                      <div className="text-sm font-black truncate">{value}</div>
                      <div className="eyebrow text-[9px]">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                  <span className="profile-chip profile-chip-dark">{roleLabel(user.role)}</span>
                  <span className="profile-chip profile-chip-soft">{teamLabel(user.team)}</span>
                  <span className="profile-chip profile-chip-success">{user.active ? 'Compte actif' : 'Compte inactif'}</span>
                  {user.role === 'commercial' && <span className="profile-chip profile-chip-info">Secteur GHL : {sectorInfo.label}</span>}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
            <form onSubmit={handleSubmit} className="profile-edit-card glass-card border border-line-soft bg-white p-5 md:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow text-or-dark">Édition rapide</p>
                  <h2 className="mt-1 text-lg font-black">Modifier mon profil</h2>
                  <p className="text-sm text-muted">Nom, téléphone et photo de profil.</p>
                </div>
                <div className="profile-card-icon">
                  <Icon name="users" size={17} />
                </div>
              </div>

              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="eyebrow">Nom complet</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="profile-input w-full rounded-2xl border border-line bg-cream px-4 py-3 outline-none focus:ring-2 focus:ring-or/30" />
                </label>

                <label className="block space-y-2">
                  <span className="eyebrow">Téléphone</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ajouter un numéro" className="profile-input w-full rounded-2xl border border-line bg-cream px-4 py-3 outline-none focus:ring-2 focus:ring-or/30" />
                </label>

                {image && (
                  <button type="button" onClick={() => setImage(null)} className="text-xs font-bold text-muted hover:text-or-dark">Retirer la photo</button>
                )}

                {message && <div className="profile-alert profile-alert-success">{message}</div>}
                {error && <div className="profile-alert profile-alert-error">{error}</div>}

                <button disabled={saving || !name.trim()} className="profile-save-button disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? 'Enregistrement…' : 'Enregistrer mon profil'}
                </button>
              </div>
            </form>

            <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow text-or-dark">Fiche compte</p>
                  <h2 className="text-lg font-black">Informations essentielles</h2>
                  <p className="text-sm text-muted">Présentation simple, lisible et privée.</p>
                </div>
              </div>

              <div className="profile-info-grid">
                {accountRows.map(([label, value]) => (
                  <InfoTile key={label} label={label} value={value} />
                ))}
              </div>

              {user.role === 'commercial' && (
                <div className="profile-integration-panel mt-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="eyebrow text-or-dark">Intégration GHL</p>
                      <h3 className="text-sm font-black">Secteurs et synchronisation</h3>
                    </div>
                    <span className="profile-chip profile-chip-info">{sectorInfo.count || 0} secteur{sectorInfo.count > 1 ? 's' : ''}</span>
                  </div>
                  <div className="profile-info-grid">
                    {integrationRows.map(([label, value]) => (
                      <InfoTile key={label} label={label} value={value} compact />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function InfoTile({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`profile-info-tile ${compact ? 'profile-info-tile-compact' : ''}`}>
      <div className="eyebrow text-[10px]">{label}</div>
      <div className="mt-1 break-words text-sm font-bold">{value}</div>
    </div>
  )
}

type GhlSectorInfo = { label: string; calendarId: string | null; count: number; allLabels: string }

function deriveSectorInfo(
  user: { role: string; ghlUserId?: string | null; ghlCalendarId?: string | null },
  sector?: { linked: boolean; primarySector: string | null; primaryCalendarId: string | null; sectors: Array<{ label: string; calendarId: string }> } | null,
): GhlSectorInfo {
  if (user.role !== 'commercial') return { label: '—', calendarId: null, count: 0, allLabels: '—' }
  if (!user.ghlUserId) return { label: 'Non relié', calendarId: null, count: 0, allLabels: 'Non relié' }
  const labels = Array.from(new Set((sector?.sectors ?? []).map((row) => row.label).filter(Boolean)))
  const label = sector?.primarySector || labels[0] || 'À détecter'
  return {
    label,
    calendarId: sector?.primaryCalendarId || user.ghlCalendarId || null,
    count: labels.length,
    allLabels: labels.length > 1 ? labels.join(', ') : label,
  }
}

function resizeProfilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Impossible de lire cette photo.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Image invalide.'))
      img.onload = () => {
        const maxSize = 512
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const width = Math.max(1, Math.round(img.width * scale))
        const height = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Impossible de préparer la photo.'))
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
