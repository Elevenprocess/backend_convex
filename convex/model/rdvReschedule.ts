// Détection « reprogrammation » d'un RDV → ré-armement de la demande de débrief.
// Portage verbatim de rdv-reschedule.ts (NestJS), timestamps ms, undefined-based.
//
// Contexte : la demande de débrief vise les RDV (honore | result) &&
// !debriefFilledAt. Quand un RDV déjà clôturé est reprogrammé vers une date
// future, on ré-arme la demande pour qu'un nouveau débrief soit réclamé APRÈS
// la nouvelle date — sans toucher au débrief déjà saisi (table debriefs).

/** Statuts RDV considérés « clôturés » (le RDV a déjà eu lieu / est terminé). */
const CLOSED_RDV_STATUSES: ReadonlySet<string> = new Set(["honore", "no_show", "annule"]);

export type RescheduleRearmInput = {
  existingScheduledAt?: number;
  existingStatus: string;
  existingResult?: string;
  existingDebriefFilledAt?: number;
  newScheduledAt?: number;
  now: number;
};

export function shouldRearmDebriefOnReschedule(i: RescheduleRearmInput): boolean {
  if (i.newScheduledAt === undefined || i.existingScheduledAt === undefined) return false;
  const moved = i.newScheduledAt !== i.existingScheduledAt;
  const future = i.newScheduledAt > i.now;
  if (!moved || !future) return false;
  const wasClosed =
    i.existingDebriefFilledAt !== undefined ||
    i.existingResult !== undefined ||
    CLOSED_RDV_STATUSES.has(i.existingStatus);
  return wasClosed;
}

export function isReplanToFuture(input: {
  status?: string;
  result?: string;
  newScheduledAt?: number;
  now: number;
}): boolean {
  if (input.newScheduledAt === undefined) return false;
  const isReporte = input.status === "reporte" || input.result === "reporte";
  return isReporte && input.newScheduledAt > input.now;
}
