import { create } from 'zustand'
import { api, ApiError } from './api'
import type { UserResponse, Role } from './types'

type AuthState = {
  user: UserResponse | null
  status: 'loading' | 'authed' | 'guest'
  error: string | null
  hydrate: () => Promise<void>
  signIn: (email: string, password: string) => Promise<UserResponse>
  signOut: () => Promise<void>
}

// better-auth POST /api/auth/sign-in/email retourne { user, ... } et set le cookie session.
type SignInResponse = { user?: { id: string }; redirect?: boolean }

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  error: null,

  hydrate: async () => {
    try {
      const me = await api<UserResponse>('/users/me')
      set({ user: me, status: 'authed', error: null })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ user: null, status: 'guest', error: null })
      } else {
        set({ user: null, status: 'guest', error: (e as Error).message })
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
    set({ user: me, status: 'authed', error: null })
    return me
  },

  signOut: async () => {
    try {
      await api<unknown>('/api/auth/sign-out', { method: 'POST' })
    } catch {
      // on ignore — on déconnecte en local quoi qu'il arrive
    }
    set({ user: null, status: 'guest', error: null })
  },
}))

// Hook pratique pour récupérer le rôle (équivalent à l'ancien useRole((s) => s.role)).
export function useRole(): Role | null {
  return useAuth((s) => s.user?.role ?? null)
}

// Récupère le user courant (lance une erreur si non hydraté — utile dans pages protégées).
export function useCurrentUser(): UserResponse {
  const u = useAuth((s) => s.user)
  if (!u) throw new Error('useCurrentUser appelé sans session — wrap la page dans <RequireAuth>')
  return u
}
