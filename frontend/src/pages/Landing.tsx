import { useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Orb from '../components/visual/Orb'
import { useAuth } from '../lib/auth'

const FEATURES = [
  {
    n: '01',
    title: 'Gestion des leads',
    body: "Centralisez tous vos prospects au même endroit : qualification, attribution aux setters, historique complet des appels et relances. Plus aucun lead ne se perd entre deux tableurs.",
  },
  {
    n: '02',
    title: 'Rendez-vous & agenda',
    body: "Planifiez les rendez-vous commerciaux et les visites techniques depuis une vue calendrier partagée, synchronisée automatiquement avec l'agenda de chaque commercial.",
  },
  {
    n: '03',
    title: "Suivi d'installation",
    body: "Chaque projet avance dans un workflow de délivrabilité clair : démarches administratives, pose, raccordement, Consuel. Toute l'équipe sait où en est chaque chantier.",
  },
  {
    n: '04',
    title: 'Finances & acomptes',
    body: "Devis, échéanciers d'acomptes déclenchés par les jalons du chantier, alertes de paiement : la trésorerie suit le terrain sans ressaisie.",
  },
  {
    n: '05',
    title: 'Statistiques & pilotage',
    body: "Leads traités, rendez-vous planifiés, taux de closing, chiffre d'affaires : des indicateurs en temps réel calculés sur l'activité réelle, pas sur des statuts déclaratifs.",
  },
  {
    n: '06',
    title: 'Équipes & rôles',
    body: "Setters, commerciaux, techniciens, administration : chacun dispose d'une vue adaptée à son métier, du premier appel jusqu'à l'intervention sur site.",
  },
]

const FAQ = [
  {
    q: "Qu'est-ce que VELORA ?",
    a: "VELORA est un CRM de gestion commerciale développé par Electro Concept OI. Il couvre tout le cycle de vente : réception des leads, appels de qualification, prise de rendez-vous, closing, financement, puis suivi de l'installation jusqu'au raccordement.",
  },
  {
    q: 'À qui s’adresse VELORA ?',
    a: "Aux équipes commerciales et techniques qui vendent puis installent — notamment dans le photovoltaïque et la rénovation énergétique : setters, closers, chargés de suivi et techniciens travaillent dans le même outil.",
  },
  {
    q: 'Comment accéder à VELORA ?',
    a: "VELORA est une application web accessible depuis n'importe quel navigateur. L'accès se fait sur invitation : connectez-vous avec votre compte depuis la page de connexion.",
  },
]

export function Landing() {
  const status = useAuth((s) => s.status)
  const role = useAuth((s) => s.user?.role)
  const hydrate = useAuth((s) => s.hydrate)
  const isAuthed = status === 'authed'

  // Si une session existe déjà, on hydrate puis on redirige automatiquement
  // vers le CRM (le RootLayout/Landing ne passe pas par RequireAuth, donc
  // sans ça le statut resterait "loading").
  useEffect(() => {
    if (status === 'loading') void hydrate()
  }, [status, hydrate])

  if (isAuthed) {
    return <Navigate to={role === 'technicien' ? '/planning' : '/overview'} replace />
  }

  return (
    <main className="relative w-full bg-[#030303] text-white">
      <section className="relative h-screen w-full overflow-hidden">
        <div className="absolute inset-0">
          <Orb
            hoverIntensity={1.13}
            rotateOnHover
            hue={344}
            forceHoverState={false}
            backgroundColor="#000000"
            globalHover
          />
        </div>
        <header className="relative z-10 flex h-20 items-center justify-between px-6 sm:px-10 lg:px-14">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.08] text-sm font-black backdrop-blur-2xl">
              V
            </div>
            <p className="text-xs font-black uppercase tracking-[0.32em] text-white/80">VELORA</p>
          </div>

          <Link
            to={isAuthed ? '/overview' : '/login'}
            className="rounded-full border border-white/12 bg-white/[0.07] px-4 py-2 text-xs font-bold text-white/80 backdrop-blur-2xl transition hover:border-white/25 hover:bg-white/12"
          >
            {isAuthed ? 'CRM' : 'Connexion'}
          </Link>
        </header>

        <div className="relative z-10 flex h-[calc(100vh-5rem)] items-center justify-center px-6 pb-12 text-center sm:px-10 lg:px-14">
          <div className="mx-auto flex max-w-[680px] flex-col items-center">
            <div className="mb-7 h-px w-16 bg-white/25" />

            <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.38em] text-white/42">
              CRM commercial
            </p>

            <h1 className="max-w-[640px] text-[clamp(34px,5.8vw,74px)] font-black leading-[0.94] tracking-[-0.065em] text-white">
              <span className="sr-only">VELORA, le CRM de gestion commerciale — </span>
              Pilotez vos prospects.
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

            <a
              href="#fonctionnalites"
              className="mt-14 flex flex-col items-center gap-2 text-[10px] font-bold uppercase tracking-[0.32em] text-white/35 transition hover:text-white/60"
            >
              Découvrir
              <span aria-hidden className="block h-8 w-px animate-pulse bg-gradient-to-b from-white/50 to-transparent" />
            </a>
          </div>
        </div>
      </section>

      <section id="fonctionnalites" className="relative border-t border-white/[0.06] px-6 py-24 sm:px-10 lg:px-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,60,120,0.06),transparent)]"
        />
        <div className="relative mx-auto max-w-[1080px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.38em] text-white/40">Fonctionnalités</p>
          <h2 className="mt-4 max-w-[560px] text-[clamp(26px,3.4vw,42px)] font-black leading-[1.02] tracking-[-0.045em]">
            Tout le cycle de vente, du premier appel au raccordement.
          </h2>
          <p className="mt-5 max-w-[560px] text-sm leading-6 text-white/50 sm:text-[15px]">
            VELORA remplace les tableurs, les notes éparpillées et les allers-retours entre outils : la gestion des
            leads, la prise de rendez-vous, le suivi de chantier et la facturation vivent dans le même CRM.
          </p>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article
                key={f.n}
                className="group rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <p className="text-[11px] font-black tracking-[0.3em] text-white/30 transition group-hover:text-white/50">
                  {f.n}
                </p>
                <h3 className="mt-4 text-[15px] font-bold tracking-[-0.01em] text-white/90">{f.title}</h3>
                <p className="mt-3 text-[13px] leading-6 text-white/45">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/[0.06] px-6 py-24 sm:px-10 lg:px-14">
        <div className="mx-auto grid max-w-[1080px] items-start gap-12 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.38em] text-white/40">Pensé pour le terrain</p>
            <h2 className="mt-4 text-[clamp(26px,3.4vw,42px)] font-black leading-[1.02] tracking-[-0.045em]">
              Un CRM construit sur une vraie activité, pas sur une maquette.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-white/50 sm:text-[15px]">
            <p>
              VELORA est développé par Electro Concept OI pour piloter au quotidien une activité commerciale et
              technique réelle : des centaines de leads, des équipes de setters et de commerciaux, des chantiers
              d'installation photovoltaïque à suivre jusqu'au Consuel et au raccordement.
            </p>
            <p>
              Chaque fonctionnalité vient d'un besoin du terrain — l'attribution des appels, les débriefs de
              rendez-vous, les échéanciers d'acomptes liés à l'avancement du chantier, les alertes quand un dossier
              administratif bloque. Le résultat : un outil que les équipes utilisent vraiment, parce qu'il suit leur
              façon de travailler.
            </p>
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/[0.06] px-6 py-24 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-[1080px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.38em] text-white/40">Questions fréquentes</p>
          <div className="mt-10 divide-y divide-white/[0.07]">
            {FAQ.map((item) => (
              <div key={item.q} className="grid gap-3 py-8 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-12">
                <h3 className="text-[15px] font-bold tracking-[-0.01em] text-white/85">{item.q}</h3>
                <p className="text-sm leading-7 text-white/45 sm:text-[15px]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-6 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto flex max-w-[1080px] flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/12 bg-white/[0.08] text-xs font-black">
              V
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.32em] text-white/60">VELORA</p>
          </div>
          <p className="text-xs text-white/35">
            © {new Date().getFullYear()} Electro Concept OI — CRM de gestion commerciale
          </p>
          <Link
            to="/login"
            className="text-xs font-bold text-white/50 underline-offset-4 transition hover:text-white/80 hover:underline"
          >
            Connexion
          </Link>
        </div>
      </footer>
    </main>
  )
}
