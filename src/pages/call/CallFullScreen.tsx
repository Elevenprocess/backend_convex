import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Blobs, BLOB_PRESETS } from '../../components/shell/Blobs'
import { Icon } from '../../components/Icon'
import { Spinner, LoadingBlock } from '../../components/Spinner'
import { useLead, createCallLog } from '../../lib/hooks'
import { useCall } from '../../lib/call'
import {
  fullName,
  initials as leadInitials,
  CALL_RESULT_LABEL,
  STATUS_LABEL,
  STATUS_BADGE,
  type CallResult,
} from '../../lib/types'

function formatDuration(ms: number): string {
  const t = Math.floor(ms / 1000)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const RESULT_OPTIONS: CallResult[] = [
  'joint',
  'non_joint',
  'rappel_planifie',
  'rdv_pris',
  'refus',
  'injoignable',
  'messagerie',
]

export function CallFullScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { active, startedAt, startCall, endCall, minimize } = useCall()
  const { data: lead, loading, error } = useLead(id)
  const [now, setNow] = useState(Date.now())
  const [muted, setMuted] = useState(false)
  const [result, setResult] = useState<CallResult | ''>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  // Si on arrive directement sur /call/:id sans appel actif, prépare les notes.
  // Aucun appel Ringover n'est déclenché par le SaaS.
  useEffect(() => {
    if (!lead || active) return
    if (!lead.phone) {
      setCallError('Aucun numéro de téléphone sur cette fiche.')
      return
    }
    startCall(lead.id, fullName(lead))
    navigator.clipboard?.writeText(lead.phone).catch(() => undefined)
  }, [lead, active, startCall])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-cream">
        <LoadingBlock label="Chargement du lead…" />
      </div>
    )
  }

  if (error || !lead) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-cream">
        <div className="glass-card p-12 text-center">
          <p className="text-muted mb-4">{error ?? 'Lead introuvable'}</p>
          <button onClick={() => navigate('/leads')} className="btn-primary px-4 py-2 rounded-xl text-sm">
            Retour à la liste
          </button>
        </div>
      </div>
    )
  }

  if (callError) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-cream">
        <div className="glass-card p-12 text-center max-w-md">
          <p className="text-rouille font-semibold mb-2">Appel impossible</p>
          <p className="text-muted text-sm mb-4">{callError}</p>
          <button onClick={() => navigate(`/leads/${lead.id}`)} className="btn-primary px-4 py-2 rounded-xl text-sm">
            Retour à la fiche
          </button>
        </div>
      </div>
    )
  }

  const duration = startedAt ? formatDuration(now - startedAt) : '00:00'

  const handleMinimize = () => {
    minimize()
    navigate(-1)
  }

  const handleEnd = async () => {
    if (result) {
      try {
        setSaving(true)
        await createCallLog({
          leadId: lead.id,
          result,
          notes: notes || null,
        })
      } catch (e) {
        console.error('createCallLog failed', e)
      } finally {
        setSaving(false)
      }
    }
    endCall()
    navigate(`/leads/${lead.id}`)
  }

  return (
    <div className="relative w-full h-screen bg-cream overflow-hidden">
      <Blobs blobs={BLOB_PRESETS.login} />

      <div className="relative z-20 h-full p-12 flex flex-col items-center justify-between">
        {/* Top bar */}
        <div className="w-full flex justify-end">
          <button
            onClick={handleMinimize}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/70 backdrop-blur-xl border border-white/80 shadow-sm text-sm font-semibold text-text hover:bg-white/90 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
            Réduire
          </button>
        </div>

        {/* Center */}
        <div className="flex flex-col items-center text-center -mt-8">
          <div className="relative mb-8">
            <div className="absolute inset-0 border border-or/30 rounded-full scale-110 animate-ping" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-0 border border-or/20 rounded-full scale-125 animate-ping" style={{ animationDelay: '0.8s', animationDuration: '3s' }} />
            <div className="w-[200px] h-[200px] rounded-full bg-cuivre-tint flex items-center justify-center text-[64px] font-bold relative z-10">
              {leadInitials(lead)}
            </div>
          </div>

          <h1 className="text-[32px] font-bold mb-1">{fullName(lead)}</h1>
          <p className="text-sm text-muted mb-2 font-medium">{lead.phone ?? '—'}</p>
          {lead.city && (
            <div className="flex items-center gap-1.5 eyebrow mb-6">
              <Icon name="map-pin" size={14} />
              {lead.city}
            </div>
          )}

          <div className="font-mono text-[36px] font-bold mb-8 tabular-nums tracking-tight">{duration}</div>

          {/* Post-call form */}
          <div className="glass-card w-[540px] p-5 text-left border border-white/50">
            <div className="text-[11px] font-bold tracking-widest uppercase text-faint mb-3">Résultat de l'appel</div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={result}
                onChange={(e) => setResult(e.target.value as CallResult | '')}
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm"
              >
                <option value="">— Sélectionne —</option>
                {RESULT_OPTIONS.map((r) => (
                  <option key={r} value={r}>{CALL_RESULT_LABEL[r]}</option>
                ))}
              </select>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optionnel)…"
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm h-10 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6">
          <CallButton onClick={() => setMuted(!muted)} active={muted}>
            <Icon name={muted ? 'mic-off' : 'mic'} size={24} />
          </CallButton>
          <CallButton><Icon name="grid" size={24} /></CallButton>
          <CallButton><Icon name="video" size={24} /></CallButton>
          <CallButton><Icon name="plus" size={24} /></CallButton>
          <CallButton><Icon name="pause" size={24} /></CallButton>
          <button
            onClick={handleEnd}
            disabled={saving}
            className="w-[72px] h-[72px] rounded-full bg-rouille text-white flex items-center justify-center hover:scale-105 transition-transform shadow-lg disabled:opacity-50"
            title="Raccrocher"
          >
            {saving ? <Spinner size={24} stroke={3} color="white" /> : <Icon name="phone-off" size={28} />}
          </button>
        </div>

        {/* Lead context card */}
        <div className="absolute top-12 right-12 w-[320px] glass-card p-6 border-white/40">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-cuivre-tint flex items-center justify-center font-bold text-sm">{leadInitials(lead)}</div>
            <div>
              <h3 className="font-bold text-sm">{fullName(lead)}</h3>
              <span className={`status-badge ${STATUS_BADGE[lead.status]} mt-1 inline-block`}>{STATUS_LABEL[lead.status]}</span>
            </div>
          </div>

          <div className="space-y-4">
            <Field label="STATUT" value={STATUS_LABEL[lead.status]} />
            <Field label="VILLE" value={lead.city ?? '—'} />
            <Field label="DERNIER CONTACT" value={lastContactLabel(lead.joursSansContact)} />
          </div>
        </div>
      </div>
    </div>
  )
}

function CallButton({ children, onClick, active = false }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all ${
        active ? 'bg-text text-white border-text' : 'bg-white border-line text-text hover:bg-cream'
      }`}
    >
      {children}
    </button>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-faint uppercase tracking-widest block mb-1">{label}</label>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

function lastContactLabel(j: number | null): string {
  if (j === null) return 'Jamais'
  if (j === 0) return "Aujourd'hui"
  if (j === 1) return 'Hier'
  return `Il y a ${j}j`
}
