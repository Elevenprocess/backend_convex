import { expect, test } from "vitest";
import { buildSetterStats, buildCommercialStats, buildAdminStats } from "./analyticsBuilders";
import { buildRange } from "./analyticsRange";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const range = buildRange("2026-07-01T00:00:00.000Z", "2026-07-03T23:59:59.999Z", 1, NOW);
const T = Date.UTC(2026, 6, 2, 8, 0);

test("buildCommercialStats : signés depuis result (règle GHL), CA, panier, closing", () => {
  const rdvs = [
    { leadId: "L1", commercialId: "C1", status: "honore", result: "signe", montantTotal: 10000, scheduledAt: T, createdAt: T },
    { leadId: "L2", commercialId: "C1", status: "planifie", result: "signe", montantTotal: 20000, scheduledAt: T, createdAt: T },
    { leadId: "L3", commercialId: "C1", status: "honore", result: "perdu", montantTotal: null, scheduledAt: T, createdAt: T },
  ] as any[];
  const s = buildCommercialStats(rdvs, range);
  expect(s.total).toBe(3);
  expect(s.honored).toBe(2);
  expect(s.signed).toBe(2); // status planifie mais result signe → compté (import GHL)
  expect(s.ca).toBe(30000);
  expect(s.panier).toBe(15000);
  expect(s.closing).toBe(67); // 2 signés / max(2 honorés, 2+0+1 outcomes)=3
  expect(s.resultSegments.find((x: any) => x.label === "Signé")!.value).toBe(2);
});

test("buildSetterStats : qualification créditée au DERNIER appelant seulement", () => {
  const leads = [
    { id: "L1", source: "ghl", status: "qualifie", setterId: "S1", createdAt: T },
  ] as any[];
  const callsAll = [
    { leadId: "L1", setterId: "S1", calledAt: T, result: "joint" },
    { leadId: "L1", setterId: "S2", calledAt: T + 1000, result: "rdv_pris" },
  ] as any[];
  const qualifier = new Map([["L1", "S2"]]);
  // Vue S2 (dernier appelant) : crédité
  const s2 = buildSetterStats(
    leads,
    callsAll.filter((c: any) => c.setterId === "S2"),
    [],
    "S2",
    range,
    undefined,
    qualifier,
  );
  expect(s2.qualified).toBe(1);
  // Vue S1 (a appelé mais pas fait basculer) : PAS crédité
  const s1 = buildSetterStats(
    leads,
    callsAll.filter((c: any) => c.setterId === "S1"),
    [],
    "S1",
    range,
    undefined,
    qualifier,
  );
  expect(s1.qualified).toBe(0);
  expect(s1.answered).toBeGreaterThanOrEqual(1); // il a bien joint le lead
});

test("buildSetterStats : appels synthétiques pour les classifiés sans appel loggé", () => {
  const leads = [
    { id: "L1", source: "ghl", status: "pas_qualifie", setterId: "S1", createdAt: T, lastContactAt: T },
  ] as any[];
  const s = buildSetterStats(leads, [], [], "S1", range);
  expect(s.loggedCalls).toBe(0);
  expect(s.syntheticCalls).toBe(1);
  expect(s.calls).toBe(1);
  expect(s.notQualified).toBe(1);
  expect(s.classified).toBe(1);
});

test("buildAdminStats : nouveaux leads hors imports, funnel monotone, lignes équipe", () => {
  const users = [
    { id: "S1", name: "Setter Un", role: "setter" },
    { id: "C1", name: "Com Un", role: "commercial" },
    { id: "CL", name: "Resp Com", role: "commercial_lead" },
  ] as any[];
  const leads = [
    { id: "L1", source: "ghl", status: "qualifie", setterId: "S1", createdAt: T },
    { id: "L2", source: "airtable_migration", status: "signe", setterId: "S1", createdAt: T, lastContactAt: T },
  ] as any[];
  const calls = [{ leadId: "L1", setterId: "S1", calledAt: T, result: "joint" }] as any[];
  const rdvs = [
    { leadId: "L1", commercialId: "CL", status: "honore", result: "signe", montantTotal: 5000, scheduledAt: T, createdAt: T },
  ] as any[];
  const a = buildAdminStats(leads, calls, rdvs, users, range);
  expect(a.newLeads).toBe(1); // import historique exclu
  expect(a.classified).toBe(2);
  expect(a.qualified).toBe(2);
  expect(a.rdvPris).toBeLessThanOrEqual(a.qualified); // clamp monotone
  expect(a.signed).toBe(1);
  expect(a.ca).toBe(5000);
  expect(a.setters.map((r: any) => r.id)).toEqual(["S1"]);
  // commercial_lead ferme aussi : présent dans le classement commerciaux
  expect(a.commercials.map((r: any) => r.id)).toContain("CL");
});
