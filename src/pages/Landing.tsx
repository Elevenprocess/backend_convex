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

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_45%,rgba(255,255,255,0.08),transparent_32%),linear-gradient(90deg,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.58)_45%,rgba(0,0,0,0.24)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 to-transparent" />

      <header className="relative z-10 flex h-24 items-center justify-between px-6 sm:px-10 lg:px-16">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-lg font-black shadow-[0_0_40px_rgba(255,48,116,0.25)] backdrop-blur-2xl">
            E
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.32em] text-white">ECOI</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">CRM SaaS</p>
          </div>
        </div>

        <Link
          to={isAuthed ? '/overview' : '/login'}
          className="rounded-full border border-white/15 bg-white/10 px-5 py-2.5 text-sm font-bold text-white shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition hover:border-white/30 hover:bg-white/15"
        >
          {isAuthed ? 'Ouvrir le CRM' : 'Connexion'}
        </Link>
      </header>

      <section className="relative z-10 flex h-[calc(100vh-6rem)] items-center px-6 pb-16 sm:px-10 lg:px-16">
        <div className="max-w-[760px]">
          <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white/70 backdrop-blur-2xl">
            <span className="h-2 w-2 rounded-full bg-[#ff2f75] shadow-[0_0_22px_rgba(255,47,117,0.95)]" />
            Pilotage commercial intelligent
          </div>

          <h1 className="max-w-[720px] text-[clamp(44px,7vw,98px)] font-black leading-[0.88] tracking-[-0.08em] text-white">
            Transformez vos leads en rendez-vous signés.
          </h1>

          <p className="mt-7 max-w-[560px] text-[clamp(16px,2vw,20px)] font-medium leading-8 text-white/62">
            Une interface premium pour suivre les appels, relances, RDV, commerciaux et performances en temps réel.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to={isAuthed ? '/overview' : '/login'}
              className="rounded-full bg-white px-7 py-4 text-sm font-black uppercase tracking-[0.18em] text-black shadow-[0_24px_80px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-white/90"
            >
              {isAuthed ? 'Entrer dans le SaaS' : 'Accéder au SaaS'}
            </Link>
            <div className="flex items-center gap-3 text-sm font-semibold text-white/50">
              <span className="h-px w-10 bg-white/25" />
              Dashboard · Leads · Analytics · Pipeline
            </div>
          </div>
        </div>
      </section>

      <div className="pointer-events-none absolute bottom-8 right-6 z-10 hidden items-end gap-8 text-right text-white/45 md:flex lg:right-16">
        <div>
          <p className="text-3xl font-black text-white">360°</p>
          <p className="text-xs font-bold uppercase tracking-[0.22em]">Vue CRM</p>
        </div>
        <div>
          <p className="text-3xl font-black text-white">Live</p>
          <p className="text-xs font-bold uppercase tracking-[0.22em]">Stats terrain</p>
        </div>
      </div>
    </main>
  )
}
