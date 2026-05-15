import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import './index.css'

import { RootLayout } from './RootLayout'
import { RequireAuth } from './components/RequireAuth'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { LeadsList } from './pages/leads/LeadsList'
import { LeadDetail } from './pages/leads/LeadDetail'
import { LeadsSplit } from './pages/leads/LeadsSplit'
import { RdvCalendar } from './pages/rdv/RdvCalendar'
import { RdvDetail } from './pages/rdv/RdvDetail'
import { RdvSplit } from './pages/rdv/RdvSplit'
import { Analytics } from './pages/Analytics'
import { ProfilSetter } from './pages/profils/ProfilSetter'
import { ProfilCommercial } from './pages/profils/ProfilCommercial'
import { Settings } from './pages/Settings'
import { MyProfile } from './pages/MyProfile'
import { AcceptInvitation } from './pages/AcceptInvitation'
import { Notifications } from './pages/Notifications'
import { CallFullScreen } from './pages/call/CallFullScreen'
import { CallSplit } from './pages/call/CallSplit'

const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/accept-invitation', element: <AcceptInvitation /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <Navigate to="/overview" replace /> },
          { path: '/overview', element: <Overview /> },
          { path: '/leads', element: <LeadsList /> },
          { path: '/leads/split', element: <LeadsSplit /> },
          { path: '/leads/:id', element: <LeadDetail /> },
          { path: '/rdv', element: <RdvCalendar /> },
          { path: '/rdv/split', element: <RdvSplit /> },
          { path: '/rdv/:id', element: <RdvDetail /> },
          { path: '/analytics', element: <Analytics /> },
          { path: '/team/setters/:id', element: <ProfilSetter /> },
          { path: '/team/commerciaux/:id', element: <ProfilCommercial /> },
          { path: '/settings', element: <Settings /> },
          { path: '/profile', element: <MyProfile /> },
          { path: '/notifications', element: <Notifications /> },
          { path: '/call/:id', element: <CallFullScreen /> },
          { path: '/call/split', element: <CallSplit /> },
          { path: '*', element: <Navigate to="/overview" replace /> },
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
