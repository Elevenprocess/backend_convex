import { create } from 'zustand'
import { api, ApiError } from './api'
import type { UserResponse, Role } from './types'

const VIEW_AS_KEY = 'ecoi.viewAsUserId'

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
    try {
      await api<unknown>('/api/auth/get-session').catch(() => undefined)
      // Avant de fetch /users/me, on retire temporairement le header viewAs
      // pour récupérer le VRAI user (sinon la requête revient avec l'overlay).
      const persistedViewAsId = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_AS_KEY) : null
      if (persistedViewAsId && typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
      const me = await api<UserResponse>('/users/me')
      if (persistedViewAsId && typeof window !== 'undefined') window.localStorage.setItem(VIEW_AS_KEY, persistedViewAsId)

      let overlay: UserResponse | null = null
      if (persistedViewAsId && persistedViewAsId !== me.id) {
        try {
          // Re-retire le header le temps de récupérer la cible (sinon le back
          // résoudrait /users/<id> avec l'overlay = boucle infinie).
          if (typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
          const target = await api<UserResponse>(`/users/${persistedViewAsId}`)
          if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_AS_KEY, persistedViewAsId)

          // Règles : admin → n'importe qui ; commercial_lead → équipe commercial/setter ;
          // commercial → setter (read-only).
          const allowed =
            me.role === 'admin' ||
            (me.role === 'commercial_lead' && (target.role === 'commercial' || target.role === 'commercial_lead' || target.role === 'setter' || target.role === 'setter_lead')) ||
            (me.role === 'commercial' && target.role === 'setter')
          if (allowed) {
            overlay = target
          } else if (typeof window !== 'undefined') {
            window.localStorage.removeItem(VIEW_AS_KEY)
          }
        } catch {
          if (typeof window !== 'undefined') window.localStorage.removeItem(VIEW_AS_KEY)
        }
      } else if (typeof window !== 'undefined') {
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
    }
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
    set({ user: null, realUser: null, viewAsUser: null, status: 'guest', error: null })
  },

  viewAs: (target) => {
    const me = get().realUser
    if (!me || target.id === me.id) return
    // admin = tout user ; commercial_lead = équipe commercial/setter ; commercial = setter (lecture seule garantie back-side).
    const allowed =
      me.role === 'admin' ||
      (me.role === 'commercial_lead' && (target.role === 'commercial' || target.role === 'commercial_lead' || target.role === 'setter' || target.role === 'setter_lead')) ||
      (me.role === 'commercial' && target.role === 'setter')
    if (!allowed) return
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

// True si l'utilisateur est en mode "impersonation lecture seule" (commercial
// regardant un setter). En admin viewAs n'importe quel autre rôle reste WRITE.
export function useIsReadOnlyImpersonation(): boolean {
  return useAuth((s) => {
    const real = s.realUser
    const overlay = s.viewAsUser
    if (!real || !overlay || real.id === overlay.id) return false
    return real.role === 'commercial' && overlay.role === 'setter'
  })
}
