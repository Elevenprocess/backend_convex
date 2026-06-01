import { useEffect, useRef, useState } from 'react';
import { getDevis, markDevisSigned, retryDevisOcr, updateDevis } from '../../lib/api';
import type {
  Devis,
  DevisCustomer,
  DevisEcheance,
  DevisLigne,
  DevisStatus,
  DevisVendor,
  OcrStatus,
  UpdateDevisPatch,
} from '../../lib/types';

interface Props {
  devisList: Devis[];
  onChange: (d: Devis) => void;
}

const STATUS_LABEL: Record<DevisStatus, string> = {
  brouillon: 'Brouillon',
  en_attente: 'En attente',
  signature_en_cours: 'Signature en cours',
  signe: 'Signé',
  perdu: 'Perdu',

};

const STATUS_TONE: Record<DevisStatus, string> = {
  brouillon: 'bg-stone-100 text-stone-700 border-stone-200',
  en_attente: 'bg-stone-100 text-stone-700 border-stone-200',
  signature_en_cours: 'bg-stone-100 text-stone-700 border-stone-200',
  signe: 'bg-stone-900 text-white border-stone-900',
  perdu: 'bg-stone-50 text-stone-400 border-stone-200 line-through',
};

const OCR_LABEL: Record<OcrStatus, string> = {
  pending: 'OCR en attente',
  processing: 'OCR en cours',
  done: 'OCR ok',
  failed: 'OCR échoué',
};

const PHASE_LABEL: Record<string, string> = {
  signature: 'À la signature',
  vt: 'Visite technique',
  dp: 'Déclaration préalable',
  pose_planif: 'Planification pose',
  pose: 'À la pose',
  mes: 'Mise en service',
  autre: 'Autre',
};

const FINANCING_LABEL: Record<string, string> = {
  comptant: 'Comptant',
  financement: 'Financement',
  financement_sans_apport: 'Financement sans apport',
  apport_financement: 'Apport + financement',
  paiement_10x: 'Paiement 10×',
};

