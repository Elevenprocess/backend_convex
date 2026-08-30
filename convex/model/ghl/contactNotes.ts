/**
 * Parsing PUR de la réponse GHL `GET /contacts/{id}/notes` → notes normalisées.
 * Tolérant aux variantes de forme (tableau à la racine ou sous `notes`, date en
 * ISO ou en ms, corps sous `body`/`note`).
 */
export type GhlNote = {
  id: string;
  body: string;
  ghlUserId?: string;
  dateAdded: number;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function when(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export function parseGhlNotes(raw: unknown, now: number = Date.now()): GhlNote[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { notes?: unknown }).notes)
      ? ((raw as { notes: unknown[] }).notes)
      : [];
  const out: GhlNote[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = str(o.id) ?? str(o._id);
    const body = (str(o.body) ?? str(o.note) ?? "").trim();
    if (!id || !body || seen.has(id)) continue;
    seen.add(id);
    const dateAdded = when(o.dateAdded) ?? when(o.createdAt) ?? when(o.dateUpdated) ?? now;
    const ghlUserId = str(o.userId) ?? str(o.createdBy);
    out.push({ id, body, dateAdded, ...(ghlUserId ? { ghlUserId } : {}) });
  }
  return out.sort((a, b) => b.dateAdded - a.dateAdded);
}

/**
 * Notes générées par Velora elle-même sur la fiche GHL — déjà visibles dans
 * Velora (commentaire setter du RDV, débrief) : inutile de les ré-importer.
 */
const VELORA_NOTE_PREFIXES = ["RDV ECOI", "DÉBRIEF RDV — Velora", "DEBRIEF RDV — Velora"];
export function isVeloraGeneratedNote(body: string): boolean {
  const head = body.trimStart();
  return VELORA_NOTE_PREFIXES.some((p) => head.startsWith(p));
}

/** Notes à garder = celles que Velora n'a pas écrites elle-même (id miroir débrief ou en-tête Velora). */
export function excludeMirroredNotes(notes: GhlNote[], mirroredIds: Iterable<string>): GhlNote[] {
  const skip = new Set(mirroredIds);
  return notes.filter((n) => !skip.has(n.id) && !isVeloraGeneratedNote(n.body));
}
