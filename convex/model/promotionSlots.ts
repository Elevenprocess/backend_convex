// Créneaux d'arrivée au bureau pendant une promo (Mario 23/11, alignés sur le
// mail S1) : jeudi, vendredi et samedi de 8 h à 18 h, dimanche de 8 h à 13 h
// (dernière arrivée 12 h), tranches d'une heure, heure de la Réunion. Miroir côté front : frontend/src/lib/promotionSlots.ts.

const REUNION_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

/** Jour de la semaine (0 = dimanche) → [première heure, heure de fin exclue]. */
export const OFFICE_SLOT_HOURS: Readonly<Record<number, readonly [number, number]>> = {
  4: [8, 18],
  5: [8, 18],
  6: [8, 18],
  0: [8, 13],
};

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function reunionToday(now: number): string {
  return new Date(now + REUNION_OFFSET_MS).toISOString().slice(0, 10);
}

/** Jeudis, vendredis, samedis et dimanches de la promo à partir d'aujourd'hui (Réunion). */
export function officeSlotDays(startAt: number, endAt: number, now: number): string[] {
  const days: string[] = [];
  const first = Math.max(startAt, now);
  let t = Math.floor((first + REUNION_OFFSET_MS) / DAY_MS) * DAY_MS - REUNION_OFFSET_MS;
  for (; t <= endAt && days.length < 60; t += DAY_MS) {
    const day = new Date(t + REUNION_OFFSET_MS).toISOString().slice(0, 10);
    if (officeSlotHours(day, now).length > 0) days.push(day);
  }
  return days;
}

/** Heures de début possibles ce jour-là (heures déjà commencées exclues aujourd'hui). */
export function officeSlotHours(day: string, now: number): number[] {
  const range = OFFICE_SLOT_HOURS[weekday(day)];
  if (!range) return [];
  const today = reunionToday(now);
  if (day < today) return [];
  const currentHour = new Date(now + REUNION_OFFSET_MS).getUTCHours();
  const hours: number[] = [];
  for (let h = range[0]; h < range[1]; h++) if (day !== today || h > currentHour) hours.push(h);
  return hours;
}

export function isOfficeSlot(startAt: number, endAt: number, day: string, hour: number, now: number): boolean {
  return officeSlotDays(startAt, endAt, now).includes(day) && officeSlotHours(day, now).includes(hour);
}

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * Textes des champs GHL du créneau, au même format que le site d'invitation :
 * "Vendredi 27 novembre" / "9 h à 10 h" / "Vendredi 27 novembre, 9 h à 10 h" / "11-27-2026 09:00 AM".
 */
export function ghlSlotTexts(day: string, hour: number): { jour: string; heure: string; creneau: string; debut: string } {
  const d = new Date(`${day}T00:00:00Z`);
  const jour = `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
  const heure = `${hour} h à ${hour + 1} h`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const debut = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${d.getUTCFullYear()} ${pad(h12)}:00 ${hour < 12 ? "AM" : "PM"}`;
  return { jour, heure, creneau: `${jour}, ${heure}`, debut };
}
