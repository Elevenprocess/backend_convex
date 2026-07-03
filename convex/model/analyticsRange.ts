/**
 * Périodes analytics + bucketing en jours calendaires de La Réunion.
 * Transposition de buildRange/normalizeRange/reunionDayKey/dayKeys (analytics.service.ts)
 * en timestamps ms — pas d'Intl : La Réunion = UTC+4 fixe (pas de DST), donc
 * l'arithmétique d'offset est une équivalence exacte. Les bornes de période
 * restent en UTC (parité serveur Render TZ=UTC).
 */

const DAY_MS = 86_400_000;
const REUNION_OFFSET_MS = 4 * 3_600_000; // UTC+4 fixe

export type RangeMs = { fromMs: number; toMs: number; days: number };

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfUtcDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}

export function buildRange(
  fromIso: string | undefined,
  toIso: string | undefined,
  fallbackDays: number,
  nowMs: number,
): RangeMs {
  if (fromIso && toIso) {
    const a = Date.parse(fromIso);
    const b = Date.parse(toIso);
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      const fromMs = Math.min(a, b);
      const toMs = Math.max(a, b);
      const days = Math.max(1, Math.floor((toMs - fromMs) / DAY_MS) + 1);
      return { fromMs, toMs, days };
    }
  }
  const toMs = endOfUtcDay(nowMs);
  const fromMs = startOfUtcDay(nowMs - (Math.max(1, fallbackDays) - 1) * DAY_MS);
  const days = Math.max(1, Math.floor((toMs - fromMs) / DAY_MS) + 1);
  return { fromMs, toMs, days };
}

export function isInRange(ms: number | null | undefined, range: RangeMs): boolean {
  return ms != null && ms >= range.fromMs && ms <= range.toMs;
}

export function filterRange<T>(
  rows: T[],
  range: RangeMs,
  getMs: (row: T) => number | null | undefined,
): T[] {
  return rows.filter((row) => isInRange(getMs(row), range));
}

/** Jour calendaire à La Réunion (UTC+4 fixe) au format YYYY-MM-DD. */
export function reunionDayKey(ms: number): string {
  return new Date(ms + REUNION_OFFSET_MS).toISOString().slice(0, 10);
}

/** Heure locale Réunion (0-23). */
export function reunionHour(ms: number): number {
  return new Date(ms + REUNION_OFFSET_MS).getUTCHours();
}

/** Clés de jours Réunion couvrant la période, de from à to inclus. */
export function dayKeys(range: RangeMs): string[] {
  const keys: string[] = [];
  const endKey = reunionDayKey(range.toMs);
  let cursor = range.fromMs;
  while (true) {
    const key = reunionDayKey(cursor);
    keys.push(key);
    if (key >= endKey) break;
    cursor += DAY_MS;
  }
  return keys;
}

export function formatDayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}
