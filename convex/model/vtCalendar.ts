/**
 * Helpers purs du calendrier VT et de l'assignation technicien.
 * Portage verbatim de vt-calendar.ts + vt-assignment-notify.ts (NestJS).
 */

/** Choisit la date de VT : vt_planifie en priorité, repli sur vt_attribuee. */
export function pickVtDate(dates: {
  vt_planifie: string | null;
  vt_attribuee: string | null;
}): string | null {
  return dates.vt_planifie ?? dates.vt_attribuee ?? null;
}

/**
 * Choisit l'heure de VT (format 'HH:MM') associée à la date que
 * pickVtDate aurait choisie : vt_planifie en priorité, repli sur vt_attribuee.
 */
export function pickVtHeure(heures: {
  vt_planifie: string | null;
  vt_attribuee: string | null;
}): string | null {
  return heures.vt_planifie ?? heures.vt_attribuee ?? null;
}

/** Vrai si `date` (YYYY-MM-DD) est dans la période [from,to] (bornes incluses, optionnelles). */
export function inPeriod(
  date: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  const d = date.slice(0, 10);
  if (from && d < from.slice(0, 10)) return false;
  if (to && d > to.slice(0, 10)) return false;
  return true;
}

/**
 * Ids présents dans nextIds mais pas previousIds. Notifie à l'ASSIGNATION
 * uniquement (jamais à la désassignation), et uniquement les nouveaux du set.
 */
export function newlyAddedTechs(previousIds: string[], nextIds: string[]): string[] {
  const prevSet = new Set(previousIds);
  return nextIds.filter((id) => !prevSet.has(id));
}
