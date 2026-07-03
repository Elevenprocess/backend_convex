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
import { useAuth } from './lib/auth'
import { ConvexProvider } from 'convex/react'
import { convexClient } from './lib/convex'

// Lazy: all actual page components (named exports → .then mapping)
const Overview = lazy(() => import('./pages/Overview').then((m) => ({ default: m.Overview })))
const LeadsList = lazy(() => import('./pages/leads/LeadsList').then((m) => ({ default: m.LeadsList })))
const LeadDetail = lazy(() => import('./pages/leads/LeadDetail').then((m) => ({ default: m.LeadDetail })))
const LeadsSplit = lazy(() => import('./pages/leads/LeadsSplit').then((m) => ({ default: m.LeadsSplit })))
const ClientsList = lazy(() => import('./pages/clients/ClientsList').then((m) => ({ default: m.ClientsList })))
const MesInterventions = lazy(() => import('./pages/technicien/MesInterventions').then((m) => ({ default: m.MesInterventions })))
const ProjectDetail = lazy(() => import('./pages/projects/ProjectDetail').then((m) => ({ default: m.ProjectDetail })))
const RdvCalendar = lazy(() => import('./pages/rdv/RdvCalendar').then((m) => ({ default: m.RdvCalendar })))
const RdvDetail = lazy(() => import('./pages/rdv/RdvDetail').then((m) => ({ default: m.RdvDetail })))
const RdvSplit = lazy(() => import('./pages/rdv/RdvSplit').then((m) => ({ default: m.RdvSplit })))
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })))
const Ads = lazy(() => import('./pages/Ads').then((m) => ({ default: m.Ads })))
const Suivi = lazy(() => import('./pages/Suivi').then((m) => ({ default: m.Suivi })))
const Finances = lazy(() => import('./pages/Finances').then((m) => ({ default: m.Finances })))
const Interventions = lazy(() => import('./pages/Interventions').then((m) => ({ default: m.Interventions })))
const SuiviDetail = lazy(() => import('./pages/SuiviDetail').then((m) => ({ default: m.SuiviDetail })))
const FicheCompletePage = lazy(() => import('./pages/SuiviFiche').then((m) => ({ default: m.FicheCompletePage })))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetail').then((m) => ({ default: m.ProjectDetailPage })))
const ProfilSetter = lazy(() => import('./pages/profils/ProfilSetter').then((m) => ({ default: m.ProfilSetter })))
const ProfilCommercial = lazy(() => import('./pages/profils/ProfilCommercial').then((m) => ({ default: m.ProfilCommercial })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const MyProfile = lazy(() => import('./pages/MyProfile').then((m) => ({ default: m.MyProfile })))
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation').then((m) => ({ default: m.AcceptInvitation })))
const DebriefMagicPage = lazy(() => import('./pages/DebriefMagicPage').then((m) => ({ default: m.DebriefMagicPage })))
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })))
const CallFullScreen = lazy(() => import('./pages/call/CallFullScreen').then((m) => ({ default: m.CallFullScreen })))
const CallSplit = lazy(() => import('./pages/call/CallSplit').then((m) => ({ default: m.CallSplit })))
const TechnicienPlanning = lazy(() => import('./pages/technicien/TechnicienPlanning').then((m) => ({ default: m.TechnicienPlanning })))
const TechnicienDossiers = lazy(() => import('./pages/technicien/TechnicienDossiers').then((m) => ({ default: m.TechnicienDossiers })))
const FicheInterventionVT = lazy(() => import('./pages/technicien/FicheInterventionVT').then((m) => ({ default: m.FicheInterventionVT })))

function RoleHome() {
  const role = useAuth((s) => s.user?.role)
  return <Navigate to={role === 'technicien' ? '/planning' : '/overview'} replace />
}

function NoTechnicien({ children }: { children: ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'technicien') return <Navigate to="/planning" replace />
  return children
}

// Page Publicité (/ads) : réservée à l'admin et au commercial_lead (suivi ROAS).
// Tout autre rôle est renvoyé vers son accueil. Garde positive (allowlist).
function RequireAdsAccess({ children }: { children: ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'admin' || role === 'commercial_lead') return children
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

const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <Login /> },
      { path: '/accept-invitation', element: <AcceptInvitation /> },
      { path: '/debrief/:token', element: <DebriefMagicPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/planning', element: <TechnicienPlanning /> },
          { path: '/mes-dossiers', element: <TechnicienDossiers /> },
          { path: '/overview', element: <NoTechnicien><Overview /></NoTechnicien> },
          { path: '/leads', element: <NoTechnicien><LeadsList /></NoTechnicien> },
          { path: '/leads/split', element: <LeadsSplit /> },
          { path: '/leads/:id', element: <LeadDetail /> },
          { path: '/client', element: <NoTechnicien><ClientsList /></NoTechnicien> },
          { path: '/client/:id', element: <NoTechnicien><LeadDetail /></NoTechnicien> },
          { path: '/projects/:id', element: <ProjectDetail /> },
          { path: '/rdv', element: <RdvCalendarGuard><RdvCalendar /></RdvCalendarGuard> },
          { path: '/rdv/split', element: <RdvSplit /> },
          { path: '/rdv/:id', element: <RdvDetail /> },
          { path: '/analytics', element: <NoTechnicien><Analytics /></NoTechnicien> },
          { path: '/ads', element: <RequireAdsAccess><Ads /></RequireAdsAccess> },
          { path: '/suivi', element: <NoTechnicien><Suivi /></NoTechnicien> },
          { path: '/suivi/:id', element: <SuiviDetail /> },
          { path: '/suivi/:id/fiche', element: <FicheCompletePage /> },
          { path: '/suivi/:id/projet/:projectId', element: <ProjectDetailPage /> },
          { path: '/finances', element: <NoTechnicien><Finances /></NoTechnicien> },
          { path: '/interventions', element: <Interventions /> },
          { path: '/mes-interventions', element: <MesInterventions /> },
          { path: '/fiche-vt/:clientId', element: <FicheInterventionVT /> },
          { path: '/team/setters/:id', element: <ProfilSetter /> },
          { path: '/team/commerciaux/:id', element: <ProfilCommercial /> },
          { path: '/settings', element: <Settings /> },
          { path: '/profile', element: <MyProfile /> },
          { path: '/notifications', element: <NoTechnicien><Notifications /></NoTechnicien> },
          { path: '/call/:id', element: <CallFullScreen /> },
          { path: '/call/split', element: <CallSplit /> },
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convexClient ? <ConvexProvider client={convexClient}>{app}</ConvexProvider> : app}
  </StrictMode>
)
