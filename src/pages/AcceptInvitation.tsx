import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { acceptInvitation } from '../lib/hooks'
import { Spinner } from '../components/Spinner'

export function AcceptInvitation() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (loading || done) return
    setError(null)
    if (!token) {
      setError('Lien d’invitation invalide.')
      return
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }
    setLoading(true)
    try {
      await acceptInvitation({ token, password })
      setDone(true)
      window.setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation impossible')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ivoire px-4">
      <form onSubmit={submit} className="glass-card w-full max-w-md p-8 space-y-5">
        <div>
          <div className="eyebrow text-or">ECOI</div>
          <h1 className="text-2xl font-bold mt-1">Créer votre mot de passe</h1>
          <p className="text-sm text-muted mt-2">Finalisez votre accès à la plateforme.</p>
        </div>

        {!token && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">Lien d’invitation manquant.</div>}
        {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
        {done && <div className="rounded-xl bg-success-tint px-3 py-2 text-sm text-success">Compte créé. Redirection vers la connexion…</div>}

        <label className="block text-sm">
          <span className="eyebrow text-faint">Mot de passe</span>
          <input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white/70 px-3 py-2 outline-none focus:border-or" />
        </label>

        <label className="block text-sm">
          <span className="eyebrow text-faint">Confirmer</span>
          <input type="password" minLength={8} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white/70 px-3 py-2 outline-none focus:border-or" />
        </label>

        <button disabled={loading || done || !token} className="btn-primary w-full rounded-xl py-2.5 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
          {loading ? <Spinner size={18} stroke={3} label="Création…" /> : done ? 'Compte créé' : 'Créer mon compte'}
        </button>

        <div className="text-center text-sm text-muted">
          <Link to="/login" className="hover:text-text font-semibold">Retour connexion</Link>
        </div>
      </form>
    </main>
  )
}
