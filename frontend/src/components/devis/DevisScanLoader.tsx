import { useEffect, useRef, useState } from 'react'
import type { OcrStatus } from '../../lib/types'
import { simulatedProgress } from './scanProgress'

const TICK_MS = 250

/**
 * État « scan OCR en cours » affiché à la place du corps de carte tant que l'OCR
 * n'est pas terminé. Anneau de progression SVG avec un pourcentage SIMULÉ
 * (cf. scanProgress.ts). Style « air », tokens or/stone, sans dégradé.
 */
export function DevisScanLoader({ ocrStatus }: { ocrStatus: OcrStatus }) {
  const scanning = ocrStatus === 'pending' || ocrStatus === 'processing'
  const [tickPct, setTickPct] = useState(0)
  const startRef = useRef<number>(0)

  useEffect(() => {
    if (!scanning) return
    startRef.current = Date.now()
    const id = setInterval(() => {
      setTickPct(simulatedProgress(Date.now() - startRef.current))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [scanning])

  const pct = scanning ? tickPct : 100

  const R = 28
  const C = 2 * Math.PI * R
  const offset = C - (pct / 100) * C

  return (
    <div className="px-6 py-10 flex flex-col items-center justify-center gap-4 text-center">
      <div
        className="relative size-18"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Analyse OCR"
      >
        <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90" aria-hidden="true">
          <circle cx="36" cy="36" r={R} fill="none" className="stroke-stone-200" strokeWidth="6" />
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            className="stroke-or transition-[stroke-dashoffset] duration-200 ease-out"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-stone-900 tabular-nums">
          {pct}%
        </div>
      </div>
      <div className="text-sm font-bold text-stone-900">Analyse du devis en cours…</div>
      <div className="text-[12px] text-stone-500">L'IA extrait les informations du PDF.</div>
    </div>
  )
}
