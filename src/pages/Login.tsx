import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, signInWithGoogle } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Spinner } from '../components/Spinner'
import Orb from '../components/visual/Orb'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const signIn = useAuth((s) => s.signIn)

  const fromState = (location.state as { from?: string } | null)?.from
  const redirectTo = fromState && fromState !== '/login' ? fromState : '/overview'

  // Retour d'un échec OAuth Google : better-auth redirige vers /login?error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (!err) return
    setError(
      err === 'signup_disabled'
        ? "Aucun compte VELORA n'est associé à ce compte Google. Contactez votre administrateur."
        : 'La connexion avec Google a échoué. Réessayez ou utilisez votre e-mail.',
    )
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const handleGoogle = async () => {
    if (googleLoading) return
    setGoogleLoading(true)
    setError(null)
    try {
      await signInWithGoogle() // redirige hors de la SPA
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La connexion avec Google a échoué.')
      setGoogleLoading(false)
    }
  }

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
        setError(err.status === 401 ? 'E-mail ou mot de passe incorrect.' : err.message)
      } else {
        setError((err as Error).message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#030303] text-white">
      <div className="absolute inset-0">
        <Orb
          hoverIntensity={1.13}
          rotateOnHover
          hue={344}
          forceHoverState={false}
          backgroundColor="#131f13"
          globalHover
        />
      </div>


      <header className="relative z-10 flex h-20 items-center justify-between px-6 sm:px-10 lg:px-14">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.08] text-sm font-black backdrop-blur-2xl">V</div>
          <p className="text-xs font-black uppercase tracking-[0.32em] text-white/80">VELORA</p>
        </Link>

        <Link
          to="/"
          className="rounded-full border border-white/12 bg-white/[0.07] px-4 py-2 text-xs font-bold text-white/80 backdrop-blur-2xl transition hover:border-white/25 hover:bg-white/12"
        >
          Accueil
        </Link>
      </header>

      <section className="relative z-10 flex min-h-[calc(100vh-5rem)] items-center justify-center px-6 pb-12 sm:px-10 lg:px-14">
        <div className="w-full max-w-[440px]">
          <div className="rounded-[28px] border border-white/12 bg-white/[0.06] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-10">
            <div className="text-center">
              <div className="mx-auto mb-5 h-px w-12 bg-white/25" />
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.38em] text-white/45">CRM commercial</p>
              <h1 className="text-2xl font-black leading-tight tracking-[-0.02em] text-white sm:text-[28px]">Connexion</h1>
              <p className="mt-2 text-sm text-white/55">Accédez à votre espace VELORA.</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">E-mail</label>
                <input
                  type="email"
                  placeholder="nom@entreprise.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder-white/35 outline-none transition focus:border-white/40 focus:bg-white/[0.09]"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">Mot de passe</label>
                  <a href="#" className="text-[11px] font-semibold text-white/60 transition hover:text-white">Oublié ?</a>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder-white/35 outline-none transition focus:border-white/40 focus:bg-white/[0.09]"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-center text-xs font-semibold text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-black shadow-[0_18px_60px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {submitting ? <Spinner size={16} stroke={3} label="Connexion…" /> : 'Se connecter'}
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/35">ou</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading || submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white/75 transition hover:border-white/25 hover:bg-white/12 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {googleLoading ? (
                  <Spinner size={16} stroke={3} label="Redirection…" />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Continuer avec Google
                  </>
                )}
              </button>
            </form>

            <p className="mt-7 text-center text-[11px] text-white/40">
              Pas de compte ? <a href="#" className="font-semibold text-white/70 transition hover:text-white">Contacter votre admin</a>
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
