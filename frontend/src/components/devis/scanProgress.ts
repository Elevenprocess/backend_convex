// Progression de scan OCR SIMULÉE : l'OCR backend est un appel Gemini unique sans
// signal de progression granulaire, donc on simule une courbe d'ease-out côté client.
export const PROGRESS_CEIL = 92 // %, plafond tant que l'OCR n'est pas terminé
export const PROGRESS_TAU = 6000 // ms, constante de temps (montée rapide puis ralentit)

/** Progression lissée dans [0, PROGRESS_CEIL] pour un temps écoulé (ms). */
export function simulatedProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  const raw = PROGRESS_CEIL * (1 - Math.exp(-elapsedMs / PROGRESS_TAU))
  return Math.min(PROGRESS_CEIL, Math.round(raw))
}
