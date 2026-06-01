import type { Role } from './types'

// Côté commercial, "leads" devient "clients" (URL + libellés).
// Centralisé ici pour éviter les `if (role === 'commercial')` partout.

function isCommercial(role: Role | null | undefined): boolean {
  return role === 'commercial' || role === 'commercial_lead'
}

export function leadListPath(role: Role | null | undefined): string {
  return isCommercial(role) ? '/client' : '/leads'
}

export function leadDetailPath(role: Role | null | undefined, id: string): string {
  return isCommercial(role) ? `/client/${id}` : `/leads/${id}`
}

export function leadSearchPath(role: Role | null | undefined, query: string): string {
  const base = leadListPath(role)
  return `${base}?search=${encodeURIComponent(query)}`
}
