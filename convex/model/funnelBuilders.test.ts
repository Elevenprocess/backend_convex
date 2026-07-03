import { expect, test } from "vitest";
import { matchesSector, buildFunnelDaily, buildFunnelSetterRows, buildFunnelCommercialRows } from "./funnelBuilders";
import { buildRange } from "./analyticsRange";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const range = buildRange("2026-07-01T00:00:00.000Z", "2026-07-02T19:59:59.999Z", 1, NOW);
const D1 = Date.UTC(2026, 6, 1, 5, 0); // 01/07 Réunion
const D2 = Date.UTC(2026, 6, 2, 5, 0); // 02/07 Réunion

test("matchesSector : city/canal/utm, insensible à la casse", () => {
  const lead = { id: "L", city: "Saint-Denis", canalAcquisition: "meta", utmSource: "fb" } as any;
  expect(matchesSector(lead, "saint-denis")).toBe(true);
  expect(matchesSector(lead, "META")).toBe(true);
  expect(matchesSector(lead, "fb")).toBe(true);
  expect(matchesSector(lead, "lyon")).toBe(false);
});

test("buildFunnelDaily : cohorte au jour de création du lead", () => {
  const leads = [{ id: "L1", source: "ghl", status: "qualifie", createdAt: D1 }] as any[];
  const calls = [
    { leadId: "L1", setterId: "S1", calledAt: D1, result: "joint" }, // même jour → compté
    { leadId: "L1", setterId: "S1", calledAt: D2, result: "joint" }, // autre jour → NON compté
  ] as any[];
  const points = buildFunnelDaily(leads, calls, [], range);
  const p1 = points.find((p: any) => p.date === "2026-07-01")!;
  const p2 = points.find((p: any) => p.date === "2026-07-02")!;
  expect(p1.newLeads).toBe(1);
  expect(p1.calls).toBe(1);
  expect(p1.qualified).toBe(1); // statut qualifie sur la cohorte du jour
  expect(p2.calls).toBe(0);
});

test("buildFunnelSetterRows : crédit dernier appelant, rows vides filtrées", () => {
  const users = [
    { id: "S1", name: "Setter Un", role: "setter" },
    { id: "S2", name: "Setter Deux", role: "setter" },
    { id: "S3", name: "Setter Trois", role: "setter" },
  ] as any[];
  const leads = [{ id: "L1", source: "ghl", status: "qualifie", setterId: "S1", createdAt: D1 }] as any[];
  const calls = [
    { leadId: "L1", setterId: "S1", calledAt: D1, result: "joint" },
    { leadId: "L1", setterId: "S2", calledAt: D1 + 1000, result: "rdv_pris" },
  ] as any[];
  const rows = buildFunnelSetterRows(leads, calls, [], users);
  const s1 = rows.find((r: any) => r.id === "S1")!;
  const s2 = rows.find((r: any) => r.id === "S2")!;
  expect(s2.qualified).toBe(1); // dernier appelant crédité
  expect(s1.qualified).toBe(0);
  expect(rows.find((r: any) => r.id === "S3")).toBeUndefined(); // 0 appel → filtré
});

test("buildFunnelCommercialRows : conversion signés/rdv, rows sans rdv filtrées", () => {
  const users = [
    { id: "C1", name: "Com Un", role: "commercial" },
    { id: "CL", name: "Resp", role: "commercial_lead" },
  ] as any[];
  const rdvs = [
    { leadId: "L1", commercialId: "C1", status: "honore", result: "signe", createdAt: D1 },
    { leadId: "L2", commercialId: "C1", status: "honore", result: "perdu", createdAt: D1 },
  ] as any[];
  const rows = buildFunnelCommercialRows(rdvs, users);
  expect(rows).toHaveLength(1); // CL sans rdv filtré
  expect(rows[0].rdv).toBe(2);
  expect(rows[0].conversionRate).toBe(50);
});
