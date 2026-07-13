import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'
import { useCall } from '../../lib/call'

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function CallBubble() {
  const { active, minimized, leadName, startedAt, expand, endCall, minimize } = useCall()
  const [now, setNow] = useState(Date.now())
  const navigate = useNavigate()

  useEffect(() => {
    if (!active) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [active])

  if (!active || !minimized) return null

  const duration = startedAt ? formatDuration(now - startedAt) : '00:00'

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <div
        className="glass-card flex items-center gap-3 pl-3 pr-2 py-2 cursor-pointer hover:scale-[1.02] transition-transform"
        style={{ borderRadius: 999 }}
        onClick={() => {
          expand()
          navigate('/call/split')
        }}
      >
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-or flex items-center justify-center">
            <Icon name="phone" size={18} className="text-white" />
          </div>
          <span className="absolute top-0 right-0 w-3 h-3 bg-success rounded-full border-2 border-white animate-pulse"></span>
        </div>
        <div className="min-w-0">
          <div className="text-xs eyebrow">EN APPEL</div>
          <div className="text-sm font-bold truncate max-w-[140px]">{leadName ?? 'Appel'}</div>
        </div>
        <div className="font-mono text-sm font-semibold tabular-nums">{duration}</div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            minimize()
            endCall()
          }}
          className="w-9 h-9 rounded-full bg-rouille flex items-center justify-center text-white hover:opacity-90"
          title="Raccrocher"
        >
          <Icon name="phone-off" size={16} />
        </button>
      </div>
    </div>
  )
}
