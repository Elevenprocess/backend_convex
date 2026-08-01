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

export type DayRangeMs = RangeMs & { fromDay: string; toDay: string };

/**
 * Plage recalée sur les jours calendaires VOULUS par l'utilisateur, alignés
 * Réunion. Les bornes ISO du DateRangePicker sont minuit → 23:59:59 dans le
 * fuseau du NAVIGATEUR (inconnu, pas forcément UTC+4) : prendre
 * reunionDayKey(fromMs/toMs) directement décale la plage d'un jour dès que
 * l'émetteur n'est pas en UTC+4 (ex. « juillet » depuis UTC+3 débordait sur le
 * 1er août). On se recale au milieu du jour émetteur (±12 h) avant de prendre
 * la clé — exact pour tout fuseau de UTC-8 à UTC+16 — puis on réaligne les
 * bornes ms sur ces jours Réunion, pour que buckets quotidiens (date) et
 * cohortes (timestamps) partagent la même fenêtre.
 */
export function reunionDayRange(
  fromIso: string | undefined,
  toIso: string | undefined,
  fallbackDays: number,
  nowMs: number,
): DayRangeMs {
  const base = buildRange(fromIso, toIso, fallbackDays, nowMs);
  const fromDay = reunionDayKey(base.fromMs + DAY_MS / 2);
  let toDay = reunionDayKey(base.toMs - DAY_MS / 2);
  if (toDay < fromDay) toDay = fromDay;
  const fromMs = Date.parse(`${fromDay}T00:00:00Z`) - REUNION_OFFSET_MS;
  const toMs = Date.parse(`${toDay}T00:00:00Z`) + DAY_MS - REUNION_OFFSET_MS - 1;
  const days = Math.round((toMs + 1 - fromMs) / DAY_MS);
  return { fromMs, toMs, days, fromDay, toDay };
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
