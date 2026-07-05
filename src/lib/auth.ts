import { create } from 'zustand'
import { api, ApiError } from './api'
import type { UserResponse, Role } from './types'
import { clearFetchCache } from './fetchCacheStore'

const VIEW_AS_KEY = 'ecoi.viewAsUserId'

// Promesse du hydrate() en cours, pour sérialiser les appels concurrents
// (focus + visibilitychange + interval déclenchés quasi simultanément).
let hydrateInFlight: Promise<void> | null = null

// Règles d'impersonation, centralisées pour rester alignées avec le backend
// (auth.guard.ts) :
//   - admin → n'importe qui (ÉCRITURE)
//   - commercial_lead → commercial (LECTURE SEULE)
//   - commercial → setter (LECTURE SEULE)
export function impersonationAllowed(realRole: Role, targetRole: Role): boolean {
  return (
    realRole === 'admin' ||
    (realRole === 'commercial_lead' && targetRole === 'commercial') ||
    (realRole === 'commercial' && targetRole === 'setter')
  )
}

export function impersonationIsReadOnly(realRole: Role, targetRole: Role): boolean {
  return (
    (realRole === 'commercial_lead' && targetRole === 'commercial') ||
    (realRole === 'commercial' && targetRole === 'setter')
  )
}

type AuthState = {
  // user = perceived user (viewAsUser ?? realUser). Tout le code app lit s.user.
  user: UserResponse | null
  realUser: UserResponse | null
  viewAsUser: UserResponse | null
  status: 'loading' | 'authed' | 'guest'
  error: string | null
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<UserResponse>
  signOut: () => Promise<void>
  viewAs: (user: UserResponse) => void
  exitViewAs: () => void
}

// better-auth POST /api/auth/sign-in/email retourne { user, ... } et set le cookie session.
type SignInResponse = { user?: { id: string }; redirect?: boolean }

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  realUser: null,
  viewAsUser: null,
  status: 'loading',
  error: null,

  hydrate: async () => {
    // Garde anti-concurrence : useAuthSessionKeeper appelle hydrate() sur focus,
    // visibilitychange ET un interval — deux runs concurrents pouvaient se
    // chevaucher et faire sauter le bandeau « voir en tant que ». On sérialise.
    if (hydrateInFlight) return hydrateInFlight
    hydrateInFlight = (async () => {
    try {
      await api<unknown>('/api/auth/get-session').catch(() => undefined)
      // On lit l'id mémorisé UNE fois et on bypasse le header via skipViewAs
      // (au lieu de muter localStorage en plein vol — source d'une race).
      const persistedViewAsId = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_AS_KEY) : null
      const me = await api<UserResponse>('/users/me', { skipViewAs: true })

      let overlay: UserResponse | null = null
      if (persistedViewAsId && persistedViewAsId !== me.id) {
        try {
          const target = await api<UserResponse>(`/users/${persistedViewAsId}`, { skipViewAs: true })

          if (impersonationAllowed(me.role, target.role)) {
            overlay = target
          } else if (typeof window !== 'undefined') {
            window.localStorage.removeItem(VIEW_AS_KEY)
          }
        } catch {
          if (typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
        }
      } else if (persistedViewAsId && typeof window !== 'undefined') {
        // persistedViewAsId === me.id : overlay inutile, on nettoie.
        window.localStorage.removeItem(VIEW_AS_KEY)
      }

      set({
        realUser: me,
        viewAsUser: overlay,
        user: overlay ?? me,
        status: 'authed',
        error: null,
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ user: null, realUser: null, viewAsUser: null, status: 'guest', error: null })
      } else {
        const current = get()
        const message = e instanceof Error ? e.message : 'Erreur de session'
        if (current.status === 'authed' && current.realUser) {
          set({ error: message })
        } else {
          set({ user: null, realUser: null, viewAsUser: null, status: 'guest', error: message })
        }
      }
    } finally {
      hydrateInFlight = null
    }
    })()
    return hydrateInFlight
  },

  signIn: async (email, password) => {
    set({ error: null })
    await api<SignInResponse>('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email, password },
    })
    const me = await api<UserResponse>('/users/me')
    if (typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
    set({ user: me, realUser: me, viewAsUser: null, status: 'authed', error: null })
    return me
  },

  signOut: async () => {
    try {
      await api<unknown>('/api/auth/sign-out', { method: 'POST' })
    } catch {
      // on ignore — on déconnecte en local quoi qu'il arrive
    }
    if (typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
    // Les données métier en cache ne survivent pas au logout.
    void clearFetchCache()
    set({ user: null, realUser: null, viewAsUser: null, status: 'guest', error: null })
  },

  viewAs: (target) => {
    const me = get().realUser
    if (!me || target.id === me.id) return
    if (!impersonationAllowed(me.role, target.role)) return
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_AS_KEY, target.id)
    set({ viewAsUser: target, user: target })
  },

  exitViewAs: () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
    const real = get().realUser
    set({ viewAsUser: null, user: real })
  },
}))

// Lance le flow OAuth Google (better-auth). Le back répond avec une URL
// d'autorisation Google ; on y redirige le navigateur (pas de navigate SPA).
// Au retour sur callbackURL, better-auth a posé le cookie de session et
// hydrate() prend le relais. En cas d'échec (ex. email sans compte ECOI →
// signup_disabled), Google renvoie vers errorCallbackURL=/login?error=...
export async function signInWithGoogle(): Promise<void> {
  const origin = window.location.origin
  const res = await api<{ url?: string; redirect?: boolean }>('/api/auth/sign-in/social', {
    method: 'POST',
    body: {
      provider: 'google',
      callbackURL: `${origin}/overview`,
      errorCallbackURL: `${origin}/login`,
    },
  })
  if (!res.url) throw new ApiError(500, 'Réponse OAuth invalide')
  window.location.href = res.url
}

// Rôle perçu (override par viewAs si actif).
export function useRole(): Role | null {
  return useAuth((s) => s.user?.role ?? null)
}

// User perçu (overlay si admin impersonne, sinon user réel).
export function useCurrentUser(): UserResponse {
  const u = useAuth((s) => s.user)
  if (!u) throw new Error('useCurrentUser appelé sans session — wrap la page dans <RequireAuth>')
  return u
}

// User réellement connecté (auth session), ignore l'overlay viewAs.
export function useRealUser(): UserResponse | null {
  return useAuth((s) => s.realUser)
}

// True si l'utilisateur est en mode "impersonation lecture seule"
// (commercial_lead → commercial, ou commercial → setter). En admin, viewAs
// n'importe quel rôle reste en ÉCRITURE.
export function useIsReadOnlyImpersonation(): boolean {
  return useAuth((s) => {
    const real = s.realUser
    const overlay = s.viewAsUser
    if (!real || !overlay || real.id === overlay.id) return false
    return impersonationIsReadOnly(real.role, overlay.role)
  })
}
