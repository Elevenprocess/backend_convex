/**
 * Helpers purs de synchro calendrier GHL → Velora. Portage de
 * ghl-calendar.service.ts (NestJS) : mapping statut, notes synchronisées,
 * fenêtrage, bornage, patch identité lead, scoping commercial. Timestamps ms.
 */

import type { RdvStatus } from "../enums";
import type { GhlCalendarEvent } from "./calendarTypes";
import { splitContactName } from "./calendarNormalize";

/** Marqueur fonctionnel : les notes AUTO commencent par ce préfixe (purge au ré-armement). */
export const SYNCED_NOTES_PREFIX = "RDV synchronisé depuis GHL";
export const GHL_RDV_SYNC_MIN_MS = Date.parse("2026-01-01T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

export function mapGhlStatusToRdvStatus(status?: string): RdvStatus {
  const normalized = (status ?? "").toLowerCase();
  if (["cancelled", "canceled", "cancel", "annule", "annulé"].includes(normalized)) return "annule";
  if (["showed", "completed", "complete", "honore", "honoré"].includes(normalized)) return "honore";
  if (["noshow", "no_show", "no-show"].includes(normalized)) return "no_show";
  if (["rescheduled", "reporte", "reporté"].includes(normalized)) return "reporte";
  return "planifie";
}

export function buildSyncedRdvNotes(event: GhlCalendarEvent): string {
  return [
    SYNCED_NOTES_PREFIX,
    event.sector ? `Secteur : ${event.sector}` : null,
    event.commercialName ? `Commercial ECOI : ${event.commercialName}` : null,
    event.contactName ? `Prospect : ${event.contactName}` : null,
    event.contactPhone ? `Téléphone : ${event.contactPhone}` : null,
    event.contactEmail ? `Email : ${event.contactEmail}` : null,
    event.contactCity ? `Ville : ${event.contactCity}` : null,
    event.notes ? `Remarque : ${event.notes}` : null,
  ].filter(Boolean).join("\n");
}

// Fenêtres de ~30 j (parité splitDateRange NestJS : +29 j par fenêtre, fenêtre
// suivante à toMs+1 ms). La version calendaire NestJS (setDate +29) diverge
// d'une heure les jours de DST, mais la Réunion n'a pas de DST et GHL reçoit des
// timestamps ms : équivalence exacte pour notre usage.
export function splitDateRange(fromMs: number, toMs: number): Array<{ fromMs: number; toMs: number }> {
  const ranges: Array<{ fromMs: number; toMs: number }> = [];
  let cursor = fromMs;
  while (cursor <= toMs) {
    const rangeEnd = Math.min(cursor + 29 * DAY_MS, toMs);
    ranges.push({ fromMs: cursor, toMs: rangeEnd });
    cursor = rangeEnd + 1;
  }
  return ranges;
}

export function boundRdvEventsRange(fromMs: number, toMs: number): { fromMs: number; toMs: number } | null {
  const bounded = fromMs < GHL_RDV_SYNC_MIN_MS ? GHL_RDV_SYNC_MIN_MS : fromMs;
  if (toMs < GHL_RDV_SYNC_MIN_MS || bounded > toMs) return null;
  return { fromMs: bounded, toMs };
}

export function leadPatchFromGhlEvent(event: GhlCalendarEvent): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const nameParts = splitContactName(event.contactName);
  if (event.contactFirstName || nameParts.firstName) patch.firstName = event.contactFirstName ?? nameParts.firstName;
  if (event.contactLastName || nameParts.lastName) patch.lastName = event.contactLastName ?? nameParts.lastName;
  if (event.contactEmail) patch.email = event.contactEmail;
  if (event.contactPhone) patch.phone = event.contactPhone;
  if (event.address) patch.addressLine = event.address;
  if (event.contactCity) patch.city = event.contactCity;
  if (event.contactPostalCode) patch.postalCode = event.contactPostalCode;
  if (event.commercialId) patch.assignedToId = event.commercialId;
  patch.status = "qualifie";
  return patch;
}

export function scopeGhlEventsToCommercial<T extends { configured: boolean; events: GhlCalendarEvent[] }>(
  result: T,
  viewer?: { userId: string; role: string },
): T {
  if (viewer?.role !== "commercial") return result;
  return { ...result, events: result.events.filter((e) => e.commercialId === viewer.userId) };
}
