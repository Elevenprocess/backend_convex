import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { buildApiUrl } from '../lib/api'
import {
  DebriefFormFields,
  EMPTY_DEBRIEF_FORM,
  isDebriefFormValid,
  type DebriefFormValue,
} from '../components/leads/project/DebriefFormFields'
import type { DebriefOutcome } from '../lib/types'

type LinkData = {
  client: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null
  commercialName: string | null
  rdv: { id: string; scheduledAt: string | null; status: string; alreadyDebriefed: boolean }
  debrief: DebriefFormValue | null
}

function formatRdv(iso: string | null): string {
  if (!iso) return 'date inconnue'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Reunion',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function DebriefMagicPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<LinkData | null>(null)
  const [form, setForm] = useState<DebriefFormValue>(EMPTY_DEBRIEF_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(buildApiUrl(`/debrief-link/${token}`))
      .then(async (r) => {
        if (!alive) return
        if (r.status === 410) throw new Error('Ce lien a expiré ou n’est plus valide.')
        if (r.status === 404) throw new Error('Rendez-vous introuvable.')
        if (!r.ok) throw new Error('Lien invalide.')
        const d: LinkData = await r.json()
        if (!alive) return
        setData(d)
        if (d.debrief) setForm({ ...EMPTY_DEBRIEF_FORM, ...d.debrief })
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Lien invalide.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [token])

  async function submit() {
    setSaveError(null)
    if (!isDebriefFormValid(form)) {
      setSaveError('Sélectionne un résultat et son motif.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(buildApiUrl(`/debrief-link/${token}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: form.outcome as DebriefOutcome,
          nonSaleReason: form.nonSaleReason || null,
          reflexionReason: form.reflexionReason || null,
          suiviReason: form.suiviReason || null,
          objection: form.objection.trim() || null,
          acceptanceFactors: form.acceptanceFactors,
          notes: form.notes.trim() || null,
          montantTotal: form.montantTotal.trim() || null,
          financingType: form.financingType || null,
          signedAt: form.signedAt || null,
          kits: form.kits.trim() || null,
        }),
      })
      if (res.status === 410) throw new Error('Ce lien a expiré.')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error((body && (body.message as string)) || 'Enregistrement échoué.')
      }
      setDone(true)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Enregistrement échoué.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-ivoire px-4">
        <div className="text-muted text-sm">Chargement…</div>
      </main>
    )
  }

  if (loadError || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-ivoire px-4">
        <div className="glass-card w-full max-w-md p-8 text-center">
          <div className="eyebrow text-or">VELORA</div>
          <h1 className="text-xl font-bold mt-2">Lien indisponible</h1>
          <p className="text-sm text-muted mt-3">{loadError ?? 'Lien invalide.'}</p>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-ivoire px-4">
        <div className="glass-card w-full max-w-md p-8 text-center">
          <div className="eyebrow text-or">VELORA</div>
          <h1 className="text-xl font-bold mt-2">Débrief enregistré ✅</h1>
          <p className="text-sm text-muted mt-3">Merci, ton débrief a bien été sauvegardé.</p>
        </div>
      </main>
    )
  }

  const c = data.client
  const clientName = [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim() || 'Client'

  return (
    <main className="min-h-screen bg-ivoire px-4 py-8 flex justify-center">
      <div className="w-full max-w-lg space-y-5">
        <div className="text-center">
          <div className="eyebrow text-or">VELORA</div>
          <h1 className="text-2xl font-bold mt-1">Débrief du rendez-vous</h1>
        </div>

        <div className="glass-card p-5 space-y-1">
          <div className="text-lg font-semibold">{clientName}</div>
          {c?.email && <div className="text-sm text-muted">📧 {c.email}</div>}
          {c?.phone && <div className="text-sm text-muted">📞 {c.phone}</div>}
          <div className="text-sm text-muted mt-2">🗓️ {formatRdv(data.rdv.scheduledAt)}</div>
          {data.commercialName && (
            <div className="text-xs text-faint mt-1">Commercial : {data.commercialName}</div>
          )}
          {data.rdv.alreadyDebriefed && (
            <div className="mt-3 rounded-xl bg-info-tint px-3 py-2 text-sm">
              Ce RDV a déjà un débrief — tu peux le mettre à jour ci-dessous.
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <DebriefFormFields value={form} onChange={setForm} />
        </div>

        {saveError && (
          <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{saveError}</div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={saving || !isDebriefFormValid(form)}
          className="btn-primary w-full py-3 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer le débrief'}
        </button>
      </div>
    </main>
  )
}
