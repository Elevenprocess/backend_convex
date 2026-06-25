// src/pages/technicien/FicheInterventionVT.tsx
//
// ⚠️  SCAFFOLD — disposition finale à valider avec le modèle de Thierry (réunion
// post-25/06). Ce fichier sera remplacé par la mise en page définitive une fois
// le template reçu. Les zones vides (checklist, notes, signature) sont
// intentionnellement laissées en blanc pour remplissage terrain.
//

import { useParams } from 'react-router-dom'
import { useClients, useSubsteps } from '../../lib/hooks'
import { LoadingBlock } from '../../components/Spinner'
import type { ClientResponse, SubstepResponse } from '../../lib/types'

export function FicheInterventionVT() {
  const { clientId } = useParams<{ clientId: string }>()

  // ClientResponse gives us lead name, city, phone, techniciens, steps.vt.
  // useClients does not accept an id filter — fetch all then find client-side.
  const { data: clients, loading: clientLoading } = useClients(clientId ? {} : undefined)

  // SubstepResponse gives us VT date, heure, notes, responsableId.
  const { data: substeps, loading: substepsLoading } = useSubsteps(
    clientId ? { clientId } : undefined,
  )

  const client: ClientResponse | null =
    clients?.find((c) => c.id === clientId) ?? null

  const vtSubstep: SubstepResponse | null =
    substeps?.find((s) => s.phase === 'vt' && s.key === 'vt_planifie') ??
    substeps?.find((s) => s.phase === 'vt') ??
    null

  if (clientLoading || substepsLoading) {
    return <LoadingBlock label="Chargement de la fiche…" />
  }

  if (!client) {
    return (
      <div className="p-8 text-sm text-rouille">
        Dossier introuvable (clientId : {clientId ?? '—'}).
      </div>
    )
  }

  return <FicheContent client={client} vtSubstep={vtSubstep} />
}

