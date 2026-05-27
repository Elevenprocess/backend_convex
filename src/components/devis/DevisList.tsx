import { useState } from 'react';
import { markDevisSigned } from '../../lib/api';
import type { Devis } from '../../lib/types';

interface Props {
  devisList: Devis[];
  onChange: (d: Devis) => void;
}

export function DevisList({ devisList, onChange }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  async function sign(id: string) {
    setPending(id);
    try {
      const updated = await markDevisSigned(id);
      onChange(updated);
    } finally {
      setPending(null);
    }
  }
  if (devisList.length === 0)
    return <p className="text-sm text-stone-500">Aucun devis.</p>;
  return (
    <ul className="space-y-2">
      {devisList.map((d) => (
        <li key={d.id} className="border rounded p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-medium text-sm">
                {d.devisNumber ? `Devis n°${d.devisNumber}` : d.filename}
              </p>
              <p className="text-xs text-stone-500">
                {d.devisDate} · OCR: {d.ocrStatus} · Statut: {d.status}
              </p>
              {d.kits && (
                <p className="text-xs text-stone-700 mt-1">{d.kits}</p>
              )}
              <div className="text-xs mt-1 grid grid-cols-2 gap-x-3">
                {d.montantTtc && (
                  <span>
                    Total TTC : <strong>{d.montantTtc} €</strong>
                  </span>
                )}
                {d.primeAutoconsommation && (
                  <span>
                    Prime EDF : <strong>{d.primeAutoconsommation} €</strong>
                  </span>
                )}
                {d.montantNet && (
                  <span className="col-span-2 text-emerald-700">
                    Net client : <strong>{d.montantNet} €</strong>
                  </span>
                )}
              </div>
              {d.echeancier?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-stone-500">
                    Échéancier ({d.echeancier.length})
                  </summary>
                  <ul className="text-xs mt-1 space-y-0.5 pl-3">
                    {d.echeancier.map((e, i) => (
                      <li key={i}>
                        {e.phase ?? '—'} · {e.montant} € — {e.label}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            {d.status !== 'signe' && d.ocrStatus === 'done' && (
              <button
                type="button"
                disabled={pending === d.id}
                onClick={() => sign(d.id)}
                className="px-3 py-1 text-xs bg-emerald-700 text-white rounded disabled:opacity-50 shrink-0"
              >
                {pending === d.id ? '…' : 'Devis signé'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
