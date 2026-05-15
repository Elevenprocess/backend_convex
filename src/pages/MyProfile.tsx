import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { updateMyProfile } from '../lib/hooks'
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

  const infoRows = [
    ['Email', user.email],
    ['Rôle', roleLabel(user.role)],
    ['Équipe', teamLabel(user.team)],
    ['Téléphone', user.phone || '—'],
    ['Compte actif', user.active ? 'Oui' : 'Non'],
    ['Dernière connexion', formatDate(user.lastLoginAt)],
    ['Dernière activité', user.lastActionAt ? `${formatDate(user.lastActionAt)}${user.lastActionType ? ` · ${user.lastActionType}` : ''}` : '—'],
    ['Créé le', formatDate(user.createdAt)],
    ['Mis à jour le', formatDate(user.updatedAt)],
    ['GHL user ID', user.ghlUserId || '—'],
    ['GHL calendar ID', user.ghlCalendarId || '—'],
    ['GHL location ID', user.ghlLocationId || '—'],
  ]

  return (
    <AppShell flat>
      <Topbar eyebrow="MON COMPTE" title="Voir mon profil" />
      <main className="flex-grow overflow-auto px-8 pt-4 pb-8">
        <div className="max-w-6xl mx-auto space-y-5">
          <section className="glass-card border border-line-soft bg-white p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="relative w-24 h-24 rounded-[28px] overflow-hidden bg-cream-darker flex items-center justify-center shrink-0 border border-line-soft">
              {image ? (
                <img src={image} alt="Photo de profil" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-black text-rouille uppercase">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow text-rouille">Mon profil</p>
              <h1 className="mt-2 text-3xl md:text-4xl font-black tracking-tight">{user.name}</h1>
              <p className="mt-2 text-sm text-muted">Toutes tes informations personnelles et professionnelles, visibles uniquement pour ton compte.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="status-badge bg-text text-white">{roleLabel(user.role)}</span>
                <span className="status-badge bg-success-tint text-success">{teamLabel(user.team)}</span>
              </div>
            </div>
          </div>
        </section>

          <div className="grid lg:grid-cols-[390px_1fr] gap-5">
          <form onSubmit={handleSubmit} className="glass-card border border-line-soft bg-white p-5 md:p-6 space-y-5">
            <div>
              <h2 className="text-lg font-black">Modifier mon profil</h2>
              <p className="text-sm text-muted">Nom, téléphone et photo de profil.</p>
            </div>

            <label className="block space-y-2">
              <span className="eyebrow">Nom complet</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-line bg-cream px-4 py-3 outline-none focus:ring-2 focus:ring-or/30" />
            </label>

            <label className="block space-y-2">
              <span className="eyebrow">Téléphone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ajouter un numéro" className="w-full rounded-2xl border border-line bg-cream px-4 py-3 outline-none focus:ring-2 focus:ring-or/30" />
            </label>

            <div className="space-y-2">
              <span className="eyebrow">Photo de profil</span>
              <label className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-rouille/40 bg-rouille-tint px-4 py-4 text-sm font-bold text-rouille cursor-pointer hover:bg-cream-darker">
                <Icon name="plus" size={16} />
                Ajouter / changer la photo
                <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
              </label>
              {image && (
                <button type="button" onClick={() => setImage(null)} className="text-xs font-bold text-muted hover:text-rouille">Retirer la photo</button>
              )}
            </div>

            {message && <div className="rounded-2xl bg-success-tint text-success px-4 py-3 text-sm font-semibold">{message}</div>}
            {error && <div className="rounded-2xl bg-rouille-tint text-rouille px-4 py-3 text-sm font-semibold">{error}</div>}

            <button disabled={saving || !name.trim()} className="w-full rounded-2xl bg-rouille text-white py-3 font-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-rouille/90">
              {saving ? 'Enregistrement…' : 'Enregistrer mon profil'}
            </button>
          </form>

          <section className="glass-card border border-line-soft bg-white p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-lg font-black">Informations du compte</h2>
                <p className="text-sm text-muted">Détails complets de ton profil ECOI.</p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {infoRows.map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-cream border border-line-soft p-4 min-w-0">
                  <div className="eyebrow text-[10px]">{label}</div>
                  <div className="mt-1 text-sm font-bold break-words">{value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      </main>
    </AppShell>
  )
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
