import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { SplitPanel } from '../../components/SplitPanel'
import { Icon } from '../../components/Icon'
import { Spinner } from '../../components/Spinner'
import { useLead, useLeads, useUsers, createCallLog } from '../../lib/hooks'
import { useCall } from '../../lib/call'
import {
  fullName,
  initials as leadInitials,
  type LeadResponse,
  type UserResponse,
} from '../../lib/types'

function formatDuration(ms: number): string {
  const t = Math.floor(ms / 1000)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function CallSplit() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const manualNumber = searchParams.get('number')?.trim() ?? ''
  const { active, startedAt, leadId, result, notes, startCall, endCall, minimize } = useCall()
  const { data: leads } = useLeads({ limit: 1500 })
  const { data: users } = useUsers()
  const { data: leadFromHook } = useLead(leadId && leadId !== 'manual' ? leadId : undefined)
  const [now, setNow] = useState(Date.now())
  const [muted, setMuted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [callError, setCallError] = useState<string | null>(null)

  // Prépare l'écran de notes. L'appel reste manuel dans Ringover: aucune API Ringover n'est appelée ici.
  useEffect(() => {
    if (active) return
    if (manualNumber) {
      startCall('manual', manualNumber)
      navigator.clipboard?.writeText(manualNumber).catch(() => undefined)
      return
    }
    if (leads && leads.length > 0) {
      const demo = leads[0]
      if (!demo.phone) {
        setCallError('Aucun numéro sur le premier lead.')
        return
      }
      startCall(demo.id, fullName(demo))
      navigator.clipboard?.writeText(demo.phone).catch(() => undefined)
    }
  }, [manualNumber, active, leads, startCall])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const lead: LeadResponse | null = leadFromHook ?? (manualNumber ? null : leads?.[0] ?? null)
  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])
  const displayName = lead ? fullName(lead) : 'Appel manuel'
  const displayPhone = lead?.phone ?? manualNumber
  const duration = startedAt ? formatDuration(now - startedAt) : '00:00'

  const handleHangup = async () => {
    if (!lead) {
      endCall()
      navigate('/leads')
      return
    }
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

  if (!lead && !manualNumber) {
    return (
      <AppShell>
        <Topbar eyebrow="APPEL · SPLIT" title="Aucun lead disponible" />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-faint text-sm">Aucun lead à appeler.</div>
        </main>
      </AppShell>
    )
  }

  if (callError) {
    return (
      <AppShell>
        <Topbar eyebrow="APPEL · ERREUR" title="Appel impossible" />
        <main className="flex-grow flex items-center justify-center">
          <div className="glass-card p-8 text-center max-w-md">
            <p className="text-rouille font-semibold mb-2">{callError}</p>
            <button
              onClick={() => navigate(lead ? `/leads/${lead.id}` : '/dialer')}
              className="btn-primary px-4 py-2 rounded-xl text-sm mt-2"
            >
              Retour
            </button>
          </div>
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Topbar
        eyebrow="APPEL · SPLIT"
        title={`En appel — ${displayName}`}
      />
      <div className="flex flex-grow overflow-hidden">
        {/* Main: call panel — avatar + timer + controls only */}
        <main className="flex-grow flex flex-col items-center justify-center p-12 min-w-0 relative">
          <button
            onClick={() => {
              minimize()
              if (lead) navigate(`/leads/${lead.id}`)
              else navigate(-1)
            }}
            className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 backdrop-blur-xl border border-white/80 shadow-sm text-xs font-semibold text-text hover:bg-white/90"
            title="Réduire l'appel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
            Réduire
          </button>

          <div className="relative mb-6">
            <div className="absolute inset-0 border border-or/30 rounded-full scale-110 animate-ping" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-0 border border-or/20 rounded-full scale-125 animate-ping" style={{ animationDelay: '0.8s', animationDuration: '3s' }} />
            <div className="w-[160px] h-[160px] rounded-full bg-cuivre-tint flex items-center justify-center text-[48px] font-bold relative z-10">
              {lead ? leadInitials(lead) : '☎'}
            </div>
          </div>

          <h1 className="text-2xl font-bold">{displayName}</h1>
          <p className="text-sm text-muted">{displayPhone || '—'}</p>
          <div className="font-mono text-3xl font-bold mt-4 mb-8 tabular-nums">{duration}</div>

          <p className="text-xs text-faint mb-8 max-w-xs text-center">
            Prends tes notes et logge le résultat dans le panneau de droite. Tout sera enregistré au raccrochage.
          </p>

          <div className="flex items-center gap-3">
            <ControlBtn onClick={() => setMuted(!muted)} active={muted}>
              <Icon name={muted ? 'mic-off' : 'mic'} size={18} />
            </ControlBtn>
            <ControlBtn><Icon name="grid" size={18} /></ControlBtn>
            <ControlBtn><Icon name="pause" size={18} /></ControlBtn>
            <button
              onClick={handleHangup}
              disabled={saving}
              className="w-14 h-14 rounded-full bg-rouille text-white flex items-center justify-center hover:scale-105 transition-transform shadow-lg disabled:opacity-50"
              title="Raccrocher"
            >
              {saving ? <Spinner size={20} stroke={3} color="white" /> : <Icon name="phone-off" size={22} />}
            </button>
          </div>
        </main>

        {lead ? <SplitPanel lead={lead} userMap={userMap} defaultTab="notes" /> : (
          <aside className="w-[420px] border-l border-line bg-white/30 backdrop-blur-md p-6">
            <div className="glass-card p-5">
              <span className="eyebrow">APPEL MANUEL</span>
              <h3 className="font-bold mt-2">Aucun lead associé</h3>
              <p className="text-sm text-muted mt-2">Le numéro composé n'est pas encore lié à une fiche.</p>
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  )
}

function ControlBtn({ children, onClick, active = false }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center border transition-colors ${
        active ? 'bg-text text-white border-text' : 'bg-white text-text border-line hover:bg-cream'
      }`}
    >
      {children}
    </button>
  )
}
