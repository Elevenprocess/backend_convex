import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Blobs, BLOB_PRESETS } from './Blobs'
import { useAuth } from '../../lib/auth'
import { useLeadSidebar } from '../../lib/leadSidebar'
import { useRole } from '../../lib/role'

type AppShellProps = {
  children: ReactNode
  blobsKey?: keyof typeof BLOB_PRESETS
  flat?: boolean
}

export function AppShell({ children, blobsKey, flat = false }: AppShellProps) {
  const role = useRole((s) => s.role)
  const authRole = useAuth((s) => s.user?.role)
  const selectedLeadId = useLeadSidebar((s) => s.selectedLeadId)
  const sidebarOpen = useLeadSidebar((s) => s.sidebarOpen)
  const { pathname } = useLocation()
  const key = blobsKey ?? role
  const blobs = BLOB_PRESETS[key] ?? BLOB_PRESETS.default
  const reserveLeadSidebar = Boolean(selectedLeadId && sidebarOpen && shouldReserveLeadSidebar(pathname, authRole))

  return (
    <div className={`relative w-full h-screen overflow-hidden ${flat ? 'bg-white appshell-flat' : 'bg-cream'}`}>
      {!flat && <Blobs blobs={blobs} />}
      <div className="relative z-20 w-full h-full flex">
        <Sidebar />
        <div
          className="flex-grow flex flex-col min-w-0 transition-[margin] duration-200 ease-out"
          style={{ marginRight: reserveLeadSidebar ? 420 : 0 }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function shouldReserveLeadSidebar(pathname: string, role?: string): boolean {
  // Le panneau lead persistant ne s'affiche que sur /leads et /call.
  // Sur /leads il est en overlay, donc il ne doit pas pousser le layout.
  // Avant, toute page non exclue (ex: /profile) gardait 420px invisibles
  // quand un lead restait sélectionné depuis la page Leads.
  if (role === 'setter' && pathname === '/analytics') return false
  return pathname.startsWith('/call')
}
