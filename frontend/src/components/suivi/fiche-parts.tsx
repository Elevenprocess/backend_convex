import { useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { formatDate } from '../../lib/suivi'
import { attachmentDisplayUrl, downloadDevisPdf, updateDevis } from '../../lib/api'
import { DevisScanLoader } from '../devis/DevisScanLoader'
import {
  DEBRIEF_OUTCOME_LABEL,
  PAYMENT_SUB_METHOD_LABEL,
  FINANCING_ORG_LABEL,
  cleanField,
  type Devis,
  type DevisStatus,
  type DevisLigne,
  type DevisEcheance,
  type DevisPrime,
  type UpdateDevisPatch,
  type ProjectAttachmentResponse,
  type DebriefResponse,
} from '../../lib/types'

const FINANCING_TYPE_SHORT: Record<string, string> = {
  comptant: 'Comptant',
  financement: 'Financement',
  financement_sans_apport: 'Financement sans apport',
  apport_financement: 'Apport + financement',
  paiement_10x: 'Paiement 10x',
  paiement_12x: 'Paiement 12x',
}

type DebriefFinancing = Pick<DebriefResponse, 'financingType' | 'paymentSubMethod' | 'financingOrg'>

/** Type de financement (+ organisme CMOI/Sofider) saisi au débriefing. */
export function formatDebriefFinancingType(d: DebriefFinancing): string | null {
  const bits = [
    d.financingType ? FINANCING_TYPE_SHORT[d.financingType] ?? d.financingType : null,
    d.financingOrg ? FINANCING_ORG_LABEL[d.financingOrg] : null,
  ].filter(Boolean)
  return bits.length > 0 ? bits.join(' · ') : null
}

/** Méthode de paiement (chèque / espèces / virement) saisie au débriefing. */
export function formatDebriefPaymentMethod(d: DebriefFinancing): string | null {
  return d.paymentSubMethod ? PAYMENT_SUB_METHOD_LABEL[d.paymentSubMethod] : null
}

/**
 * Résumé complet « type + méthode + organisme » sur une ligne (carte débrief).
 * Renvoie null si rien n'a été renseigné.
 */
export function formatDebriefFinancing(d: DebriefFinancing): string | null {
  const bits = [
    d.financingType ? FINANCING_TYPE_SHORT[d.financingType] ?? d.financingType : null,
    formatDebriefPaymentMethod(d),
    d.financingOrg ? FINANCING_ORG_LABEL[d.financingOrg] : null,
  ].filter(Boolean)
  return bits.length > 0 ? bits.join(' · ') : null
}

const DEVIS_STATUS_META: Record<DevisStatus, { label: string; tone: string }> = {
  brouillon: { label: 'Brouillon', tone: 'is-neutral' },
  en_attente: { label: 'En attente', tone: 'is-warn' },
  signature_en_cours: { label: 'Signature en cours', tone: 'is-info' },
  signe: { label: 'Signé', tone: 'is-ok' },
  perdu: { label: 'Perdu', tone: 'is-lost' },
}

export function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-cuivre">
          {title}
          {count != null && count > 0 && (
            <span className="rounded-full bg-or-tint px-1.5 py-0.5 text-[10px] font-semibold text-or-dark">{count}</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Petit bouton « + » des en-têtes de section (Devis, Photos, Documents, Notes). */
export function SectionAddButton({ onClick, label, busy = false }: { onClick: () => void; label: string; busy?: boolean }) {
  return (
    <button type="button" className="fiche-section-add" onClick={onClick} disabled={busy} title={label} aria-label={label}>
      {busy ? <span className="fiche-section-add-spin" aria-hidden /> : <Icon name="plus" size={14} />}
    </button>
  )
}

export function Field({ label, value, href, wide }: { label: string; value: string | null | undefined; href?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="break-words text-[13px] font-medium text-text">
        {value ? (href ? <a href={href} className="text-or-dark hover:text-or">{value}</a> : value) : '—'}
      </dd>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">{children}</div>
}

/** Formate un montant numérique (string BDD ou number) en « 1 234 € ». */
function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toLocaleString('fr-FR')} €` : '—'
}

/** Bloc détaillé d'un devis scanné, affiché quand la carte est « développée ». */
function DevisDetail({ devis }: { devis: Devis }) {
  const extracted = devis.extracted ?? undefined
  const lignes = (devis.lignes?.length ? devis.lignes : extracted?.lignes) ?? []
  const echeancier = (devis.echeancier?.length ? devis.echeancier : extracted?.echeancier) ?? []
  const prime = extracted?.prime
  const customer = extracted?.customer
  const vendor = extracted?.vendor
  const financingDetails = extracted?.financingDetails
  const financing = devis.financingType ? FINANCING_TYPE_SHORT[devis.financingType] ?? devis.financingType : null
  const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ')
  const customerAddress = [customer?.addressLine, customer?.postalCode, customer?.city].filter(Boolean).join(' · ')
  const vendorAddress = [vendor?.addressLine, vendor?.postalCode, vendor?.city].filter(Boolean).join(' · ')
  return (
    <div className="fiche-devis-detail space-y-4">
      {devis.ocrStatus === 'failed' && (
        <div className="rounded-lg bg-rouille-tint px-3 py-2 text-[11px] font-semibold text-rouille">
          Scan OCR en échec{devis.ocrError ? ` : ${cleanField(devis.ocrError)}` : '.'} — les champs ci-dessous peuvent être vides.
        </div>
      )}

      {(customerName || customerAddress || customer?.email || customer?.phone) && (
        <section className="rounded-xl border border-line bg-card/70 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cuivre">Client extrait du devis</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Field label="Nom" value={cleanField(customerName)} wide />
            <Field label="Email" value={cleanField(customer?.email)} href={customer?.email ? `mailto:${customer.email}` : undefined} />
            <Field label="Téléphone" value={cleanField(customer?.phone)} href={customer?.phone ? `tel:${customer.phone}` : undefined} />
            <Field label="Adresse" value={cleanField(customerAddress)} wide />
          </dl>
        </section>
      )}

      <section>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cuivre">Résumé devis</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Field label="Numéro" value={cleanField(devis.devisNumber ?? extracted?.devisNumber)} />
          <Field label="Date" value={devis.devisDate ? formatDate(devis.devisDate) : extracted?.devisDate ? formatDate(extracted.devisDate) : null} />
          <Field label="Expiration" value={devis.dateExpiration ? formatDate(devis.dateExpiration) : extracted?.dateExpiration ? formatDate(extracted.dateExpiration) : null} />
          <Field label="Puissance" value={devis.puissanceKwc ? `${devis.puissanceKwc} kWc` : extracted?.puissanceKwc ? `${extracted.puissanceKwc} kWc` : null} />
          <Field label="Panneaux" value={devis.nbPanneaux != null ? String(devis.nbPanneaux) : extracted?.nbPanneaux != null ? String(extracted.nbPanneaux) : null} />
          <Field label="Délai" value={cleanField(devis.delaiExecution ?? extracted?.delaiExecution)} />
          <Field label="Montant HT" value={devis.montantHt ? fmtMoney(devis.montantHt) : fmtMoney(extracted?.montantHt)} />
          <Field label="TVA" value={devis.montantTva ? fmtMoney(devis.montantTva) : fmtMoney(extracted?.montantTva)} />
          <Field label="Montant TTC" value={devis.montantTtc ? fmtMoney(devis.montantTtc) : fmtMoney(extracted?.montantTtc)} />
          <Field label="Net à payer" value={devis.montantNet ? fmtMoney(devis.montantNet) : fmtMoney(extracted?.montantNet)} />
          <Field label="Financement" value={financing} />
          <Field label="Prime EDF" value={devis.primeAutoconsommation ? fmtMoney(devis.primeAutoconsommation) : fmtMoney(prime?.montant)} />
        </dl>
      </section>

      {(devis.kits || extracted?.kits || prime || extracted?.conditionsReglement || financingDetails) && (
        <section className="rounded-xl border border-line bg-muted/20 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cuivre">Détails commerciaux</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Field label="Kit" value={cleanField(devis.kits ?? extracted?.kits)} wide />
            <Field label="Conditions" value={cleanField(extracted?.conditionsReglement)} wide />
            <Field label="Prime" value={prime?.montant ? `${fmtMoney(prime.montant)}${prime.zone ? ` · ${prime.zone}` : ''}` : null} />
            <Field label="Mensualité" value={financingDetails?.mensualite ? fmtMoney(financingDetails.mensualite) : null} />
            <Field label="Durée" value={financingDetails?.duree ? `${financingDetails.duree} mois` : null} />
            <Field label="Apport" value={financingDetails?.apport ? fmtMoney(financingDetails.apport) : null} />
          </dl>
        </section>
      )}

      {lignes.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cuivre">Lignes du devis ({lignes.length})</div>
          <ul className="space-y-2">
            {lignes.map((l, i) => (
              <li key={i} className="rounded-xl border border-line bg-card/70 p-2.5 text-[12px]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-text">{l.qty ? `${l.qty} × ` : ''}{cleanField(l.designation) ?? '—'}</div>
                    {l.description && <div className="mt-1 text-[11px] leading-relaxed text-muted">{cleanField(l.description)}</div>}
                    {l.type && <div className="mt-1 text-[10px] uppercase tracking-wide text-faint">{l.type}</div>}
                  </div>
                  <div className="shrink-0 text-right font-semibold tabular-nums text-text">
                    <div>{fmtMoney(l.totalTtc ?? l.totalHt)}</div>
                    <div className="text-[10px] font-medium text-faint">HT {fmtMoney(l.totalHt)} · TVA {l.tva ?? '—'}%</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {echeancier.length > 0 && (
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cuivre">Échéancier ({echeancier.length})</div>
          <ul className="space-y-1">
            {echeancier.map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 rounded-lg border border-line bg-card/70 px-2.5 py-2 text-[12px]">
                <span className="min-w-0 flex-1 text-muted">{cleanField(e.label) ?? e.phase ?? '—'}</span>
                <span className="shrink-0 font-semibold tabular-nums text-text">{fmtMoney(e.montant)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(vendor?.name || vendorAddress || vendor?.phone || vendor?.email) && (
        <details className="rounded-xl border border-line bg-card/40 p-3 text-[12px]">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-faint">Vendeur / société émettrice</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Field label="Société" value={cleanField(vendor?.name)} wide />
            <Field label="Email" value={cleanField(vendor?.email)} />
            <Field label="Téléphone" value={cleanField(vendor?.phone)} />
            <Field label="Adresse" value={cleanField(vendorAddress)} wide />
          </dl>
        </details>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * Édition du devis OCR : tous les champs extraits sont modifiables à la main
 * (l'OCR peut rater ou se tromper). Le PATCH /devis/:id accepte exactement ces
 * champs ; vendor/customer/prime/financingDetails vivent dans `extracted` et
 * sont remplacés en bloc côté backend, donc on renvoie ces objets complets.
 * ───────────────────────────────────────────────────────────────────────── */

const FICHE_STATUS_OPTIONS: { value: DevisStatus; label: string }[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'en_attente', label: 'En attente' },
  { value: 'signature_en_cours', label: 'Signature en cours' },
  { value: 'perdu', label: 'Perdu' },
]

const FICHE_FINANCING_OPTIONS = [
  { value: '', label: '—' },
  { value: 'comptant', label: 'Comptant' },
  { value: 'financement', label: 'Financement' },
  { value: 'financement_sans_apport', label: 'Financement sans apport' },
  { value: 'apport_financement', label: 'Apport + financement' },
  { value: 'paiement_10x', label: 'Paiement 10x' },
]

const FICHE_PHASE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'signature', label: 'À la signature' },
  { value: 'vt', label: 'Visite technique' },
  { value: 'dp', label: 'Déclaration préalable' },
  { value: 'pose_planif', label: 'Planification pose' },
  { value: 'pose', label: 'À la pose' },
  { value: 'mes', label: 'Mise en service' },
  { value: 'autre', label: 'Autre' },
]

const FICHE_LIGNE_TYPE_OPTIONS = [
  { value: '', label: '—' },
  ...['panneau', 'onduleur', 'batterie', 'fixation', 'monitoring', 'protection', 'prestation', 'consuel', 'remise', 'autre'].map(
    (t) => ({ value: t, label: t }),
  ),
]

/** '' → null ; sinon la chaîne taillée. */
function strOrNull(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}
/** '' → undefined ; sinon la chaîne taillée (pour les objets remplacés en bloc). */
function strOrUndef(v: string): string | undefined {
  const t = v.trim()
  return t === '' ? undefined : t
}
/** '' → null ; sinon le nombre (virgule décimale tolérée). */
function numOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
/** Comme numOrNull mais arrondi entier (panneaux, durée). */
function intOrNull(v: string): number | null {
  const n = numOrNull(v)
  return n === null ? null : Math.round(n)
}
function numToStr(v: string | number | null | undefined): string {
  return v == null || v === '' ? '' : String(v)
}

type LigneDraft = {
  designation: string
  description: string
  qty: string
  prixUnitaireHt: string
  totalHt: string
  tva: string
  totalTtc: string
  type: string
}
type EcheanceDraft = { label: string; phase: string; montant: string }

type FicheDevisDraft = {
  status: DevisStatus
  devisNumber: string
  devisDate: string
  dateExpiration: string
  delaiExecution: string
  puissanceKwc: string
  nbPanneaux: string
  kits: string
  montantHt: string
  montantTva: string
  montantTtc: string
  montantNet: string
  financingType: string
  primeMontant: string
  primeTarif: string
  primeZone: string
  primeType: string
  primeModalite: string
  primeRemarque: string
  conditionsReglement: string
  vendorName: string
  vendorAddressLine: string
  vendorPostalCode: string
  vendorCity: string
  vendorPhone: string
  vendorEmail: string
  customerFirstName: string
  customerLastName: string
  customerAddressLine: string
  customerCity: string
  customerPostalCode: string
  customerEmail: string
  customerPhone: string
  finDuree: string
  finMensualite: string
  finTaux: string
  finApport: string
}

function ligneToDraft(l: DevisLigne): LigneDraft {
  return {
    designation: l.designation ?? '',
    description: l.description ?? '',
    qty: numToStr(l.qty),
    prixUnitaireHt: numToStr(l.prixUnitaireHt),
    totalHt: numToStr(l.totalHt),
    tva: numToStr(l.tva),
    totalTtc: numToStr(l.totalTtc),
    type: l.type ?? '',
  }
}
function echeanceToDraft(e: DevisEcheance): EcheanceDraft {
  return { label: e.label ?? '', phase: e.phase ?? '', montant: numToStr(e.montant) }
}

function toFicheDraft(d: Devis): FicheDevisDraft {
  const p = d.extracted?.prime
  const v = d.extracted?.vendor
  const c = d.extracted?.customer
  const f = d.extracted?.financingDetails
  return {
    status: d.status,
    devisNumber: d.devisNumber ?? '',
    devisDate: d.devisDate ?? '',
    dateExpiration: d.dateExpiration ?? '',
    delaiExecution: d.delaiExecution ?? '',
    puissanceKwc: numToStr(d.puissanceKwc),
    nbPanneaux: numToStr(d.nbPanneaux),
    kits: d.kits ?? '',
    montantHt: numToStr(d.montantHt),
    montantTva: numToStr(d.montantTva),
    montantTtc: numToStr(d.montantTtc),
    montantNet: numToStr(d.montantNet),
    financingType: d.financingType ?? '',
    primeMontant: numToStr(d.primeAutoconsommation ?? p?.montant),
    primeTarif: numToStr(d.primeTarifKwc ?? p?.tarifEuroParKwc),
    primeZone: d.primeZone ?? p?.zone ?? '',
    primeType: p?.type ?? '',
    primeModalite: p?.modaliteVersement ?? '',
    primeRemarque: p?.remarque ?? '',
    conditionsReglement: d.extracted?.conditionsReglement ?? '',
    vendorName: v?.name ?? '',
    vendorAddressLine: v?.addressLine ?? '',
    vendorPostalCode: v?.postalCode ?? '',
    vendorCity: v?.city ?? '',
    vendorPhone: v?.phone ?? '',
    vendorEmail: v?.email ?? '',
    customerFirstName: c?.firstName ?? '',
    customerLastName: c?.lastName ?? '',
    customerAddressLine: c?.addressLine ?? '',
    customerCity: c?.city ?? '',
    customerPostalCode: c?.postalCode ?? '',
    customerEmail: c?.email ?? '',
    customerPhone: c?.phone ?? '',
    finDuree: numToStr(f?.duree),
    finMensualite: numToStr(f?.mensualite),
    finTaux: numToStr(f?.taux),
    finApport: numToStr(f?.apport),
  }
}

function buildFichePatch(
  d: Devis,
  draft: FicheDevisDraft,
  lignes: LigneDraft[],
  echeancier: EcheanceDraft[],
): UpdateDevisPatch {
  const patch: UpdateDevisPatch = {}
  if (draft.status !== d.status && draft.status !== 'signe') patch.status = draft.status

  patch.devisNumber = strOrNull(draft.devisNumber)
  patch.devisDate = strOrNull(draft.devisDate)
  patch.dateExpiration = strOrNull(draft.dateExpiration)
  patch.delaiExecution = strOrNull(draft.delaiExecution)
  patch.kits = strOrNull(draft.kits)
  patch.financingType = strOrNull(draft.financingType)
  patch.conditionsReglement = strOrNull(draft.conditionsReglement)
  patch.puissanceKwc = numOrNull(draft.puissanceKwc)
  patch.nbPanneaux = intOrNull(draft.nbPanneaux)
  patch.montantHt = numOrNull(draft.montantHt)
  patch.montantTva = numOrNull(draft.montantTva)
  patch.montantTtc = numOrNull(draft.montantTtc)
  patch.montantNet = numOrNull(draft.montantNet)

  // Prime : on tient à jour les colonnes dénormalisées (affichées) ET l'objet
  // `prime` dans extracted (modalité / remarque). Les clés nulles sont omises
  // de `prime` car le schéma backend exige montant numérique.
  patch.primeAutoconsommation = numOrNull(draft.primeMontant)
  patch.primeTarifKwc = numOrNull(draft.primeTarif)
  patch.primeZone = strOrNull(draft.primeZone)
  const prime: Partial<DevisPrime> = {}
  const pMontant = numOrNull(draft.primeMontant)
  const pTarif = numOrNull(draft.primeTarif)
  const pZone = strOrNull(draft.primeZone)
  const pType = strOrNull(draft.primeType)
  const pModalite = strOrNull(draft.primeModalite)
  const pRemarque = strOrNull(draft.primeRemarque)
  if (pMontant != null) prime.montant = pMontant
  if (pTarif != null) prime.tarifEuroParKwc = pTarif
  if (pZone) prime.zone = pZone
  if (pType) prime.type = pType
  if (pModalite) prime.modaliteVersement = pModalite
  if (pRemarque) prime.remarque = pRemarque
  if (Object.keys(prime).length > 0) patch.prime = prime

  // vendor/customer sont remplacés EN BLOC dans `extracted` côté backend : une
  // clé omise (undefined → absente du JSON) revient donc à effacer le champ.
  patch.vendor = {
    name: strOrUndef(draft.vendorName),
    addressLine: strOrUndef(draft.vendorAddressLine),
    postalCode: strOrUndef(draft.vendorPostalCode),
    city: strOrUndef(draft.vendorCity),
    phone: strOrUndef(draft.vendorPhone),
    email: strOrUndef(draft.vendorEmail),
  }
  patch.customer = {
    firstName: strOrUndef(draft.customerFirstName),
    lastName: strOrUndef(draft.customerLastName),
    addressLine: strOrUndef(draft.customerAddressLine),
    city: strOrUndef(draft.customerCity),
    postalCode: strOrUndef(draft.customerPostalCode),
    email: strOrUndef(draft.customerEmail),
    phone: strOrUndef(draft.customerPhone),
  }
  patch.financingDetails = {
    duree: intOrNull(draft.finDuree),
    mensualite: numOrNull(draft.finMensualite),
    taux: numOrNull(draft.finTaux),
    apport: numOrNull(draft.finApport),
  }

  patch.lignes = lignes
    .filter((l) => l.designation.trim() !== '')
    .map((l) => ({
      designation: l.designation.trim(),
      ...(strOrNull(l.description) ? { description: l.description.trim() } : {}),
      qty: intOrNull(l.qty) ?? 0,
      prixUnitaireHt: numOrNull(l.prixUnitaireHt) ?? 0,
      totalHt: numOrNull(l.totalHt) ?? 0,
      tva: Math.max(0, numOrNull(l.tva) ?? 0),
      totalTtc: numOrNull(l.totalTtc) ?? 0,
      ...(l.type ? { type: l.type } : {}),
    }))

  patch.echeancier = echeancier
    .filter((e) => e.label.trim() !== '' || numOrNull(e.montant) != null)
    .map((e) => ({
      label: e.label.trim(),
      ...(e.phase ? { phase: e.phase } : {}),
      montant: Math.max(0, numOrNull(e.montant) ?? 0),
    }))

  return patch
}

const EDIT_INPUT_CLS =
  'w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12px] text-text focus:border-or focus:outline-none'

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  wide,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'date' | 'number'
  wide?: boolean
}) {
  return (
    <label className={`block ${wide ? 'col-span-2 sm:col-span-3' : ''}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={EDIT_INPUT_CLS} inputMode={type === 'number' ? 'decimal' : undefined} />
    </label>
  )
}

function EditTextarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="col-span-2 block sm:col-span-3">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={`${EDIT_INPUT_CLS} resize-y`} />
    </label>
  )
}

function EditSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={EDIT_INPUT_CLS}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function EditBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cuivre">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  )
}

/** Formulaire d'édition complet d'un devis OCR (tous les champs extraits). */
function DevisEditForm({ devis, onSaved, onCancel }: { devis: Devis; onSaved: (d: Devis) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<FicheDevisDraft>(() => toFicheDraft(devis))
  const [lignes, setLignes] = useState<LigneDraft[]>(() => (devis.lignes ?? []).map(ligneToDraft))
  const [echeancier, setEcheancier] = useState<EcheanceDraft[]>(() => (devis.echeancier ?? []).map(echeanceToDraft))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const set =
    (k: keyof FicheDevisDraft) =>
    (v: string) =>
      setDraft((p) => ({ ...p, [k]: v }) as FicheDevisDraft)
  const setLigne = (i: number, k: keyof LigneDraft, v: string) =>
    setLignes((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const setEch = (i: number, k: keyof EcheanceDraft, v: string) =>
    setEcheancier((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const updated = await updateDevis(devis.id, buildFichePatch(devis, draft, lignes, echeancier))
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Échec de l'enregistrement.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fiche-devis-detail">
      <EditBlock title="Identité">
        <EditSelect label="Statut" value={draft.status} onChange={(v) => set('status')(v)} options={FICHE_STATUS_OPTIONS} />
        <EditField label="Numéro" value={draft.devisNumber} onChange={set('devisNumber')} />
        <EditField label="Délai" value={draft.delaiExecution} onChange={set('delaiExecution')} />
        <EditField label="Date" type="date" value={draft.devisDate} onChange={set('devisDate')} />
        <EditField label="Expiration" type="date" value={draft.dateExpiration} onChange={set('dateExpiration')} />
      </EditBlock>

      <EditBlock title="Installation">
        <EditField label="Puissance (kWc)" type="number" value={draft.puissanceKwc} onChange={set('puissanceKwc')} />
        <EditField label="Panneaux" type="number" value={draft.nbPanneaux} onChange={set('nbPanneaux')} />
        <EditTextarea label="Kit" value={draft.kits} onChange={set('kits')} />
      </EditBlock>

      <EditBlock title="Montants">
        <EditField label="Montant HT" type="number" value={draft.montantHt} onChange={set('montantHt')} />
        <EditField label="TVA" type="number" value={draft.montantTva} onChange={set('montantTva')} />
        <EditField label="Montant TTC" type="number" value={draft.montantTtc} onChange={set('montantTtc')} />
        <EditField label="Net à payer" type="number" value={draft.montantNet} onChange={set('montantNet')} />
      </EditBlock>

      <EditBlock title="Prime & financement">
        <EditSelect label="Financement" value={draft.financingType} onChange={(v) => set('financingType')(v)} options={FICHE_FINANCING_OPTIONS} />
        <EditField label="Prime EDF (€)" type="number" value={draft.primeMontant} onChange={set('primeMontant')} />
        <EditField label="Tarif (€/kWc)" type="number" value={draft.primeTarif} onChange={set('primeTarif')} />
        <EditField label="Zone prime" value={draft.primeZone} onChange={set('primeZone')} />
        <EditField label="Type prime" value={draft.primeType} onChange={set('primeType')} />
        <EditField label="Modalité versement" value={draft.primeModalite} onChange={set('primeModalite')} />
        <EditField label="Remarque prime" value={draft.primeRemarque} onChange={set('primeRemarque')} wide />
        <EditField label="Durée (mois)" type="number" value={draft.finDuree} onChange={set('finDuree')} />
        <EditField label="Mensualité (€)" type="number" value={draft.finMensualite} onChange={set('finMensualite')} />
        <EditField label="Taux (%)" type="number" value={draft.finTaux} onChange={set('finTaux')} />
        <EditField label="Apport (€)" type="number" value={draft.finApport} onChange={set('finApport')} />
        <EditField label="Conditions règlement" value={draft.conditionsReglement} onChange={set('conditionsReglement')} wide />
      </EditBlock>

      <EditBlock title="Vendeur">
        <EditField label="Raison sociale" value={draft.vendorName} onChange={set('vendorName')} />
        <EditField label="Adresse" value={draft.vendorAddressLine} onChange={set('vendorAddressLine')} />
        <EditField label="Code postal" value={draft.vendorPostalCode} onChange={set('vendorPostalCode')} />
        <EditField label="Ville" value={draft.vendorCity} onChange={set('vendorCity')} />
        <EditField label="Téléphone" value={draft.vendorPhone} onChange={set('vendorPhone')} />
        <EditField label="Email" value={draft.vendorEmail} onChange={set('vendorEmail')} />
      </EditBlock>

      <EditBlock title="Client">
        <EditField label="Prénom" value={draft.customerFirstName} onChange={set('customerFirstName')} />
        <EditField label="Nom" value={draft.customerLastName} onChange={set('customerLastName')} />
        <EditField label="Adresse" value={draft.customerAddressLine} onChange={set('customerAddressLine')} />
        <EditField label="Code postal" value={draft.customerPostalCode} onChange={set('customerPostalCode')} />
        <EditField label="Ville" value={draft.customerCity} onChange={set('customerCity')} />
        <EditField label="Téléphone" value={draft.customerPhone} onChange={set('customerPhone')} />
        <EditField label="Email" value={draft.customerEmail} onChange={set('customerEmail')} />
      </EditBlock>

      {/* Lignes produits — éditables, ajout/suppression libre */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-cuivre">Lignes ({lignes.length})</span>
          <button
            type="button"
            onClick={() => setLignes((r) => [...r, { designation: '', description: '', qty: '1', prixUnitaireHt: '', totalHt: '', tva: '0', totalTtc: '', type: '' }])}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-or-dark hover:text-or"
          >
            <Icon name="plus" size={12} /> Ajouter une ligne
          </button>
        </div>
        <div className="space-y-2">
          {lignes.map((l, i) => (
            <div key={i} className="rounded-lg border border-line bg-cream/40 p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <EditField label="Désignation" value={l.designation} onChange={(v) => setLigne(i, 'designation', v)} wide />
                <EditSelect label="Type" value={l.type} onChange={(v) => setLigne(i, 'type', v)} options={FICHE_LIGNE_TYPE_OPTIONS} />
                <EditField label="Qté" type="number" value={l.qty} onChange={(v) => setLigne(i, 'qty', v)} />
                <EditField label="PU HT" type="number" value={l.prixUnitaireHt} onChange={(v) => setLigne(i, 'prixUnitaireHt', v)} />
                <EditField label="Total HT" type="number" value={l.totalHt} onChange={(v) => setLigne(i, 'totalHt', v)} />
                <EditField label="TVA (%)" type="number" value={l.tva} onChange={(v) => setLigne(i, 'tva', v)} />
                <EditField label="Total TTC" type="number" value={l.totalTtc} onChange={(v) => setLigne(i, 'totalTtc', v)} />
                <EditField label="Description" value={l.description} onChange={(v) => setLigne(i, 'description', v)} wide />
              </div>
              <div className="mt-1.5 text-right">
                <button type="button" onClick={() => setLignes((r) => r.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-[11px] font-semibold text-rouille hover:opacity-80">
                  <Icon name="x" size={12} /> Retirer
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Échéancier — éditable */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-cuivre">Échéancier ({echeancier.length})</span>
          <button
            type="button"
            onClick={() => setEcheancier((r) => [...r, { label: '', phase: '', montant: '' }])}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-or-dark hover:text-or"
          >
            <Icon name="plus" size={12} /> Ajouter une échéance
          </button>
        </div>
        <div className="space-y-2">
          {echeancier.map((e, i) => (
            <div key={i} className="rounded-lg border border-line bg-cream/40 p-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <EditField label="Libellé" value={e.label} onChange={(v) => setEch(i, 'label', v)} wide />
                <EditField label="Montant (€)" type="number" value={e.montant} onChange={(v) => setEch(i, 'montant', v)} />
                <EditSelect label="Phase" value={e.phase} onChange={(v) => setEch(i, 'phase', v)} options={FICHE_PHASE_OPTIONS} />
              </div>
              <div className="mt-1.5 text-right">
                <button type="button" onClick={() => setEcheancier((r) => r.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-[11px] font-semibold text-rouille hover:opacity-80">
                  <Icon name="x" size={12} /> Retirer
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {err && <div className="mt-3 rounded-lg bg-rouille-tint px-3 py-2 text-[11px] font-semibold text-rouille">{err}</div>}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="fiche-devis-dl disabled:opacity-50">
          Annuler
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-text px-3 py-1.5 text-[12px] font-semibold text-cream disabled:opacity-50">
          <Icon name="check" size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

export function DevisRow({
  devis,
  onPreview,
  onDelete,
  onUpdated,
  deleting = false,
  defaultExpanded = false,
  readOnly = false,
}: {
  devis: Devis
  onPreview?: () => void
  onDelete?: () => void
  /** Appelé après une édition réussie (le parent rafraîchit le projet). */
  onUpdated?: (d: Devis) => void
  deleting?: boolean
  defaultExpanded?: boolean
  /** Vue consultation (ex : commercial) : pas de modification ni suppression. */
  readOnly?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [editing, setEditing] = useState(false)
  const scanning = devis.ocrStatus === 'pending' || devis.ocrStatus === 'processing'
  // Un devis signé est verrouillé (la signature déclenche la livraison) : pas d'édition.
  const canEdit = !readOnly && !scanning && devis.status !== 'signe'
  const montant = devis.montantTtc ?? devis.montantNet ?? devis.montantHt
  const status = DEVIS_STATUS_META[devis.status] ?? { label: devis.status, tone: 'is-neutral' }
  const meta = [
    devis.puissanceKwc ? `${devis.puissanceKwc} kWc` : null,
    devis.nbPanneaux ? `${devis.nbPanneaux} panneaux` : null,
    devis.devisDate ? formatDate(devis.devisDate) : null,
  ].filter(Boolean)
  return (
    <li className="fiche-devis-card">
      {/* Clic sur le corps de la ligne → aperçu PDF en pop-up (pas de redirection). */}
      <button
        type="button"
        className={`fiche-devis-main${onPreview ? ' is-clickable' : ''}`}
        onClick={onPreview}
        disabled={!onPreview}
        title={onPreview ? 'Aperçu du devis' : undefined}
        style={onPreview ? undefined : { cursor: 'default' }}
      >
        <span className="fiche-devis-icon"><Icon name="tag" size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="fiche-devis-top">
            <span className="fiche-devis-num">{devis.devisNumber || devis.filename}</span>
            <span className={`fiche-devis-status ${status.tone}`}>{status.label}</span>
            {scanning && <span className="fiche-devis-status is-info">Scan OCR…</span>}
          </div>
          {meta.length > 0 && <div className="fiche-devis-meta">{meta.join(' · ')}</div>}
        </div>
      </button>

      {/* Pendant l'OCR : anneau de chargement à la place du détail. */}
      {scanning && <DevisScanLoader ocrStatus={devis.ocrStatus} />}

      <div className="fiche-devis-foot">
        <span className="fiche-devis-amount">{montant ? `${Number(montant).toLocaleString('fr-FR')} €` : '—'}</span>
        <div className="ml-auto flex items-center gap-2">
          {!scanning && !editing && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="fiche-devis-dl"
              aria-expanded={expanded}
            >
              <Icon name="chevron-down" size={13} />
              {expanded ? 'Réduire' : 'Développer'}
            </button>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => {
                setExpanded(true)
                setEditing(true)
              }}
              className="fiche-devis-dl"
              title="Modifier les champs du devis"
            >
              <Icon name="edit" size={13} /> Modifier
            </button>
          )}
          <button
            type="button"
            onClick={() => void downloadDevisPdf(devis.id, devis.filename)}
            className="fiche-devis-dl"
          >
            <Icon name="download" size={13} /> PDF
          </button>
          {onDelete && !editing && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="fiche-devis-dl text-rouille hover:text-rouille"
              title="Supprimer le devis"
            >
              <Icon name="trash" size={13} /> {deleting ? '…' : 'Supprimer'}
            </button>
          )}
        </div>
      </div>

      {/* Édition (tous les champs) ou détail développé/réduit (réduit par défaut). */}
      {!scanning && editing ? (
        <DevisEditForm
          devis={devis}
          onSaved={(u) => {
            setEditing(false)
            onUpdated?.(u)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        !scanning && expanded && <DevisDetail devis={devis} />
      )}
    </li>
  )
}

/** Une entrée du journal de notes : aperçu cliquable → pop-up texte complet. */
export function NoteEntryRow({ header, body, onClick }: { header: string | null; body: string; onClick: () => void }) {
  return (
    <button type="button" className="fiche-note-row" onClick={onClick} title="Voir la note">
      {header && <span className="fiche-note-head">{header}</span>}
      <span className="fiche-note-body">{body}</span>
    </button>
  )
}

export function AttachmentRow({
  attachment,
  onDelete,
  deleting = false,
}: {
  attachment: ProjectAttachmentResponse
  onDelete?: () => void
  deleting?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream text-muted">
        <Icon name="tag" size={15} />
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 flex-1 text-left"
        title={attachment.label || attachment.filename}
      >
        <div className="truncate text-[13px] font-medium text-text">{attachment.label || attachment.filename}</div>
        <div className="text-[10px] text-muted">
          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko · {formatDate(attachment.createdAt)}
        </div>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-rouille-tint hover:text-rouille disabled:opacity-60"
          title="Supprimer le document"
          aria-label="Supprimer le document"
        >
          {deleting ? '…' : <Icon name="trash" size={14} />}
        </button>
      )}
      {open && (
        <DocumentPreviewModal
          doc={{ url: attachmentDisplayUrl(attachment), filename: attachment.filename, mimeType: attachment.contentType, label: attachment.label }}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  )
}

export function DebriefCard({ debrief, onClick }: { debrief: DebriefResponse; onClick?: () => void }) {
  const financing = formatDebriefFinancing(debrief)
  const acompte =
    debrief.acompteAmount != null
      ? `acompte ${debrief.acompteAmount} €${debrief.acomptePercent != null ? ` (${debrief.acomptePercent} %)` : ''}`
      : null

  return (
    <article
      className={`fiche-debrief-card${onClick ? ' is-clickable' : ''}`}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } } : {})}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-text">
          Débrief · {DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}
        </span>
        <span className="shrink-0 text-[10px] font-medium text-faint">{formatDate(debrief.createdAt)}</span>
      </div>
      {debrief.notes && <p className="line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{debrief.notes}</p>}
      {debrief.objection && <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-faint">Objection : {debrief.objection}</p>}
      {(financing || acompte) && (
        <p className="mt-1 truncate text-[11px] font-semibold text-faint">
          {[financing, acompte].filter(Boolean).join(' · ')}
        </p>
      )}
      {onClick && <span className="fiche-debrief-more">Voir le détail →</span>}
    </article>
  )
}
