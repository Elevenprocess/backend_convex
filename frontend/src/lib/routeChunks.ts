import type { ComponentType } from 'react'
import { Notifications } from '../pages/Notifications'

// Chunks des pages (React.lazy). Chaque import est mémoïsé : la route, le
// survol d'un lien de la barre latérale et le préchargement en tâche de fond
// partagent la même promesse, le chunk n'est téléchargé qu'une fois.
type PageModule = { default: ComponentType<any> } // eslint-disable-line @typescript-eslint/no-explicit-any

const factories = {
  Overview: () => import('../pages/Overview').then((m) => ({ default: m.Overview })),
  LeadsList: () => import('../pages/leads/LeadsList').then((m) => ({ default: m.LeadsList })),
  LeadDetail: () => import('../pages/leads/LeadDetail').then((m) => ({ default: m.LeadDetail })),
  LeadsSplit: () => import('../pages/leads/LeadsSplit').then((m) => ({ default: m.LeadsSplit })),
  ClientsList: () => import('../pages/clients/ClientsList').then((m) => ({ default: m.ClientsList })),
  MesInterventions: () => import('../pages/technicien/MesInterventions').then((m) => ({ default: m.MesInterventions })),
  ProjectDetail: () => import('../pages/projects/ProjectDetail').then((m) => ({ default: m.ProjectDetail })),
  RdvCalendar: () => import('../pages/rdv/RdvCalendar').then((m) => ({ default: m.RdvCalendar })),
  RdvDetail: () => import('../pages/rdv/RdvDetail').then((m) => ({ default: m.RdvDetail })),
  RdvSplit: () => import('../pages/rdv/RdvSplit').then((m) => ({ default: m.RdvSplit })),
  Analytics: () => import('../pages/Analytics').then((m) => ({ default: m.Analytics })),
  Ads: () => import('../pages/Ads').then((m) => ({ default: m.Ads })),
  Suivi: () => import('../pages/Suivi').then((m) => ({ default: m.Suivi })),
  Finances: () => import('../pages/Finances').then((m) => ({ default: m.Finances })),
  Interventions: () => import('../pages/Interventions').then((m) => ({ default: m.Interventions })),
  SuiviDetail: () => import('../pages/SuiviDetail').then((m) => ({ default: m.SuiviDetail })),
  FicheCompletePage: () => import('../pages/SuiviFiche').then((m) => ({ default: m.FicheCompletePage })),
  ProjectDetailPage: () => import('../pages/ProjectDetail').then((m) => ({ default: m.ProjectDetailPage })),
  ProfilSetter: () => import('../pages/profils/ProfilSetter').then((m) => ({ default: m.ProfilSetter })),
  ProfilCommercial: () => import('../pages/profils/ProfilCommercial').then((m) => ({ default: m.ProfilCommercial })),
  Settings: () => import('../pages/Settings').then((m) => ({ default: m.Settings })),
  MyProfile: () => import('../pages/MyProfile').then((m) => ({ default: m.MyProfile })),
  AcceptInvitation: () => import('../pages/AcceptInvitation').then((m) => ({ default: m.AcceptInvitation })),
  ApiDocs: () => import('../pages/ApiDocs').then((m) => ({ default: m.ApiDocs })),
  DebriefMagicPage: () => import('../pages/DebriefMagicPage').then((m) => ({ default: m.DebriefMagicPage })),
  // Déjà dans le bundle principal (RootLayout l'importe) : pas de chunk séparé,
  // sinon cycle d'initialisation entre chunks (« d is not a function »).
  Notifications: () => Promise.resolve({ default: Notifications }),
  Journal: () => import('../pages/Journal').then((m) => ({ default: m.Journal })),
  CallFullScreen: () => import('../pages/call/CallFullScreen').then((m) => ({ default: m.CallFullScreen })),
  CallSplit: () => import('../pages/call/CallSplit').then((m) => ({ default: m.CallSplit })),
  TechnicienPlanning: () => import('../pages/technicien/TechnicienPlanning').then((m) => ({ default: m.TechnicienPlanning })),
  TechnicienDossiers: () => import('../pages/technicien/TechnicienDossiers').then((m) => ({ default: m.TechnicienDossiers })),
  FicheInterventionVT: () => import('../pages/technicien/FicheInterventionVT').then((m) => ({ default: m.FicheInterventionVT })),
} satisfies Record<string, () => Promise<PageModule>>

export type PageName = keyof typeof factories

const cache = new Map<PageName, Promise<PageModule>>()

export function loadPage(name: PageName): Promise<PageModule> {
  let p = cache.get(name)
  if (!p) {
    p = factories[name]()
    // Échec réseau : on oublie la promesse pour qu'un nouvel essai reparte.
    p.catch(() => cache.delete(name))
    cache.set(name, p)
  }
  return p
}

// Route `lazy` de React Router : le routeur attend le chunk AVANT de changer
// de page. L'ancienne page reste affichée (pas d'écran « Chargement… »), la
// barre de progression s'affiche, puis la transition de vue joue.
export function chunk(...names: PageName[]) {
  return async () => {
    await Promise.all(names.map(loadPage))
    return {}
  }
}

// Correspondance chemin → page, pour précharger au survol d'un lien.
const PATHS: Array<[RegExp, PageName[]]> = [
  [/^\/overview/, ['Overview']],
  [/^\/leads\/split/, ['LeadsSplit']],
  [/^\/leads\/[^/]+/, ['LeadDetail']],
  [/^\/leads/, ['LeadsList']],
  [/^\/client\/[^/]+/, ['LeadDetail']],
  [/^\/client/, ['ClientsList']],
  [/^\/rdv\/split/, ['RdvSplit']],
  [/^\/rdv\/[^/]+/, ['RdvDetail']],
  [/^\/rdv/, ['RdvCalendar']],
  [/^\/analytics/, ['Analytics']],
  [/^\/ads/, ['Ads']],
  [/^\/suivi\/[^/]+\/fiche/, ['FicheCompletePage']],
  [/^\/suivi\/[^/]+\/projet/, ['ProjectDetailPage']],
  [/^\/suivi\/[^/]+/, ['SuiviDetail']],
  [/^\/suivi/, ['Suivi']],
  [/^\/finances/, ['Finances']],
  [/^\/interventions/, ['Interventions']],
  [/^\/mes-interventions/, ['MesInterventions']],
  [/^\/planning/, ['TechnicienPlanning']],
  [/^\/mes-dossiers/, ['TechnicienDossiers']],
  [/^\/settings/, ['Settings']],
  [/^\/profile/, ['MyProfile']],
  [/^\/notifications/, ['Notifications']],
  [/^\/journal/, ['Journal']],
]

export function prefetchPath(to: string): void {
  const path = to.replace(/^#/, '').split(/[?#]/)[0]
  const hit = PATHS.find(([re]) => re.test(path))
  if (hit) hit[1].forEach((n) => void loadPage(n).catch(() => {}))
}

// Après la connexion, on précharge les pages principales pendant les temps
// morts du navigateur : la première visite de chaque page devient instantanée.
export function prefetchMainPagesWhenIdle(names: PageName[]): () => void {
  let cancelled = false
  const queue = [...names]
  const idle: (cb: () => void) => number =
    typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => window.setTimeout(cb, 300)
  const next = () => {
    if (cancelled) return
    const name = queue.shift()
    if (!name) return
    void loadPage(name).catch(() => {}).finally(() => idle(next))
  }
  const start = window.setTimeout(() => idle(next), 1500)
  return () => {
    cancelled = true
    window.clearTimeout(start)
  }
}
