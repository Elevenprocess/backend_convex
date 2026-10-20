import { createContext, useContext, useId, useLayoutEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { HelpFab } from './HelpFab'
import { Blobs, BLOB_PRESETS } from './Blobs'
import { useAuth } from '../../lib/auth'
import { useLeadSidebar } from '../../lib/leadSidebar'
import { useRole } from '../../lib/role'

type AppShellProps = {
  children: ReactNode
  blobsKey?: keyof typeof BLOB_PRESETS
  flat?: boolean
}

type ShellOptions = { blobsKey?: keyof typeof BLOB_PRESETS; flat: boolean }
type ShellRegistry = { register: (id: string, opts: ShellOptions) => void; unregister: (id: string) => void }

const ShellContext = createContext<ShellRegistry | null>(null)

// Coque persistante : montée UNE fois sous RequireAuth. La barre latérale, le
// fond et l'aide ne sont plus recréés à chaque changement de page ; seule la
// page (Outlet) change. Les pages continuent d'écrire <AppShell …> : à
// l'intérieur de la coque, AppShell se contente d'annoncer ses options
// (blobsKey, flat) et de rendre ses enfants. Une page sans AppShell (appel
// plein écran, fiche VT…) s'affiche sans la coque, comme avant.
// L'Outlet garde toujours la même position dans l'arbre : basculer la coque
// ne remonte jamais la page.
export function PersistentShell({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Array<[string, ShellOptions]>>([])
  const [registry] = useState<ShellRegistry>(() => ({
    register: (id, opts) =>
      setEntries((prev) => {
        const i = prev.findIndex(([k]) => k === id)
        if (i >= 0 && prev[i][1].flat === opts.flat && prev[i][1].blobsKey === opts.blobsKey) return prev
        const next = prev.filter(([k]) => k !== id)
        next.push([id, opts])
        return next
      }),
    unregister: (id) => setEntries((prev) => prev.filter(([k]) => k !== id)),
  }))
  const current = entries.length ? entries[entries.length - 1][1] : null
  return (
    <ShellContext.Provider value={registry}>
      <ShellFrame options={current}>{children}</ShellFrame>
    </ShellContext.Provider>
  )
}

function ShellFrame({ options, children }: { options: ShellOptions | null; children: ReactNode }) {
  const role = useRole((s) => s.role)
  const authRole = useAuth((s) => s.user?.role)
  const selectedLeadId = useLeadSidebar((s) => s.selectedLeadId)
  const sidebarOpen = useLeadSidebar((s) => s.sidebarOpen)
  const { pathname } = useLocation()
  const active = options !== null
  const flat = options?.flat ?? false
  const key = options?.blobsKey ?? role
  const blobs = BLOB_PRESETS[key] ?? BLOB_PRESETS.default
  const reserveLeadSidebar = Boolean(selectedLeadId && sidebarOpen && shouldReserveLeadSidebar(pathname, authRole))

  return (
    <div className={active ? `relative w-full h-screen overflow-hidden ${flat ? 'bg-white appshell-flat' : 'bg-cream'}` : 'contents'}>
      {active && !flat ? <Blobs blobs={blobs} /> : null}
      <div className={active ? 'relative z-20 w-full h-full flex' : 'contents'}>
        {active ? <Sidebar /> : null}
        <div
          className={active ? `app-main flex-grow flex flex-col min-w-0 transition-[margin] duration-200 ease-out ${reserveLeadSidebar ? 'appshell-reserve-rail' : ''}` : 'contents'}
        >
          {children}
        </div>
      </div>
      {active ? <HelpFab /> : null}
    </div>
  )
}

export function AppShell({ children, blobsKey, flat = false }: AppShellProps) {
  const registry = useContext(ShellContext)
  const id = useId()
  useLayoutEffect(() => {
    if (!registry) return
    registry.register(id, { blobsKey, flat })
  }, [registry, id, blobsKey, flat])
  useLayoutEffect(() => {
    if (!registry) return
    return () => registry.unregister(id)
  }, [registry, id])
  if (registry) return <>{children}</>
  return <StandaloneShell blobsKey={blobsKey} flat={flat}>{children}</StandaloneShell>
}

// Hors coque persistante (pages publiques, tests) : rendu d'origine.
function StandaloneShell({ children, blobsKey, flat = false }: AppShellProps) {
  return <ShellFrame options={{ blobsKey, flat }}>{children}</ShellFrame>
}

function shouldReserveLeadSidebar(pathname: string, role?: string): boolean {
  // Le panneau lead persistant ne s'affiche que sur /leads et /call.
  // Sur /leads il est en overlay, donc il ne doit pas pousser le layout.
  // Avant, toute page non exclue (ex: /profile) gardait 420px invisibles
  // quand un lead restait sélectionné depuis la page Leads.
  if (role === 'setter' && pathname === '/analytics') return false
  return pathname.startsWith('/call')
}
