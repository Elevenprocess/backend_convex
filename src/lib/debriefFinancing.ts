import type { FinancingType, PaymentSubMethod, FinancingOrg } from './types'

export const KITS_SEPARATOR = ' · '

export function joinKits(kits: string[]): string {
  return kits.map((k) => k.trim()).filter(Boolean).join(KITS_SEPARATOR)
}

export function splitKits(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(KITS_SEPARATOR).map((k) => k.trim()).filter(Boolean)
}

/** Acompte = montant devis TTC × pourcentage. null si entrées invalides. */
export function computeAcompteAmount(quoteAmount: string, percent: number | null): number | null {
  if (percent == null) return null
  const amount = Number(quoteAmount.replace(',', '.'))
  if (!quoteAmount.trim() || Number.isNaN(amount)) return null
  return (amount * percent) / 100
}

/** Sous-choix d'une méthode : pills chèque/espèces/virement, ou organisme CMOI/Sofider. */
export type SubChoiceKind = 'method' | 'org'

export type PaymentMethodConfig = {
  value: Extract<FinancingType, 'comptant' | 'financement' | 'paiement_10x' | 'paiement_12x'>
  label: string
  subChoice: SubChoiceKind
  acomptePercents: number[]
}

export const PAYMENT_METHOD_CONFIG: Record<
  'comptant' | 'financement' | 'paiement_10x' | 'paiement_12x',
  PaymentMethodConfig
> = {
  comptant: { value: 'comptant', label: 'Comptant', subChoice: 'method', acomptePercents: [40, 30] },
  financement: { value: 'financement', label: 'Financement', subChoice: 'org', acomptePercents: [30, 20] },
  paiement_10x: { value: 'paiement_10x', label: 'Paiement 10x', subChoice: 'method', acomptePercents: [30] },
  paiement_12x: { value: 'paiement_12x', label: 'Paiement 12x', subChoice: 'method', acomptePercents: [30] },
}

export const PAYMENT_METHOD_ORDER: PaymentMethodConfig['value'][] = [
  'comptant',
  'financement',
  'paiement_10x',
  'paiement_12x',
]

export const SUB_METHODS: { value: PaymentSubMethod; label: string }[] = [
  { value: 'cheque', label: 'Chèque' },
  { value: 'especes', label: 'Espèces' },
  { value: 'virement', label: 'Virement' },
]

export const FINANCING_ORGS: { value: FinancingOrg; label: string }[] = [
  { value: 'cmoi', label: 'CMOI' },
  { value: 'sofider', label: 'Sofider' },
]

/** Formate un montant € pour affichage (séparateur milliers FR). */
export function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)
}
