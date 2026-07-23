import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { convexAuthEnabled } from '../lib/convex'
import { SharedLeadsKeeper } from '../lib/hooks'
import { LoadingBlock } from './Spinner'

export function RequireAuth() {
  const status = useAuth((s) => s.status)
  const hydrate = useAuth((s) => s.hydrate)
  const role = useAuth((s) => s.user?.role)
  const location = useLocation()

  useEffect(() => {
    if (status === 'loading') void hydrate()
  }, [status, hydrate])

  if (status === 'loading') {
    return (
      <div className="w-full h-screen flex items-center justify-center text-faint">
        <LoadingBlock label="Chargement…" />
      </div>
    )
  }
  if (status === 'guest') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  // Drain leads partagé, monté UNE fois au niveau du layout (survit aux
  // navigations). Le commercial n'en a pas l'usage (ses listes sont scopées
  // assignedToId) — pour tous les autres rôles, Topbar et listes lisent ce store.
  const keepSharedLeads = convexAuthEnabled && role !== undefined && role !== 'commercial'
  return (
    <>
      {keepSharedLeads && <SharedLeadsKeeper />}
      <Outlet />
    </>
  )
}
