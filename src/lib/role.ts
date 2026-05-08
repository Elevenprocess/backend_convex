import { useAuth } from './auth'

// Avant : zustand persist, rôle factice pour design. Maintenant : dérivé de la session.
// On garde la signature `useRole((s) => s.role)` pour compatibilité avec les pages qui
// n'ont pas encore été migrées vers useAuth directement.

export type Role = 'admin' | 'setter' | 'commercial' | 'delivrabilite'

type RoleSliceShape = {
  role: Role
  setRole: (_: Role) => void // no-op — la "view as" dev disparaît avec la vraie auth
}

export function useRole<T>(selector: (s: RoleSliceShape) => T): T {
  const role = (useAuth((s) => s.user?.role) ?? 'setter') as Role
  const slice: RoleSliceShape = { role, setRole: () => {} }
  return selector(slice)
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  setter: 'Setter',
  commercial: 'Commercial',
  delivrabilite: 'Délivrabilité',
}

// Conserve les tints/initiales fixes par défaut. firstName/name viennent de la vraie
// session lorsque la page est authentifiée — voir useDisplayUser ci-dessous.
export const ROLE_USERS: Record<Role, { name: string; firstName: string; initials: string; tint: string }> = {
  admin: { name: 'Admin', firstName: 'Admin', initials: 'AD', tint: 'bg-info-tint' },
  setter: { name: 'Setter', firstName: 'Setter', initials: 'ST', tint: 'bg-cuivre-tint' },
  commercial: { name: 'Commercial', firstName: 'Commercial', initials: 'CO', tint: 'bg-or-tint' },
  delivrabilite: { name: 'Délivrabilité', firstName: 'Déliv', tint: 'bg-info-tint', initials: 'DV' },
}

// Retourne les infos d'affichage construites depuis la vraie session quand dispo.
export function useDisplayUser() {
  const user = useAuth((s) => s.user)
  const role: Role = (user?.role ?? 'setter') as Role
  const tint = ROLE_USERS[role].tint
  const name = user?.name ?? ROLE_USERS[role].name
  const firstName = name.split(' ')[0] ?? name
  const parts = name.split(' ').filter(Boolean)
  const initials =
    (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')
  return {
    name,
    firstName,
    initials: initials.toUpperCase() || ROLE_USERS[role].initials,
    tint,
    role,
  }
}
