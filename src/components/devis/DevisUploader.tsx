import { useRef, useState } from 'react';
import { uploadDevis } from '../../lib/api';
import type { Devis } from '../../lib/types';

interface Props {
  leadId: string;
  rdvId?: string;
  onUploaded: (d: Devis) => void;
}

export function DevisUploader({ leadId, rdvId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handle(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const d = await uploadDevis(leadId, rdvId, file);
      onUploaded(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-dashed border-stone-300 rounded p-4 text-center">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="px-3 py-1.5 text-sm bg-stone-900 text-white rounded disabled:opacity-50"
      >
        {busy ? 'Upload…' : 'Uploader un devis Solteo (PDF)'}
      </button>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}
