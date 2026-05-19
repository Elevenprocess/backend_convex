import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Spinner } from '../components/Spinner'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const signIn = useAuth((s) => s.signIn)

  const fromState = (location.state as { from?: string } | null)?.from
  const redirectTo = fromState && fromState !== '/login' ? fromState : '/overview'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? 'E-mail ou mot de passe incorrect.'
            : err.message,
        )
      } else {
        setError((err as Error).message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative w-full h-screen bg-cream overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/40793.jpg')" }}
      />
      <div className="absolute inset-0 bg-noir/28" />

      <div className="relative z-20 w-full h-full flex items-center justify-center p-6">
        <div className="glass-card w-[480px] text-center p-12">
          <div className="w-10 h-10 bg-or rounded-[14px] flex items-center justify-center text-white font-bold text-xl mx-auto mb-6">E</div>
          <h1 className="text-[32px] font-bold mb-2">Connexion à SaaS ECOI</h1>
          <p className="text-muted mb-8">Accédez à votre espace de gestion</p>

          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            <div>
              <label className="text-[12px] font-semibold text-muted mb-1 block">E-MAIL</label>
              <input
                type="email"
                placeholder="nom@entreprise.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-[14px] border border-line bg-white text-sm focus:outline-none focus:border-or"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[12px] font-semibold text-muted">MOT DE PASSE</label>
                <a href="#" className="text-[12px] font-medium text-cuivre">Mot de passe oublié ?</a>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-[14px] border border-line bg-white text-sm focus:outline-none focus:border-or"
              />
            </div>

            {error && (
              <div className="text-rouille text-xs font-semibold text-center py-1">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full btn-primary py-3 rounded-[14px] mt-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {submitting ? <Spinner size={18} stroke={3} label="Connexion…" /> : 'Se connecter'}
            </button>

            <div className="relative py-4 flex items-center">
              <div className="flex-grow border-t border-line"></div>
              <span className="px-3 text-faint text-xs">ou</span>
              <div className="flex-grow border-t border-line"></div>
            </div>

            <button type="button" disabled className="w-full bg-white border border-line px-4 py-3 rounded-[14px] text-sm font-semibold flex items-center justify-center gap-2 opacity-50 cursor-not-allowed">
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continuer avec Google (bientôt)
            </button>
          </form>
          <p className="text-[12px] text-faint mt-8">Pas de compte ? <a href="#" className="font-semibold text-text">Contacter votre admin</a></p>
        </div>
      </div>
    </div>
  )
}
