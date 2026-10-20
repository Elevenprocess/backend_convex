import { StrictMode, lazy, Suspense, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'

// Static: critical / unauthenticated first-render path + router infra
import { RootLayout } from './RootLayout'
import { RequireAuth } from './components/RequireAuth'
import { Login } from './pages/Login'
import { Landing } from './pages/Landing'
import { RouteFallback } from './components/RouteFallback'
import { RouteError, shouldAutoReload } from './components/RouteError'
import { useAuth } from './lib/auth'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { convexClient } from './lib/convex'
import { ConvexAuthBridge } from './components/auth/ConvexAuthBridge'
import { hydrateFetchCache } from './lib/hooks'
import { chunk, loadPage } from './lib/routeChunks'

// Lazy: all actual page components (named exports → .then mapping)
const Overview = lazy(() => loadPage('Overview'))
const LeadsList = lazy(() => loadPage('LeadsList'))
const LeadDetail = lazy(() => loadPage('LeadDetail'))
const LeadsSplit = lazy(() => loadPage('LeadsSplit'))
const ClientsList = lazy(() => loadPage('ClientsList'))
const MesInterventions = lazy(() => loadPage('MesInterventions'))
const ProjectDetail = lazy(() => loadPage('ProjectDetail'))
const RdvCalendar = lazy(() => loadPage('RdvCalendar'))
const RdvDetail = lazy(() => loadPage('RdvDetail'))
const RdvSplit = lazy(() => loadPage('RdvSplit'))
const Analytics = lazy(() => loadPage('Analytics'))
const Ads = lazy(() => loadPage('Ads'))
const Suivi = lazy(() => loadPage('Suivi'))
const Finances = lazy(() => loadPage('Finances'))
const Interventions = lazy(() => loadPage('Interventions'))
const SuiviDetail = lazy(() => loadPage('SuiviDetail'))
const FicheCompletePage = lazy(() => loadPage('FicheCompletePage'))
const ProjectDetailPage = lazy(() => loadPage('ProjectDetailPage'))
const ProfilSetter = lazy(() => loadPage('ProfilSetter'))
const ProfilCommercial = lazy(() => loadPage('ProfilCommercial'))
const Settings = lazy(() => loadPage('Settings'))
const MyProfile = lazy(() => loadPage('MyProfile'))
const AcceptInvitation = lazy(() => loadPage('AcceptInvitation'))
const ApiDocs = lazy(() => loadPage('ApiDocs'))
const DebriefMagicPage = lazy(() => loadPage('DebriefMagicPage'))
const Notifications = lazy(() => loadPage('Notifications'))
const Journal = lazy(() => loadPage('Journal'))
const CallFullScreen = lazy(() => loadPage('CallFullScreen'))
const CallSplit = lazy(() => loadPage('CallSplit'))
const TechnicienPlanning = lazy(() => loadPage('TechnicienPlanning'))
const TechnicienDossiers = lazy(() => loadPage('TechnicienDossiers'))
const FicheInterventionVT = lazy(() => loadPage('FicheInterventionVT'))

function RoleHome() {
  const role = useAuth((s) => s.user?.role)
  return <Navigate to={role === 'technicien' ? '/planning' : '/overview'} replace />
}

function NoTechnicien({ children }: { children: ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'technicien') return <Navigate to="/planning" replace />
  return children
}

// Page Publicité (/ads) : réservée à l'admin (commercial_lead retiré le 2026-08-17).
// Tout autre rôle est renvoyé vers son accueil. Garde positive (allowlist).
function RequireAdsAccess({ children }: { children: ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'admin') return children
  return <Navigate to="/overview" replace />
}

// Agenda /rdv : interdit au technicien (→ planning) et au commercial individuel
// (→ overview épuré, sans agenda). Le commercial_lead y a toujours accès. Ne
// protège que la liste calendrier ; /rdv/:id (détail/débrief) reste accessible.
function RdvCalendarGuard({ children }: { children: ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'technicien') return <Navigate to="/planning" replace />
  if (role === 'commercial') return <Navigate to="/overview" replace />
  return children
}

// Après un déploiement, les chunks hashés de l'ancien build n'existent plus :
// Vite signale l'échec de préchargement ici. On recharge pour basculer sur le
// nouveau build (garde anti-boucle dans shouldAutoReload).
window.addEventListener('vite:preloadError', (event) => {
  if (!shouldAutoReload()) return
  event.preventDefault()
  window.location.reload()
})

const router = createHashRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <RouteFallback />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <Login /> },
      { path: '/accept-invitation', lazy: chunk('AcceptInvitation'), element: <AcceptInvitation /> },
      { path: '/debrief/:token', lazy: chunk('DebriefMagicPage'), element: <DebriefMagicPage /> },
      { path: '/api-docs', lazy: chunk('ApiDocs'), element: <ApiDocs /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/planning', lazy: chunk('TechnicienPlanning'), element: <TechnicienPlanning /> },
          { path: '/mes-dossiers', lazy: chunk('TechnicienDossiers'), element: <TechnicienDossiers /> },
          { path: '/overview', lazy: chunk('Overview'), element: <NoTechnicien><Overview /></NoTechnicien> },
          { path: '/leads', lazy: chunk('LeadsList'), element: <NoTechnicien><LeadsList /></NoTechnicien> },
          { path: '/leads/split', lazy: chunk('LeadsSplit'), element: <LeadsSplit /> },
          { path: '/leads/:id', lazy: chunk('LeadDetail'), element: <LeadDetail /> },
          { path: '/client', lazy: chunk('ClientsList'), element: <NoTechnicien><ClientsList /></NoTechnicien> },
          { path: '/client/:id', lazy: chunk('LeadDetail'), element: <NoTechnicien><LeadDetail /></NoTechnicien> },
          { path: '/projects/:id', lazy: chunk('ProjectDetail'), element: <ProjectDetail /> },
          { path: '/rdv', lazy: chunk('RdvCalendar'), element: <RdvCalendarGuard><RdvCalendar /></RdvCalendarGuard> },
          { path: '/rdv/split', lazy: chunk('RdvSplit'), element: <RdvSplit /> },
          { path: '/rdv/:id', lazy: chunk('RdvDetail'), element: <RdvDetail /> },
          { path: '/analytics', lazy: chunk('Analytics'), element: <NoTechnicien><Analytics /></NoTechnicien> },
          { path: '/ads', lazy: chunk('Ads'), element: <RequireAdsAccess><Ads /></RequireAdsAccess> },
          { path: '/suivi', lazy: chunk('Suivi'), element: <NoTechnicien><Suivi /></NoTechnicien> },
          { path: '/suivi/:id', lazy: chunk('SuiviDetail'), element: <SuiviDetail /> },
          { path: '/suivi/:id/fiche', lazy: chunk('FicheCompletePage'), element: <FicheCompletePage /> },
          { path: '/suivi/:id/projet/:projectId', lazy: chunk('ProjectDetailPage'), element: <ProjectDetailPage /> },
          { path: '/finances', lazy: chunk('Finances'), element: <NoTechnicien><Finances /></NoTechnicien> },
          { path: '/interventions', lazy: chunk('Interventions'), element: <Interventions /> },
          { path: '/mes-interventions', lazy: chunk('MesInterventions'), element: <MesInterventions /> },
          { path: '/fiche-vt/:clientId', lazy: chunk('FicheInterventionVT'), element: <FicheInterventionVT /> },
          { path: '/team/setters/:id', lazy: chunk('ProfilSetter'), element: <ProfilSetter /> },
          { path: '/team/commerciaux/:id', lazy: chunk('ProfilCommercial'), element: <ProfilCommercial /> },
          { path: '/settings', lazy: chunk('Settings'), element: <Settings /> },
          { path: '/profile', lazy: chunk('MyProfile'), element: <MyProfile /> },
          { path: '/notifications', lazy: chunk('Notifications'), element: <NoTechnicien><Notifications /></NoTechnicien> },
          { path: '/journal', lazy: chunk('Journal'), element: <NoTechnicien><Journal /></NoTechnicien> },
          { path: '/call/:id', lazy: chunk('CallFullScreen'), element: <CallFullScreen /> },
          { path: '/call/split', lazy: chunk('CallSplit'), element: <CallSplit /> },
          { path: '*', element: <RoleHome /> },
        ],
      },
    ],
  },
])

const app = (
  <Suspense fallback={<RouteFallback />}>
    <RouterProvider router={router} />
  </Suspense>
)

// Hydrate le cache disque avant le premier rendu (peinture immédiate avec les
// données de la dernière session), plafonné à 150 ms pour ne jamais retarder
// le boot : au-delà, on rend et l'hydratation complète la Map en arrière-plan.
void (async () => {
  await Promise.race([
    hydrateFetchCache(),
    new Promise((resolve) => setTimeout(resolve, 150)),
  ])
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {convexClient ? (
        <ConvexAuthProvider client={convexClient}>
          <ConvexAuthBridge />
          {app}
        </ConvexAuthProvider>
      ) : (
        app
      )}
    </StrictMode>
  )
})()
