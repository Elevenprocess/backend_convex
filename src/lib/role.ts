import { useAuth } from './auth'

// Avant : zustand persist, rôle factice pour design. Maintenant : dérivé de la session.
// On garde la signature `useRole((s) => s.role)` pour compatibilité avec les pages qui
// n'ont pas encore été migrées vers useAuth directement.

export type Role =
  | 'admin'
  | 'setter'
  | 'setter_lead'
  | 'commercial'
  | 'commercial_lead'
  | 'delivrabilite'
  | 'responsable_technique'
  | 'back_office'
  | 'technicien'
  | 'finances'

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
  setter_lead: 'Responsable setter',
  commercial: 'Commercial',
  commercial_lead: 'Responsable commercial',
  delivrabilite: 'Délivrabilité',
  responsable_technique: 'Responsable technique',
  back_office: 'Back-office',
  technicien: 'Technicien',
  finances: 'Finances',
}

// Onglet « Mode de paiement » de la page projet : l'équipe délivrabilité
// (delivrabilite / responsable_technique / back_office) a le même accès complet
// que admin/finances — aligné sur les gardes backend (payments.controller.ts).
const PAYMENT_EDIT_ROLES: ReadonlySet<Role> = new Set([
  'admin',
  'finances',
  'delivrabilite',
  'responsable_technique',
  'back_office',
])

export function canEditPayment(role: Role | undefined): boolean {
  return role !== undefined && PAYMENT_EDIT_ROLES.has(role)
}

export type Team = 'setting' | 'closing' | 'admin' | 'delivrabilite' | null

export const TEAM_LABELS: Record<Exclude<Team, null>, string> = {
  setting: 'Setting',
  closing: 'Vente',
  admin: 'Admin',
  delivrabilite: 'Délivrabilité',
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role
}

export function teamLabel(team: Team): string {
  return team ? TEAM_LABELS[team] ?? team : '—'
}

// Conserve les tints/initiales fixes par défaut. firstName/name viennent de la vraie
// session lorsque la page est authentifiée — voir useDisplayUser ci-dessous.
export const ROLE_USERS: Record<Role, { name: string; firstName: string; initials: string; tint: string }> = {
  admin: { name: 'Admin', firstName: 'Admin', initials: 'AD', tint: 'bg-info-tint' },
  setter: { name: 'Setter', firstName: 'Setter', initials: 'ST', tint: 'bg-cuivre-tint' },
  setter_lead: { name: 'Responsable setter', firstName: 'Setter', initials: 'SL', tint: 'bg-cuivre-tint' },
  commercial: { name: 'Commercial', firstName: 'Commercial', initials: 'CO', tint: 'bg-or-tint' },
  commercial_lead: { name: 'Responsable commercial', firstName: 'Commercial', initials: 'CL', tint: 'bg-or-tint' },
  delivrabilite: { name: 'Délivrabilité', firstName: 'Déliv', initials: 'DV', tint: 'bg-info-tint' },
  responsable_technique: { name: 'Responsable technique', firstName: 'Resp.', initials: 'RT', tint: 'bg-info-tint' },
  back_office: { name: 'Back-office', firstName: 'Back-office', initials: 'BO', tint: 'bg-info-tint' },
  technicien: { name: 'Technicien', firstName: 'Tech.', initials: 'TC', tint: 'bg-info-tint' },
  finances: { name: 'Finances', firstName: 'Finances', initials: 'FI', tint: 'bg-rouille-tint' },
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
    image: user?.image ?? null,
    tint,
    role,
  }
}
