// Les fichiers uploadés depuis macOS arrivent en Unicode décomposé (NFD) : « é »
// = « e » + accent combinant. À l'affichage ça donne des artefacts du genre
// « ArreÌteÌ » au lieu de « Arrêté ». On recompose en NFC pour l'affichage
// (on ne touche pas à la valeur stockée).
export function displayFilename(name: string | null | undefined): string {
  if (!name) return ''
  try {
    return name.normalize('NFC')
  } catch {
    return name
  }
}
