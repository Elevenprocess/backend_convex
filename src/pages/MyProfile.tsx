import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { updateMyProfile } from '../lib/hooks'
import { useAuth, useCurrentUser } from '../lib/auth'
import { roleLabel, teamLabel } from '../lib/role'
import { Icon } from '../components/Icon'

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
    <main className="min-h-full bg-[#f6f3ee] dark:bg-[#141414] text-[#1f1f1f] dark:text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <section className="rounded-[2rem] bg-white dark:bg-[#1c1c1c] border border-black/5 dark:border-white/10 shadow-sm p-5 md:p-7">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="relative w-28 h-28 rounded-[2rem] overflow-hidden bg-[#e9e2d7] dark:bg-white/10 flex items-center justify-center shrink-0 border border-black/5 dark:border-white/10">
              {image ? (
                <img src={image} alt="Photo de profil" className="w-full h-full object-cover" />
              ) : (
                <span className="text-4xl font-black text-[#9b2f1f] uppercase">{initials}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#9b2f1f]">Mon profil</p>
              <h1 className="mt-2 text-3xl md:text-4xl font-black tracking-tight">{user.name}</h1>
              <p className="mt-2 text-sm text-black/55 dark:text-white/55">Toutes tes informations personnelles et professionnelles, visibles uniquement pour ton compte.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-black text-white dark:bg-white dark:text-black text-xs font-bold">{roleLabel(user.role)}</span>
                <span className="px-3 py-1 rounded-full bg-[#eef5ee] text-[#27623a] text-xs font-bold">{teamLabel(user.team)}</span>
              </div>
            </div>
          </div>
        </section>

        <div className="grid lg:grid-cols-[420px_1fr] gap-6">
          <form onSubmit={handleSubmit} className="rounded-[2rem] bg-white dark:bg-[#1c1c1c] border border-black/5 dark:border-white/10 shadow-sm p-5 md:p-6 space-y-5">
            <div>
              <h2 className="text-lg font-black">Modifier mon profil</h2>
              <p className="text-sm text-black/50 dark:text-white/50">Nom, téléphone et photo de profil.</p>
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-bold uppercase tracking-widest text-black/45 dark:text-white/45">Nom complet</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 px-4 py-3 outline-none focus:ring-2 focus:ring-[#9b2f1f]/30" />
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-bold uppercase tracking-widest text-black/45 dark:text-white/45">Téléphone</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ajouter un numéro" className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-[#faf8f4] dark:bg-black/20 px-4 py-3 outline-none focus:ring-2 focus:ring-[#9b2f1f]/30" />
            </label>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-widest text-black/45 dark:text-white/45">Photo de profil</span>
              <label className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-[#9b2f1f]/40 bg-[#fff7f3] dark:bg-[#2a1712] px-4 py-4 text-sm font-bold text-[#9b2f1f] cursor-pointer hover:bg-[#fff0e8]">
                <Icon name="plus" size={16} />
                Ajouter / changer la photo
                <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
              </label>
              {image && (
                <button type="button" onClick={() => setImage(null)} className="text-xs font-bold text-black/45 dark:text-white/45 hover:text-[#9b2f1f]">Retirer la photo</button>
              )}
            </div>

            {message && <div className="rounded-2xl bg-[#eef8ee] text-[#256335] px-4 py-3 text-sm font-semibold">{message}</div>}
            {error && <div className="rounded-2xl bg-[#fff0ed] text-[#9b2f1f] px-4 py-3 text-sm font-semibold">{error}</div>}

            <button disabled={saving || !name.trim()} className="w-full rounded-2xl bg-[#9b2f1f] text-white py-3 font-black disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Enregistrement…' : 'Enregistrer mon profil'}
            </button>
          </form>

          <section className="rounded-[2rem] bg-white dark:bg-[#1c1c1c] border border-black/5 dark:border-white/10 shadow-sm p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-lg font-black">Informations du compte</h2>
                <p className="text-sm text-black/50 dark:text-white/50">Détails complets de ton profil ECOI.</p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {infoRows.map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-[#faf8f4] dark:bg-black/20 border border-black/5 dark:border-white/5 p-4 min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-black/40 dark:text-white/35">{label}</div>
                  <div className="mt-1 text-sm font-bold break-words">{value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
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
