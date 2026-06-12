// Journal de notes stocké dans le champ texte unique `project.notes` (pas de
// table dédiée). Chaque entrée est préfixée d'un en-tête `[JJ/MM/AAAA HH:mm — Auteur]`
// et les entrées sont séparées par un caractère de contrôle (Record Separator, U+241E)
// improbable dans une saisie humaine. Les notes héritées (texte libre sans
// séparateur) sont traitées comme une seule entrée sans en-tête.

const ENTRY_SEP = '\n␞\n'
const HEADER_RE = /^\[([^\]]+)\]\n?([\s\S]*)$/

export type NoteEntry = {
  /** Contenu de l'en-tête entre crochets (date + auteur), ou null si note héritée. */
  header: string | null
  /** Texte de la note (sans l'en-tête). */
  body: string
  /** Bloc brut complet (en-tête + corps), pour l'aperçu. */
  raw: string
}

export function parseNotesJournal(notes: string | null | undefined): NoteEntry[] {
  if (!notes || !notes.trim()) return []
  return notes
    .split(ENTRY_SEP)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(HEADER_RE)
      if (m) return { header: m[1].trim(), body: m[2].trim(), raw: chunk }
      return { header: null, body: chunk, raw: chunk }
    })
}

function formatHeaderDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${d}/${mo}/${y} ${h}:${mi}`
}

/** Ajoute une note en tête du journal et renvoie la nouvelle valeur de `project.notes`. */
export function prependNote(
  existing: string | null | undefined,
  author: string,
  text: string,
  now: Date = new Date(),
): string {
  const entry = `[${formatHeaderDate(now)} — ${author.trim() || 'Inconnu'}]\n${text.trim()}`
  const prev = (existing ?? '').trim()
  return prev ? `${entry}${ENTRY_SEP}${prev}` : entry
}