// ─────────────────────────────────────────────────────────────────────────────
// FicheContent — rendu A4 portrait
// ─────────────────────────────────────────────────────────────────────────────
function FicheContent({
  client,
  vtSubstep,
}: {
  client: ClientResponse
  vtSubstep: SubstepResponse | null
}) {
  const handlePrint = () => window.print()

  // ── Derived data ──────────────────────────────────────────────────────────
  const clientName = client.lead.fullName ?? '—'
  const cityValue = client.lead.city ?? '—'
  // NOTE: full addressLine not available on ClientResponse.lead — only city.
  // The complete address lives on ProjectResponse (requires separate fetch).
  // Shown as placeholder until Thierry confirms the template.

  const vtDate = vtSubstep?.dateRealisee ?? null
  const vtHeure = vtSubstep?.heure ?? null
  const techniciens =
    client.techniciens.length > 0
      ? client.techniciens.map((t) => t.name).join(', ')
      : '—'
  // NOTE: devis fields (puissanceKwc, nbPanneaux, kits) live on DevisResponse,
  // not on ClientResponse. ProjectDetailResponse includes them but requires an
  // additional fetch (useProjectsByLead / useProjectDetail). Shown as blank
  // placeholder fields pending Thierry's template — wire up after confirmation.

  return (
    <>
      {/* Inject @page CSS for A4 print output */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm 15mm;
          }
        }
      `}</style>

      {/* ── Screen-only action bar (hidden when printing) ────────────────── */}
      <div className="print:hidden flex items-center gap-3 p-4 bg-white border-b border-line-soft">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="text-sm text-muted hover:text-text px-2 py-1 rounded hover:bg-black/5"
        >
          ← Retour
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="ml-auto flex items-center gap-2 bg-cuivre text-white text-sm font-semibold px-4 py-2 rounded hover:opacity-90 transition-opacity"
        >
          🖨 Imprimer la fiche VT
        </button>
      </div>

      {/* ── A4 fiche (always visible on screen, rendered when printing) ──── */}
      {/*
        Strategy: on screen, centred white sheet with max-w. On print, full
        page with @page margins handled by the browser. The wrapper is always
        rendered — no print:block toggle needed. App chrome (nav/topbar) is
        absent because FicheInterventionVT does NOT use AppShell.
      */}
      <main
        className={[
          // Screen: centred A4-like sheet
          'mx-auto my-6 w-full max-w-[210mm] min-h-[297mm]',
          'bg-white shadow-lg px-10 py-8',
          // Print: remove shadow/margin, fill page
          'print:shadow-none print:my-0 print:mx-0 print:max-w-none',
          'print:px-0 print:py-0',
        ].join(' ')}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-0.5">
                VELORA — Fiche d'intervention
              </p>
              <h1 className="text-2xl font-black text-gray-900">
                Visite Technique (VT)
              </h1>
            </div>
            <div className="text-right text-xs text-gray-500">
              <p>Date d'impression&nbsp;: {new Date().toLocaleDateString('fr-FR')}</p>
              <p className="mt-0.5 italic text-[10px] text-gray-400">
                Référence dossier : {client.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </div>
        </header>

        {/* ── Section : Informations client ────────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>1. Client &amp; Adresse d'installation</SectionTitle>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-3">
            <Field label="Nom du client" value={clientName} />
            <Field label="Téléphone" value={client.lead.phone ?? '—'} />
            <Field
              label="Adresse (ville)"
              value={cityValue}
              note="Adresse complète : voir projet / devis"
            />
            <Field
              label="Adresse complète"
              value=""
              placeholder
              note="[À compléter sur site ou depuis la fiche projet]"
            />
          </div>
        </section>

        {/* ── Section : Planification VT ───────────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>2. Planification de la VT</SectionTitle>
          <div className="grid grid-cols-3 gap-x-8 gap-y-3 mt-3">
            <Field
              label="Date prévue"
              value={vtDate ? new Date(vtDate).toLocaleDateString('fr-FR') : ''}
              placeholder={!vtDate}
            />
            <Field
              label="Heure"
              value={vtHeure ?? ''}
              placeholder={!vtHeure}
            />
            <Field label="Technicien(s)" value={techniciens} />
          </div>
        </section>

        {/* ── Section : Informations installation (devis) ──────────────── */}
        <section className="mb-6">
          <SectionTitle>3. Caractéristiques de l'installation</SectionTitle>
          {/* NOTE: puissanceKwc, nbPanneaux, kits proviennent de DevisResponse
              (non disponible sur ClientResponse). Champs volontairement vides
              en attente du template Thierry + fetch projet. */}
          <div className="grid grid-cols-3 gap-x-8 gap-y-3 mt-3">
            <Field label="Puissance (kWc)" value="" placeholder note="Depuis devis — à câbler" />
            <Field label="Nb panneaux" value="" placeholder note="Depuis devis — à câbler" />
            <Field label="Kit / Onduleur" value="" placeholder note="Depuis devis — à câbler" />
          </div>
        </section>

        {/* ── Section : Observations terrain ──────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>4. Observations &amp; Relevés terrain</SectionTitle>
          <BlankZone lines={6} label="Zone de saisie libre — observations du technicien" />
        </section>

        {/* ── Section : Checklist VT ───────────────────────────────────── */}
        <section className="mb-6">
          <SectionTitle>5. Checklist VT (à cocher sur site)</SectionTitle>
          {/* ⚠️ Liste générique — à remplacer par le modèle de Thierry */}
          <ul className="mt-3 space-y-2">
            {CHECKLIST_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 inline-block w-4 h-4 border-2 border-gray-700 rounded-sm shrink-0" aria-hidden />
                <span className="text-sm text-gray-800">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Section : Signature client ───────────────────────────────── */}
        <section className="mt-auto">
          <SectionTitle>6. Signature &amp; Validation</SectionTitle>
          <div className="grid grid-cols-2 gap-8 mt-4">
            <SignatureBox label="Signature du client" />
            <SignatureBox label="Signature du technicien" />
          </div>
          <p className="mt-4 text-[10px] text-gray-400 text-center italic">
            En signant, le client confirme la visite technique réalisée à la date indiquée.
          </p>
        </section>
      </main>
    </>
  )
}

// ── Checklist générique — sera remplacée par le template Thierry ──────────────
const CHECKLIST_ITEMS = [
  'Accès toiture vérifié et sécurisé',
  'Type de couverture identifié (tuiles / ardoise / bac acier / autre)',
  'Surface disponible mesurée',
  'Orientation et inclinaison relevées',
  'Ombrage potentiel évalué (cheminée, arbres, voisinage)',
  'Tableau électrique inspecté (capacité disjoncteur, mise à la terre)',
  'Emplacement onduleur défini',
  'Photos prises (toiture, tableau, compteur)',
  'Accord client pour les travaux confirmé verbalement',
]

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-500 border-b border-gray-200 pb-1">
      {children}
    </h2>
  )
}

function Field({
  label,
  value,
  placeholder,
  note,
}: {
  label: string
  value: string
  placeholder?: boolean
  note?: string
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
      <p
        className={`text-sm font-semibold min-h-[22px] border-b border-gray-300 pb-0.5 ${
          placeholder || !value ? 'text-gray-300 italic' : 'text-gray-900'
        }`}
      >
        {value || (note ?? '—')}
      </p>
    </div>
  )
}

function BlankZone({ lines, label }: { lines: number; label: string }) {
  return (
    <div
      className="mt-2 border border-gray-300 rounded"
      style={{ minHeight: `${lines * 1.6}rem` }}
      aria-label={label}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="border-b border-gray-100 mx-3" style={{ height: '1.6rem' }} />
      ))}
    </div>
  )
}

function SignatureBox({ label }: { label: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      <div className="border border-gray-300 rounded h-20" aria-label={label} />
      <p className="text-[10px] text-gray-400 mt-1">Nom &amp; Prénom : ___________________________</p>
      <p className="text-[10px] text-gray-400">Date : ___________________________</p>
    </div>
  )
}
