import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Blobs, BLOB_PRESETS } from './Blobs'
import { isLeadSidebarExcludedPath, useLeadSidebar } from '../../lib/leadSidebar'
import { useRole } from '../../lib/role'

type AppShellProps = {
  children: ReactNode
  blobsKey?: keyof typeof BLOB_PRESETS
}

export function AppShell({ children, blobsKey }: AppShellProps) {
  const role = useRole((s) => s.role)
  const selectedLeadId = useLeadSidebar((s) => s.selectedLeadId)
  const { pathname } = useLocation()
  const key = blobsKey ?? role
  const blobs = BLOB_PRESETS[key] ?? BLOB_PRESETS.default
  const reserveLeadSidebar = Boolean(selectedLeadId && !isLeadSidebarExcludedPath(pathname))

  return (
    <div className="relative w-full h-screen bg-cream overflow-hidden">
      <Blobs blobs={blobs} />
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
