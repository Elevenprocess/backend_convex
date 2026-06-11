import { StrictMode, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'

import { RootLayout } from './RootLayout'
import { RequireAuth } from './components/RequireAuth'
import { Login } from './pages/Login'
import { Landing } from './pages/Landing'
import { Overview } from './pages/Overview'
import { LeadsList } from './pages/leads/LeadsList'
import { LeadDetail } from './pages/leads/LeadDetail'
import { LeadsSplit } from './pages/leads/LeadsSplit'
import { ClientsList } from './pages/clients/ClientsList'
import { MesInterventions } from './pages/technicien/MesInterventions'
import { ProjectDetail } from './pages/projects/ProjectDetail'
import { RdvCalendar } from './pages/rdv/RdvCalendar'
import { RdvDetail } from './pages/rdv/RdvDetail'
import { RdvSplit } from './pages/rdv/RdvSplit'
import { Analytics } from './pages/Analytics'
import { Suivi } from './pages/Suivi'
import { Finances } from './pages/Finances'
import { SuiviDetail } from './pages/SuiviDetail'
import { FicheCompletePage } from './pages/SuiviFiche'
import { ProfilSetter } from './pages/profils/ProfilSetter'
import { ProfilCommercial } from './pages/profils/ProfilCommercial'
import { Settings } from './pages/Settings'
import { MyProfile } from './pages/MyProfile'
import { AcceptInvitation } from './pages/AcceptInvitation'
import { Notifications } from './pages/Notifications'
import { CallFullScreen } from './pages/call/CallFullScreen'
import { CallSplit } from './pages/call/CallSplit'
import { TechnicienPlanning } from './pages/technicien/TechnicienPlanning'
import { TechnicienDossiers } from './pages/technicien/TechnicienDossiers'
import { useAuth } from './lib/auth'

function RoleHome() {
  const role = useAuth((s) => s.user?.role)
  return <Navigate to={role === 'technicien' ? '/planning' : '/overview'} replace />
}

function NoTechnicien({ children }: { children: ReactElement }) {
  const role = useAuth((s) => s.user?.role)
  if (role === 'technicien') return <Navigate to="/planning" replace />
  return children
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
          { path: '/suivi', element: <NoTechnicien><Suivi /></NoTechnicien> },
          { path: '/suivi/:id', element: <SuiviDetail /> },
          { path: '/suivi/:id/fiche', element: <FicheCompletePage /> },
          { path: '/finances', element: <NoTechnicien><Finances /></NoTechnicien> },
          { path: '/mes-interventions', element: <MesInterventions /> },
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
