import { Link } from 'react-router-dom'
import Orb from '../components/visual/Orb'
import { useAuth } from '../lib/auth'

export function Landing() {
  const status = useAuth((s) => s.status)
  const isAuthed = status === 'authed'

  return (
    <main className="relative h-screen w-full overflow-hidden bg-[#030303] text-white">
      <div className="absolute inset-0">
        <Orb
          hoverIntensity={1.13}
          rotateOnHover
          hue={344}
          forceHoverState={false}
          backgroundColor="#000000"
        />
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(255,255,255,0.05),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.58)_0%,rgba(0,0,0,0.22)_45%,rgba(0,0,0,0.76)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 to-transparent" />

      <header className="relative z-10 flex h-20 items-center justify-between px-6 sm:px-10 lg:px-14">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.08] text-sm font-black backdrop-blur-2xl">
            E
          </div>
          <p className="text-xs font-black uppercase tracking-[0.32em] text-white/80">ECOI</p>
        </div>

        <Link
          to={isAuthed ? '/overview' : '/login'}
          className="rounded-full border border-white/12 bg-white/[0.07] px-4 py-2 text-xs font-bold text-white/80 backdrop-blur-2xl transition hover:border-white/25 hover:bg-white/12"
        >
          {isAuthed ? 'CRM' : 'Connexion'}
        </Link>
      </header>

      <section className="relative z-10 flex h-[calc(100vh-5rem)] items-center justify-center px-6 pb-12 text-center sm:px-10 lg:px-14">
        <div className="mx-auto flex max-w-[680px] flex-col items-center">
          <div className="mb-7 h-px w-16 bg-white/25" />

          <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.38em] text-white/42">
            CRM commercial
          </p>

          <h1 className="max-w-[640px] text-[clamp(34px,5.8vw,74px)] font-black leading-[0.94] tracking-[-0.065em] text-white">
            Pilotez vos leads.
          </h1>

          <p className="mt-5 max-w-[420px] text-sm font-medium leading-6 text-white/50 sm:text-[15px]">
            Appels, RDV et ventes réunis dans une seule vue claire.
          </p>

          <Link
            to={isAuthed ? '/overview' : '/login'}
            className="mt-9 rounded-full bg-white px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-black shadow-[0_24px_80px_rgba(255,255,255,0.14)] transition hover:-translate-y-0.5 hover:bg-white/90"
          >
            {isAuthed ? 'Entrer' : 'Accéder'}
          </Link>
        </div>
      </section>
    </main>
  )
}
