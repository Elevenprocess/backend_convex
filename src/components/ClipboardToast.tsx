import { useEffect, useState } from 'react'
import { CLIPBOARD_TOAST_EVENT, type ClipboardToastPayload } from '../lib/clipboardToast'

const DEFAULT_DURATION = 5000

type ToastState = {
  id: number
  message: string
  durationMs: number
}

export function ClipboardToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<ClipboardToastPayload>).detail ?? {}
      setToast({
        id: Date.now(),
        message: detail.message ?? 'Numéro copié',
        durationMs: detail.durationMs ?? DEFAULT_DURATION,
      })
    }

    window.addEventListener(CLIPBOARD_TOAST_EVENT, onToast)
    return () => window.removeEventListener(CLIPBOARD_TOAST_EVENT, onToast)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), toast.durationMs)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null

  return (
    <div className="clipboard-toast" role="status" aria-live="polite">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-full bg-success-tint text-success flex items-center justify-center font-bold">✓</div>
        <div>
          <div className="text-sm font-bold text-text">{toast.message}</div>
          <div className="text-xs text-muted">Colle-le dans Ringover pour appeler manuellement.</div>
        </div>
      </div>
      <div className="clipboard-toast-track">
        <div key={toast.id} className="clipboard-toast-gauge" style={{ animationDuration: `${toast.durationMs}ms` }} />
      </div>
    </div>
  )
}
