import { useEffect } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { usersMe } from '../../lib/convexApi'
import { mapConvexUser } from '../../lib/convexMappers'
import { configureAuthBackend, useAuth } from '../../lib/auth'

// Pont entre Convex Auth et le store zustand useAuth : l'app entière continue
// de lire s.user / s.status sans savoir d'où vient la session. Monté une seule
// fois sous <ConvexAuthProvider> (main.tsx), ne rend rien.
export function ConvexAuthBridge() {
  const { signIn, signOut } = useAuthActions()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const me = useQuery(usersMe, isAuthenticated ? {} : 'skip')

  useEffect(() => {
    configureAuthBackend({
      signIn: async (email, password, flow) => {
        await signIn('password', { email, password, flow, name: email.split('@')[0] })
      },
      signInGoogle: async () => {
        // Retour OAuth sur l'origine (route `/`). Convex y ajoute `?code=…` que
        // ConvexAuthProvider échange en session ; <Landing> renvoie ensuite tout
        // utilisateur authentifié vers /overview (ou /planning pour un technicien).
        await signIn('google', { redirectTo: window.location.origin })
      },
      signOut: async () => {
        await signOut()
      },
    })
  }, [signIn, signOut])

  useEffect(() => {
    if (isLoading) {
      useAuth.setState({ status: 'loading' })
      return
    }
    if (!isAuthenticated) {
      useAuth.setState({ user: null, realUser: null, viewAsUser: null, status: 'guest' })
      return
    }
    // Session Convex active : on attend users:me (undefined = requête en vol).
    if (me === undefined || me === null) {
      useAuth.setState({ status: 'loading' })
      return
    }
    const mapped = mapConvexUser(me)
    useAuth.setState({ user: mapped, realUser: mapped, viewAsUser: null, status: 'authed', error: null })
  }, [isLoading, isAuthenticated, me])

  return null
}
