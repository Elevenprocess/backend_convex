export const CLIPBOARD_TOAST_EVENT = 'ecoi:clipboard-toast'

export type ClipboardToastPayload = {
  message?: string
  durationMs?: number
}

export function notifyClipboardCopied(payload: ClipboardToastPayload = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ClipboardToastPayload>(CLIPBOARD_TOAST_EVENT, {
    detail: {
      message: payload.message ?? 'Numéro copié',
      durationMs: payload.durationMs ?? 5000,
    },
  }))
}
