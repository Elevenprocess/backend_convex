import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { buildPublicLinkUrl } from '../lib/api'
import {
  PublicDebriefWizard,
  PublicDebriefHistory,
  type PublicDebriefPayload,
  type ExistingDebrief,
} from '../components/leads/debrief/PublicDebriefWizard'

type LinkData = {
  client: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null
  commercialName: string | null
  rdv: { id: string; scheduledAt: string | null; status: string; alreadyDebriefed: boolean }
  debrief: ExistingDebrief | null
}

export function DebriefMagicPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<LinkData | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(buildPublicLinkUrl(`/debrief-link/${token}`))
      .then(async (r) => {
        if (r.status === 410) throw new Error('Ce lien a expiré ou n’est plus valide.')
        if (r.status === 404) throw new Error('Rendez-vous introuvable.')
        if (!r.ok) throw new Error('Lien invalide.')
        return (await r.json()) as LinkData
      })
      .then((d) => { if (alive) setData(d) })
      .catch((e: unknown) => { if (alive) setLoadError(e instanceof Error ? e.message : 'Lien invalide.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  async function submit(payload: PublicDebriefPayload) {
    const res = await fetch(buildPublicLinkUrl(`/debrief-link/${token}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 410) throw new Error('Ce lien a expiré.')
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error((body && (body.message as string)) || 'Enregistrement échoué.')
    }
  }

  async function reschedule(scheduledAt: string) {
    const res = await fetch(buildPublicLinkUrl(`/debrief-link/${token}/reschedule`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt }),
    })
    if (res.status === 410) throw new Error('Ce lien a expiré.')
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error((body && (body.message as string)) || 'Report échoué.')
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
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-sm">
          <div className="eyebrow text-or-dark">VELORA</div>
          <h1 className="mt-2 text-xl font-black text-text">Lien indisponible</h1>
          <p className="mt-3 text-sm text-muted">{loadError ?? 'Lien invalide.'}</p>
        </div>
      </main>
    )
  }

  // Débrief déjà envoyé → historique en lecture seule (le lien est permanent,
  // le commercial le rouvre pour vérifier que son débrief est bien parti).
  // Une re-soumission serait de toute façon ignorée côté serveur.
  const alreadySent = data.rdv.alreadyDebriefed && data.debrief

  return (
    <main className="min-h-screen bg-ivoire px-4 py-8 flex justify-center">
      <div className="w-full max-w-lg">
        {alreadySent ? (
          <PublicDebriefHistory
            client={data.client}
            commercialName={data.commercialName}
            rdv={data.rdv}
            debrief={data.debrief!}
          />
        ) : (
          <PublicDebriefWizard
            client={data.client}
            commercialName={data.commercialName}
            rdv={data.rdv}
            onSubmit={submit}
            onReschedule={reschedule}
          />
        )}
      </div>
    </main>
  )
}
