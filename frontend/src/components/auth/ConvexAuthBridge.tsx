import { useEffect } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { usersSessionContext } from '../../lib/convexApi'
import { mapConvexUser } from '../../lib/convexMappers'
import { configureAuthBackend, useAuth } from '../../lib/auth'

// Pont entre Convex Auth et le store zustand useAuth : l'app entière continue
// de lire s.user / s.status sans savoir d'où vient la session. Monté une seule
// fois sous <ConvexAuthProvider> (main.tsx), ne rend rien.
export function ConvexAuthBridge() {
  const { signIn, signOut } = useAuthActions()
  const { isLoading, isAuthenticated } = useConvexAuth()
  // Contexte complet (user réel + overlay « Explorer un profil ») : réactif,
  // l'overlay posé par users:setViewAs arrive tout seul — et survit au reload
  // puisqu'il vit en base, plus dans localStorage.
  const me = useQuery(usersSessionContext, isAuthenticated ? {} : 'skip')

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
    const real = mapConvexUser(me.real)
    const overlay = me.viewAs ? mapConvexUser(me.viewAs) : null
    useAuth.setState({ user: overlay ?? real, realUser: real, viewAsUser: overlay, status: 'authed', error: null })
  }, [isLoading, isAuthenticated, me])

  return null
}
