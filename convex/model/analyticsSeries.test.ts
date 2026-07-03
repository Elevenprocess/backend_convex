import { expect, test } from "vitest";
import { buildDailyEvolution, buildHourlyCalls, dailyLogicalCalls } from "./analyticsBuilders";
import { buildRange } from "./analyticsRange";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const range = buildRange("2026-07-01T00:00:00.000Z", "2026-07-02T23:59:59.999Z", 1, NOW);
const D1_9H = Date.UTC(2026, 6, 1, 5, 0); // 9h Réunion le 01/07
const D2_10H = Date.UTC(2026, 6, 2, 6, 0); // 10h Réunion le 02/07

test("buildDailyEvolution : appels/nouveaux leads/RDV/CA au bon jour Réunion", () => {
  const leads = [{ id: "L1", source: "ghl", status: "qualifie", createdAt: D1_9H }] as any[];
  const calls = [
    { leadId: "L1", setterId: "S1", calledAt: D1_9H, result: "joint" },
    { leadId: "L1", setterId: "S1", calledAt: D2_10H, result: "rdv_pris" },
  ] as any[];
  const rdvs = [
    { leadId: "L1", status: "honore", result: "signe", montantTotal: 10000, scheduledAt: D2_10H, createdAt: D2_10H },
  ] as any[];
  const points = buildDailyEvolution(leads, calls, rdvs, range);
  // La borne 2026-07-02T23:59:59.999Z tombe le 03/07 à La Réunion (UTC+4) :
  // les buckets couvrent les jours LOCAUX de la plage (parité NestJS).
  expect(points.map((p) => p.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  expect(points[0].newLeads).toBe(1);
  expect(points[0].calls).toBe(1);
  // lead classifié retravaillé sur 2 jours → compte sur CHAQUE jour d'appel
  expect(points[0].classified).toBe(1);
  expect(points[1].classified).toBe(1);
  expect(points[1].rdv).toBe(1);
  expect(points[1].signed).toBe(1);
  expect(points[1].ca).toBe(10000);
  // qualified = RDV CRÉÉS ce jour (événement daté, jamais le statut actuel)
  expect(points[1].qualified).toBe(1);
  expect(points[0].qualified).toBe(0);
});

test("buildDailyEvolution : lead classifié sans appel loggé → un seul jour (lastContactAt)", () => {
  const leads = [
    { id: "L1", source: "ghl", status: "pas_qualifie", createdAt: D1_9H, lastContactAt: D2_10H },
  ] as any[];
  const points = buildDailyEvolution(leads, [], [], range);
  expect(points[0].classified).toBe(0);
  expect(points[1].classified).toBe(1);
});

test("buildHourlyCalls : buckets 8h-21h Réunion", () => {
  const calls = [{ leadId: "L1", setterId: "S1", calledAt: D1_9H, result: "joint" }] as any[];
  const points = buildHourlyCalls(calls, range);
  const hit = points.find((p) => p.date === "2026-07-01" && p.hour === 9);
  expect(hit!.calls).toBe(1);
  expect(points.every((p) => p.hour >= 8 && p.hour <= 21)).toBe(true);
});

test("dailyLogicalCalls : max(appels loggés, classifiés traités) par jour", () => {
  const calls = [{ leadId: "L1", setterId: "S1", calledAt: D1_9H, result: "joint" }] as any[];
  const classified = [
    { id: "L2", source: "ghl", status: "pas_qualifie", createdAt: D1_9H, lastContactAt: D2_10H },
  ] as any[];
  expect(dailyLogicalCalls(calls, classified, range)).toEqual([1, 1, 0]);
});
