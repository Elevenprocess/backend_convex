import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { LoadingBlock } from './Spinner'

export function RequireAuth() {
  const status = useAuth((s) => s.status)
  const hydrate = useAuth((s) => s.hydrate)
  const location = useLocation()

  useEffect(() => {
    if (status === 'loading') void hydrate()
  }, [status, hydrate])

  if (status === 'loading') {
    return (
      <div className="w-full h-screen flex items-center justify-center">
        <LoadingBlock />
      </div>
    )
  }
  if (status === 'guest') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
