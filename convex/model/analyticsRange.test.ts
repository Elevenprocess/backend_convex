import { expect, test } from "vitest";
import { buildRange, isInRange, reunionDayKey, reunionHour, dayKeys, formatDayLabel } from "./analyticsRange";

const NOW = Date.UTC(2026, 6, 3, 12, 0, 0); // 2026-07-03T12:00Z

test("buildRange explicite : bornes normalisées, inversion tolérée, days inclusif", () => {
  const r = buildRange("2026-07-01T00:00:00.000Z", "2026-07-03T23:59:59.999Z", 1, NOW);
  expect(r.days).toBe(3);
  const inv = buildRange("2026-07-03T23:59:59.999Z", "2026-07-01T00:00:00.000Z", 1, NOW);
  expect(inv.fromMs).toBe(r.fromMs);
  expect(inv.days).toBe(3);
});

test("buildRange fallbackDays : fenêtre [aujourd'hui-(n-1) 00:00 UTC, aujourd'hui 23:59:59.999 UTC]", () => {
  const r = buildRange(undefined, undefined, 7, NOW);
  expect(r.days).toBe(7);
  expect(new Date(r.fromMs).toISOString()).toBe("2026-06-27T00:00:00.000Z");
  expect(new Date(r.toMs).toISOString()).toBe("2026-07-03T23:59:59.999Z");
  expect(buildRange(undefined, undefined, 1, NOW).days).toBe(1);
});

test("buildRange ISO invalide → repli fallbackDays", () => {
  const r = buildRange("garbage", "2026-07-03", 3, NOW);
  expect(r.days).toBe(3);
  expect(new Date(r.toMs).toISOString()).toBe("2026-07-03T23:59:59.999Z");
});

test("isInRange bornes incluses", () => {
  const r = buildRange("2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z", 1, NOW);
  expect(isInRange(r.fromMs, r)).toBe(true);
  expect(isInRange(r.toMs, r)).toBe(true);
  expect(isInRange(r.toMs + 1, r)).toBe(false);
  expect(isInRange(null, r)).toBe(false);
  expect(isInRange(undefined, r)).toBe(false);
});

test("reunionDayKey : UTC+4 — 21h UTC = lendemain à La Réunion", () => {
  expect(reunionDayKey(Date.UTC(2026, 6, 3, 12, 0))).toBe("2026-07-03");
  expect(reunionDayKey(Date.UTC(2026, 6, 3, 21, 0))).toBe("2026-07-04");
  expect(reunionHour(Date.UTC(2026, 6, 3, 6, 30))).toBe(10); // 06:30Z = 10h30 Réunion
});

test("dayKeys couvre la période en jours Réunion, formatDayLabel JJ/MM", () => {
  const r = buildRange("2026-07-01T00:00:00.000Z", "2026-07-03T12:00:00.000Z", 1, NOW);
  expect(dayKeys(r)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  expect(formatDayLabel("2026-07-01")).toBe("01/07");
});
