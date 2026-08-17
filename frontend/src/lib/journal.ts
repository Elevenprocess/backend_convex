import { ROLE_LABELS } from './role'
import { leadListPath } from './leadPaths'
import type { ActivityDomain, ConvexActivityDoc } from './convexApi'
import type { Role } from './types'

// ─── Constantes d'affichage ──────────────────────────────────────────────────

export const DOMAIN_META: Record<ActivityDomain, { label: string; short: string; cls: string; dot: string }> = {
  setting: { label: 'Setting', short: 'SET', cls: 'bg-or-tint text-or-dark', dot: 'bg-or' },
  closing: { label: 'Closing', short: 'CLO', cls: 'bg-cuivre-tint text-cuivre', dot: 'bg-cuivre' },
  delivrabilite: { label: 'Délivrabilité', short: 'DEL', cls: 'bg-success-tint text-success', dot: 'bg-success' },
  finances: { label: 'Finances', short: 'FIN', cls: 'bg-rouille-tint text-rouille', dot: 'bg-rouille' },
  admin: { label: 'Admin', short: 'ADM', cls: 'bg-info-tint text-info', dot: 'bg-info' },
  system: { label: 'Système', short: 'SYS', cls: 'bg-line text-muted', dot: 'bg-faint' },
}
export const DOMAIN_ORDER: ActivityDomain[] = ['setting', 'closing', 'delivrabilite', 'finances', 'admin', 'system']

export const ENTITY_META: Record<string, { label: string; plural: string }> = {
  lead: { label: 'Prospect', plural: 'Prospects' },
  call: { label: 'Appel', plural: 'Appels' },
  rdv: { label: 'RDV', plural: 'RDV' },
  debrief: { label: 'Débrief', plural: 'Débriefs' },
  devis: { label: 'Devis', plural: 'Devis' },
  project: { label: 'Projet', plural: 'Projets' },
  project_attachment: { label: 'Pièce projet', plural: 'Pièces projet' },
  client: { label: 'Dossier', plural: 'Dossiers' },
  workflow_step: { label: 'Étape', plural: 'Étapes' },
  workflow_substep: { label: 'Sous-étape', plural: 'Sous-étapes' },
  document: { label: 'Pièce', plural: 'Pièces' },
  acompte: { label: 'Acompte', plural: 'Acomptes' },
  user: { label: 'Compte', plural: 'Comptes' },
  invitation: { label: 'Invitation', plural: 'Invitations' },
  referrer: { label: 'Parrain', plural: 'Parrains' },
  commercial_objective: { label: 'Objectif', plural: 'Objectifs' },
}
export const ENTITY_ORDER = Object.keys(ENTITY_META)

const FIELD_LABELS: Record<string, string> = {
  status: 'Statut', firstName: 'Prénom', lastName: 'Nom', email: 'Email', phone: 'Téléphone',
  addressLine: 'Adresse', city: 'Ville', postalCode: 'Code postal', assignedToId: 'Commercial',
  setterId: 'Setter', commercialId: 'Commercial', scheduledAt: 'Date RDV', montantTotal: 'Montant',
  financingType: 'Financement', result: 'Résultat', outcome: 'Issue', notes: 'Notes', role: 'Rôle',
  active: 'Actif', team: 'Équipe', dateRealisee: 'Date réalisée', datePlanifiee: 'Date planifiée',
  responsableId: 'Responsable', problemReason: 'Motif', problemNotes: 'Notes problème', heure: 'Heure',
  deadline: 'Échéance', nextCallbackAt: 'Rappel', durationSec: 'Durée (s)', statut: 'Statut',
  montantReel: 'Montant réel', dateEncaissement: 'Encaissé le', source: 'Source', kind: 'Type',
  reason: 'Motif', newScheduledAt: 'Nouvelle date', ghlStageName: 'Étape GHL', channel: 'Canal',
  statusBefore: 'Statut avant', statusAfter: 'Statut après', name: 'Nom', devisNumber: 'N° devis',
  montantNet: 'Montant net', montantTtc: 'Montant TTC', filename: 'Fichier', files: 'Fichiers',
  type: 'Type', label: 'Libellé', period: 'Période', canalAcquisition: "Canal d'acquisition",
  utmSource: 'UTM source', campaign: 'Campagne', lostReason: 'Motif perte', monetaryValue: 'Valeur',
  ordre: 'Tranche', tranches: 'Tranches', projectId: 'Projet', rdvId: 'RDV', substepKey: 'Sous-étape',
  substepId: 'Sous-étape', phase: 'Phase', key: 'Clé', locationType: 'Lieu', appointmentId: 'RDV GHL',
  leadPatch: 'Fiche prospect', changed: 'Champs', nonSaleReason: 'Raison non-vente', kits: 'Kits',
  signedAt: 'Signé le', acompteAmount: 'Acompte', acomptePercent: 'Acompte %', paymentSubMethod: 'Mode',
  financingOrg: 'Organisme', createdById: 'Créé par', caTarget: 'Objectif CA', ventesTarget: 'Objectif ventes',
  rdvTarget: 'Objectif RDV', closingTarget: 'Objectif closing', sizeBytes: 'Taille', before: 'Avant', after: 'Après',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayTitle(ms: number): string {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 86_400_000)
  const k = dayKey(ms)
  const base = dayFmt.format(new Date(ms))
  if (k === today) return `Aujourd'hui — ${base}`
  if (k === yesterday) return `Hier — ${base}`
  return base.charAt(0).toUpperCase() + base.slice(1)
}

