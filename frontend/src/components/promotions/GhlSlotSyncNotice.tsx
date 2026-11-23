import { useState } from 'react'
import { confirmOfficeSlot, humanizeError } from '../../lib/hooks'
import { ghlSlotTexts } from '../../lib/promotionSlots'
import type { LeadResponse } from '../../lib/types'

type SyncLead = Pick<LeadResponse, 'id' | 'promotionSlotDay' | 'promotionSlotHour' | 'promotionGhlSync'>

/**
 * RDV au bureau qualifié mais pas (encore) transmis à GHL : message + bouton
 * « Renvoyer à GHL », visible sur la fiche tant que GHL n'a pas confirmé
 * (même après un rafraîchissement ou en rouvrant le prospect).
 */
export function GhlSlotSyncNotice({ lead, send = confirmOfficeSlot }: {
  lead: SyncLead
  send?: (input: { leadId: string; day: string; hour: number }) => Promise<unknown>
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const sync = lead.promotionGhlSync
  const day = lead.promotionSlotDay
  const hour = lead.promotionSlotHour
  if (!sync || sync.status === 'ok' || !day || hour == null) return null
  if (done) return <div className="mt-2 rounded-[12px] border border-success/30 bg-success-tint px-3 py-2 text-xs font-semibold text-success">Transmis à GHL : Présence confirmée.</div>

  async function resend() {
    setSending(true)
    setError(null)
    try {
      await send({ leadId: lead.id, day: day as string, hour: hour as number })
      setDone(true)
    } catch (e) {
      setError(humanizeError(e, 'Envoi à GHL impossible'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-[12px] border border-rouille/30 bg-rouille-tint px-3 py-2">
      <div className="text-xs font-semibold text-rouille">
        RDV au bureau {ghlSlotTexts(day, hour).creneau} : pas encore transmis à GHL.
      </div>
      {(error ?? sync.error) && <div className="text-[11px] text-rouille/80">{error ?? sync.error}</div>}
      <button type="button" onClick={resend} disabled={sending}
        className="rounded-full bg-text px-3 py-1 text-xs font-semibold text-white disabled:opacity-60">
        {sending ? 'Envoi…' : 'Renvoyer à GHL'}
      </button>
    </div>
  )
}
