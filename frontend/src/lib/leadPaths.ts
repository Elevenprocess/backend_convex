import type { Role } from './types'

// Côté commercial ET côté délivrabilité (ops : RT / back-office / technicien),
// "leads" devient "dossier client" (URL /client + libellés). Centralisé ici pour
// éviter les `if (role === ...)` partout.

function usesClientSpace(role: Role | null | undefined): boolean {
  return (
    role === 'commercial' ||
    role === 'commercial_lead' ||
    role === 'delivrabilite' ||
    role === 'responsable_technique' ||
    role === 'back_office' ||
    role === 'technicien'
  )
}

export function leadListPath(role: Role | null | undefined): string {
  return usesClientSpace(role) ? '/client' : '/leads'
}

export function leadDetailPath(role: Role | null | undefined, id: string): string {
  return usesClientSpace(role) ? `/client/${id}` : `/leads/${id}`
}

export function leadSearchPath(role: Role | null | undefined, query: string): string {
  const base = leadListPath(role)
  return `${base}?search=${encodeURIComponent(query)}`
}