const EDITABLE_STATUSES: DevisStatus[] = [
  'brouillon',
  'en_attente',
  'signature_en_cours',
  'perdu',
];

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function fmtEuro(v: string | number | null | undefined): string {
  const n = toNum(v);
  if (n === null) return '—';
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fullName(c: DevisCustomer | undefined): string {
  if (!c) return '';
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

type Draft = {
  devisNumber: string;
  devisDate: string;
  dateExpiration: string;
  delaiExecution: string;
  status: DevisStatus;
  puissanceKwc: string;
  nbPanneaux: string;
  kits: string;
  montantHt: string;
  montantTva: string;
  montantTtc: string;
  montantNet: string;
  financingType: string;
  primeAutoconsommation: string;
  primeTarifKwc: string;
  primeZone: string;
};

function toDraft(d: Devis): Draft {
  return {
    devisNumber: d.devisNumber ?? '',
    devisDate: d.devisDate ?? '',
    dateExpiration: d.dateExpiration ?? '',
    delaiExecution: d.delaiExecution ?? '',
    status: d.status,
    puissanceKwc: numToStr(d.puissanceKwc),
    nbPanneaux: d.nbPanneaux != null ? String(d.nbPanneaux) : '',
    kits: d.kits ?? '',
    montantHt: numToStr(d.montantHt),
    montantTva: numToStr(d.montantTva),
    montantTtc: numToStr(d.montantTtc),
    montantNet: numToStr(d.montantNet),
    financingType: d.financingType ?? '',
    primeAutoconsommation: numToStr(d.primeAutoconsommation),
    primeTarifKwc: numToStr(d.primeTarifKwc),
    primeZone: d.primeZone ?? '',
  };
}

function numToStr(v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  return String(v);
}

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

function buildPatch(d: Devis, draft: Draft): UpdateDevisPatch {
  const p: UpdateDevisPatch = {};
  if (draft.status !== d.status && draft.status !== 'signe') p.status = draft.status;
  p.devisNumber = strOrNull(draft.devisNumber);
  p.devisDate = strOrNull(draft.devisDate);
  p.dateExpiration = strOrNull(draft.dateExpiration);
  p.delaiExecution = strOrNull(draft.delaiExecution);
  p.kits = strOrNull(draft.kits);
  p.financingType = strOrNull(draft.financingType);
  p.primeZone = strOrNull(draft.primeZone);
  p.puissanceKwc = numOrNull(draft.puissanceKwc);
  p.nbPanneaux = numOrNull(draft.nbPanneaux);
  p.montantHt = numOrNull(draft.montantHt);
  p.montantTva = numOrNull(draft.montantTva);
  p.montantTtc = numOrNull(draft.montantTtc);
  p.montantNet = numOrNull(draft.montantNet);
  p.primeAutoconsommation = numOrNull(draft.primeAutoconsommation);
  p.primeTarifKwc = numOrNull(draft.primeTarifKwc);
  return p;
}

export function DevisList({ devisList, onChange }: Props) {
  if (devisList.length === 0) {
    return (
      <div className="border border-dashed border-stone-300 rounded p-6 text-center text-sm text-stone-500">
        Aucun devis.
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {devisList.map((d) => (
        <DevisCard key={d.id} devis={d} onChange={onChange} />
      ))}
    </ul>
  );
}

function DevisCard({
  devis,
  onChange,
}: {
  devis: Devis;
  onChange: (d: Devis) => void;
}) {
  // The OCR ("scan IA") runs asynchronously server-side and takes several
  // seconds. The parent only refetches once, right after upload, while the
  // status is still `pending` — so without polling the scanned data never
  // appears on its own and the user thinks "l'IA n'a pas scané".
  // We poll the devis here until OCR settles (done/failed), then sync the
  // parent. Lives in the shared card so every consumer is covered.
  const [d, setD] = useState<Devis>(devis);
  useEffect(() => {
    setD(devis);
  }, [devis]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (d.ocrStatus !== 'pending' && d.ocrStatus !== 'processing') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // ~100s safety cap, then give up silently
    const poll = async () => {
      attempts += 1;
      try {
        const fresh = await getDevis(d.id);
        if (cancelled) return;
        setD(fresh);
        if (fresh.ocrStatus === 'pending' || fresh.ocrStatus === 'processing') {
          if (attempts < MAX_ATTEMPTS) timer = setTimeout(() => void poll(), 2500);
        } else {
          onChangeRef.current(fresh); // OCR settled → bubble up to parent
        }
      } catch {
        if (!cancelled && attempts < MAX_ATTEMPTS) timer = setTimeout(() => void poll(), 4000);
      }
    };
    timer = setTimeout(() => void poll(), 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [d.id, d.ocrStatus]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(d));
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const locked = d.status === 'signe';
  const vendor: DevisVendor | undefined = d.extracted?.vendor;
  const customer: DevisCustomer | undefined = d.extracted?.customer;
  const fin = d.extracted?.financingDetails;
  const financingLabel = d.financingType ? (FINANCING_LABEL[d.financingType] ?? d.financingType) : null;

  function openEdit() {
    if (locked) return;
    setDraft(toDraft(d));
    setErr(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setErr(null);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const updated = await updateDevis(d.id, buildPatch(d, draft));
      onChange(updated);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function sign() {
    setSigning(true);
    setErr(null);
    try {
      const updated = await markDevisSigned(d.id);
      onChange(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSigning(false);
    }
  }

  async function retry() {
    setRetrying(true);
    setErr(null);
    try {
      const updated = await retryDevisOcr(d.id);
      onChange(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="border border-stone-300 rounded-md bg-white overflow-hidden">
      {/* ─── HERO : vendor (gauche) | identification devis (droite) ─── */}
      <header className="border-b border-stone-200 px-6 py-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="text-xs text-stone-700 leading-relaxed">
            <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
              Émetteur
            </div>
            <div className="font-bold text-sm text-stone-900">
              {vendor?.name ?? 'Solteo'}
            </div>
            {vendor?.addressLine && <div>{vendor.addressLine}</div>}
            {(vendor?.postalCode || vendor?.city) && (
              <div>
                {[vendor.postalCode, vendor.city].filter(Boolean).join(' ')}
              </div>
            )}
            {vendor?.phone && <div className="text-stone-500">{vendor.phone}</div>}
            {vendor?.email && <div className="text-stone-500">{vendor.email}</div>}
          </div>

          <div className="sm:text-right">
            <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
              Devis
            </div>
            {editing ? (
              <div className="space-y-2 sm:max-w-[240px] sm:ml-auto text-left">
                <Field
                  label="N°"
                  value={draft.devisNumber}
                  onChange={(v) => setDraft({ ...draft, devisNumber: v })}
                />
                <Field
                  label="Date"
                  type="date"
                  value={draft.devisDate}
                  onChange={(v) => setDraft({ ...draft, devisDate: v })}
                />
                <Field
                  label="Expiration"
                  type="date"
                  value={draft.dateExpiration}
                  onChange={(v) => setDraft({ ...draft, dateExpiration: v })}
                />
                <Field
                  label="Délai exécution"
                  value={draft.delaiExecution}
                  onChange={(v) => setDraft({ ...draft, delaiExecution: v })}
                />
                <SelectField
                  label="Statut"
                  value={draft.status}
                  options={EDITABLE_STATUSES.map((s) => ({
                    value: s,
                    label: STATUS_LABEL[s],
                  }))}
                  onChange={(v) =>
                    setDraft({ ...draft, status: v as DevisStatus })
                  }
                />
              </div>
            ) : (
              <div className="text-xs text-stone-700 leading-relaxed">
                <div className="font-bold text-base text-stone-900 tabular-nums">
                  {d.devisNumber ? `N° ${d.devisNumber}` : d.filename}
                </div>
                <div className="text-stone-500">
                  Émis le {fmtDate(d.devisDate)}
                </div>
                {d.dateExpiration && (
                  <div className="text-stone-500">
                    Valable jusqu'au {fmtDate(d.dateExpiration)}
                  </div>
                )}
                {d.delaiExecution && (
                  <div className="text-stone-500">
                    Délai : {d.delaiExecution}
                  </div>
                )}
                <div className="mt-2 inline-flex items-center gap-1.5 sm:justify-end">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_TONE[d.status]}`}
                  >
                    {STATUS_LABEL[d.status]}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-stone-200 bg-stone-50 text-stone-600">
                    {OCR_LABEL[d.ocrStatus]}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bloc client en bas du hero, comme sur un PDF */}
        <div className="mt-6 pt-5 border-t border-dashed border-stone-200">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
            Client
          </div>
          <div className="text-xs text-stone-700 leading-relaxed">
            <div className="font-bold text-sm text-stone-900">
              {fullName(customer) || '—'}
            </div>
            {customer?.addressLine && <div>{customer.addressLine}</div>}
            {(customer?.postalCode || customer?.city) && (
              <div>
                {[customer.postalCode, customer.city].filter(Boolean).join(' ')}
              </div>
            )}
            {(customer?.phone || customer?.email) && (
              <div className="text-stone-500">
                {[customer.phone, customer.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── SPECS : puissance · panneaux · kits ─── */}
      <section className="border-b border-stone-200 px-6 py-4">
        {editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label="Puissance (kWc)"
              value={draft.puissanceKwc}
              onChange={(v) => setDraft({ ...draft, puissanceKwc: v })}
            />
            <Field
              label="Nb panneaux"
              value={draft.nbPanneaux}
              onChange={(v) => setDraft({ ...draft, nbPanneaux: v })}
            />
            <Field
              label="Kits"
              value={draft.kits}
              onChange={(v) => setDraft({ ...draft, kits: v })}
            />
          </div>
        ) : (
          <div className="flex items-baseline gap-x-6 gap-y-1 flex-wrap text-xs">
            <Spec label="Puissance" value={d.puissanceKwc ? `${d.puissanceKwc} kWc` : '—'} />
            <Spec label="Panneaux" value={d.nbPanneaux != null ? String(d.nbPanneaux) : '—'} />
            <Spec label="Kits" value={d.kits ?? '—'} />
          </div>
        )}
      </section>

      {/* ─── LIGNES : tableau produits ─── */}
      {d.lignes && d.lignes.length > 0 && (
        <section className="border-b border-stone-200 px-6 py-4">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-3">
            Désignation
          </div>
          <LignesTable lignes={d.lignes} />
        </section>
      )}

      {/* ─── TOTAUX (alignés à droite comme sur un PDF) ─── */}
      <section className="border-b border-stone-200 px-6 py-4">
        {editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md sm:ml-auto">
            <Field
              label="Total HT"
              value={draft.montantHt}
              onChange={(v) => setDraft({ ...draft, montantHt: v })}
            />
            <Field
              label="TVA"
              value={draft.montantTva}
              onChange={(v) => setDraft({ ...draft, montantTva: v })}
            />
            <Field
              label="Total TTC"
              value={draft.montantTtc}
              onChange={(v) => setDraft({ ...draft, montantTtc: v })}
            />
            <Field
              label="Net client"
              value={draft.montantNet}
              onChange={(v) => setDraft({ ...draft, montantNet: v })}
            />
            <Field
              label="Prime auto­conso"
              value={draft.primeAutoconsommation}
              onChange={(v) =>
                setDraft({ ...draft, primeAutoconsommation: v })
              }
            />
            <Field
              label="Tarif (€/kWc)"
              value={draft.primeTarifKwc}
              onChange={(v) => setDraft({ ...draft, primeTarifKwc: v })}
            />
            <Field
              label="Zone prime"
              value={draft.primeZone}
              onChange={(v) => setDraft({ ...draft, primeZone: v })}
            />
          </div>
        ) : (
          <div className="max-w-sm sm:ml-auto text-xs tabular-nums">
            <TotalRow label="Total HT" value={fmtEuro(d.montantHt)} />
            <TotalRow label="TVA" value={fmtEuro(d.montantTva)} />
            <TotalRow label="Total TTC" value={fmtEuro(d.montantTtc)} bold />
            {d.primeAutoconsommation && (
              <TotalRow
                label={`Prime${d.primeTarifKwc ? ` (${d.primeTarifKwc} €/kWc${d.primeZone ? ' ' + d.primeZone : ''})` : ''}`}
                value={`− ${fmtEuro(d.primeAutoconsommation)}`}
                muted
              />
            )}
            {d.montantNet && (
              <div className="mt-2 pt-2 border-t-2 border-stone-900 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-wider font-bold text-stone-900">
                  Net client
                </span>
                <span className="text-base font-bold text-stone-900">
                  {fmtEuro(d.montantNet)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── ÉCHÉANCIER ─── */}
      {d.echeancier && d.echeancier.length > 0 && (
        <section className="border-b border-stone-200 px-6 py-4">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-3">
            Échéancier de paiement
          </div>
          <EcheancierTable echeancier={d.echeancier} />
        </section>
      )}

      {/* ─── FINANCEMENT ─── */}
      {(financingLabel || fin) && (
        <section className="border-b border-stone-200 px-6 py-4">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
            Financement
          </div>
          <div className="text-xs text-stone-700">
            <span className="font-bold text-stone-900">
              {financingLabel ?? '—'}
            </span>
            {fin && (
              <span className="text-stone-500">
                {fin.duree != null && ` · ${fin.duree} mois`}
                {fin.mensualite != null && ` · ${fmtEuro(fin.mensualite)}/mois`}
                {fin.taux != null && ` · ${fin.taux}%`}
                {fin.apport != null && ` · apport ${fmtEuro(fin.apport)}`}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ─── OCR error si présente ─── */}
      {d.ocrError && (
        <div className="px-6 py-3 bg-red-50 text-xs text-red-700 border-b border-red-100">
          OCR : {d.ocrError}
        </div>
      )}

      {err && (
        <div className="px-6 py-3 bg-red-50 text-xs text-red-700 border-b border-red-100">
          {err}
        </div>
      )}

      {/* ─── BARRE D'ACTIONS ─── */}
      <footer className="bg-stone-50 px-6 py-3 flex items-center justify-end gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-900 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-stone-900 text-white rounded disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </>
        ) : (
          <>
            {d.ocrStatus === 'failed' && (
              <button
                type="button"
                disabled={retrying}
                onClick={retry}
                className="px-3 py-1.5 text-xs border border-stone-300 text-stone-700 rounded disabled:opacity-50"
              >
                {retrying ? '…' : 'Relancer OCR'}
              </button>
            )}
            {d.status !== 'signe' && d.ocrStatus === 'done' && (
              <button
                type="button"
                disabled={signing}
                onClick={sign}
                className="px-3 py-1.5 text-xs border border-stone-300 text-stone-700 rounded disabled:opacity-50"
              >
                {signing ? '…' : 'Marquer signé'}
              </button>
            )}
            {!locked && (
              <button
                type="button"
                onClick={openEdit}
                className="px-4 py-1.5 text-xs bg-stone-900 text-white rounded"
              >
                Modifier
              </button>
            )}
          </>
        )}
      </footer>
    </li>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-stone-400 mr-1.5">
        {label}
      </span>
      <span className="font-bold text-stone-900">{value}</span>
    </div>
  );
}

function TotalRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className={muted ? 'text-stone-500' : 'text-stone-600'}>{label}</span>
      <span
        className={
          bold
            ? 'font-bold text-stone-900'
            : muted
              ? 'text-stone-500'
              : 'text-stone-900'
        }
      >
        {value}
      </span>
    </div>
  );
}

function LignesTable({ lignes }: { lignes: DevisLigne[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-stone-400 text-[10px] uppercase tracking-wider border-b border-stone-200">
          <th className="text-left font-medium py-1.5">Désignation</th>
          <th className="text-right font-medium py-1.5 w-12">Qté</th>
          <th className="text-right font-medium py-1.5 w-24">PU HT</th>
          <th className="text-right font-medium py-1.5 w-24">Total HT</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i} className="border-b border-stone-100 last:border-0">
            <td className="py-2 text-stone-800">
              <div className="font-medium">{l.designation}</div>
              {l.description && (
                <div className="text-[11px] text-stone-500 leading-snug mt-0.5">
                  {l.description}
                </div>
              )}
              {l.type && l.type !== 'autre' && (
                <span className="inline-block mt-0.5 text-[10px] text-stone-400 uppercase tracking-wider">
                  {l.type}
                </span>
              )}
            </td>
            <td className="py-2 text-right tabular-nums text-stone-700">
              {l.qty}
            </td>
            <td className="py-2 text-right tabular-nums text-stone-700">
              {fmtEuro(l.prixUnitaireHt)}
            </td>
            <td className="py-2 text-right tabular-nums text-stone-900 font-medium">
              {fmtEuro(l.totalHt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EcheancierTable({ echeancier }: { echeancier: DevisEcheance[] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {echeancier.map((e, i) => (
          <tr key={i} className="border-b border-stone-100 last:border-0">
            <td className="py-1.5 text-stone-700 w-44">
              {e.phase ? (PHASE_LABEL[e.phase] ?? e.phase) : '—'}
            </td>
            <td className="py-1.5 text-stone-600 truncate">{e.label}</td>
            <td className="py-1.5 text-right tabular-nums font-medium text-stone-900 w-28">
              {fmtEuro(e.montant)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date';
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-stone-300 rounded px-2.5 py-1.5 text-xs text-stone-900 focus:outline-none focus:border-stone-900"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-stone-300 rounded px-2.5 py-1.5 text-xs text-stone-900 focus:outline-none focus:border-stone-900"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