export function initialsOf(name: string): string {
  const parts = name.replace(/\(.*\)/, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export type EntityTarget = { path: string; leadId?: string }

/**
 * Cible de navigation d'une ligne du journal (null = pas de lien) :
 *  - tout ce qui concerne un prospect → liste prospects/clients du rôle avec
 *    le panneau latéral ouvert sur ce prospect (leadId renvoyé pour selectLead)
 *  - actions de dossier délivrabilité (étapes, sous-étapes, pièces, dossier)
 *    → page dossier /suivi/:lead (panneau dossier intégré)
 *  - comptes / invitations / objectifs → Paramètres ; acomptes → Finances
 */
export function entityTarget(
  row: Pick<ConvexActivityDoc, 'entityType' | 'entityId' | 'leadId' | 'clientId'>,
  role: Role | null | undefined,
): EntityTarget | null {
  switch (row.entityType) {
    case 'client':
    case 'workflow_step':
    case 'workflow_substep':
    case 'document':
      return row.leadId ? { path: `/suivi/${row.leadId}`, leadId: row.leadId } : null
    case 'acompte':
      return { path: '/finances' }
    case 'user':
    case 'invitation':
    case 'commercial_objective':
      return { path: '/settings' }
    default:
      return row.leadId ? { path: leadListPath(role), leadId: row.leadId } : null
  }
}

/** Chemin seul (compat / affichage). */
export function entityPath(
  row: Pick<ConvexActivityDoc, 'entityType' | 'entityId' | 'leadId' | 'clientId'>,
  role: Role | null | undefined,
): string | null {
  return entityTarget(row, role)?.path ?? null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fmtValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  if (typeof v === 'number') {
    // Timestamps ms plausibles (2001 → 2100)
    if (/At$/.test(key) && v > 1_000_000_000_000 && v < 4_102_444_800_000) return dateTimeFmt.format(new Date(v))
    if (/montant|Amount|Target|caTarget/i.test(key)) return `${v.toLocaleString('fr-FR')}`
    return String(v)
  }
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map((x) => (isPlainObject(x) ? JSON.stringify(x) : String(x))).join(', ')
  if (isPlainObject(v)) return JSON.stringify(v)
  return String(v)
}

/** Aplatit `details` en lignes lisibles : diff avant/après + autres clés. */
export function detailRows(details: unknown): Array<{ label: string; before?: string; after?: string; value?: string }> {
  if (!isPlainObject(details)) return []
  const rows: Array<{ label: string; before?: string; after?: string; value?: string }> = []
  const before = isPlainObject(details.before) ? details.before : null
  const after = isPlainObject(details.after) ? details.after : null
  if (before || after) {
    const keys = new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])])
    for (const k of keys) {
      rows.push({ label: FIELD_LABELS[k] ?? k, before: fmtValue(k, before?.[k]), after: fmtValue(k, after?.[k]) })
    }
  }
  for (const [k, v] of Object.entries(details)) {
    if (k === 'before' || k === 'after') continue
    if (v === null || v === undefined) continue
    rows.push({ label: FIELD_LABELS[k] ?? k, value: fmtValue(k, v) })
  }
  return rows
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: ConvexActivityDoc[]): string {
  const header = ['Date', 'Heure', 'Acteur', 'Rôle', 'Côté', 'Action', 'Type', 'Sujet', 'Résumé', 'Détails']
  const lines = rows.map((r) => {
    const d = new Date(r.at)
    return [
      d.toLocaleDateString('fr-FR'), timeFmt.format(d), r.actorName,
      r.actorRole ? (ROLE_LABELS[r.actorRole as Role] ?? r.actorRole) : '',
      DOMAIN_META[r.domain]?.label ?? r.domain, r.action, ENTITY_META[r.entityType]?.label ?? r.entityType,
      r.subject ?? '', r.summary, r.details ? JSON.stringify(r.details) : '',
    ].map(csvEscape).join(';')
  })
  return '﻿' + [header.join(';'), ...lines].join('\r\n')
}

