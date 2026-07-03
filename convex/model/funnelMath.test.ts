import { expect, test } from "vitest";
import { computeFunnelTotals, RDV_REACHED_STATUSES, QUALIFIED_STATUSES, pct } from "./funnelMath";

// Tests purs — lead.status est la source de vérité ; le funnel doit être
// MONOTONE DÉCROISSANT : newLeads ≥ calls ≥ answered ≥ qualified ≥ rdv ≥ signed.

type L = { id: string; status: string };
const leads = (...statuses: string[]): L[] => statuses.map((status, i) => ({ id: `l${i}`, status }));

function compute(scoped: L[], opts: { calls?: { leadId: string | null; result: string }[]; rdvLeadIds?: string[] } = {}) {
  const classified = scoped.filter((l) => l.status !== "nouveau");
  return computeFunnelTotals({
    scopedLeads: scoped,
    classifiedLeads: classified,
    scopedCalls: opts.calls ?? [],
    rdvLeadIds: opts.rdvLeadIds ?? [],
  });
}

function expectMonotonic(t: ReturnType<typeof computeFunnelTotals>) {
  expect(t.newLeads).toBeGreaterThanOrEqual(t.calls);
  expect(t.calls).toBeGreaterThanOrEqual(t.answered);
  expect(t.answered).toBeGreaterThanOrEqual(t.qualified);
  expect(t.qualified).toBeGreaterThanOrEqual(t.rdv);
  expect(t.rdv).toBeGreaterThanOrEqual(t.signed);
}

test("les sets de statuts découplent qualified de rdv (bug racine historique)", () => {
  expect(RDV_REACHED_STATUSES.has("qualifie")).toBe(false);
  expect(QUALIFIED_STATUSES.has("qualifie")).toBe(true);
  expect(RDV_REACHED_STATUSES.has("rdv_pris")).toBe(true);
  expect(RDV_REACHED_STATUSES.has("signe")).toBe(true);
});

test("un lead simplement 'qualifie' compte en qualified mais PAS en RDV pris", () => {
  const t = compute(leads("qualifie"));
  expect(t.qualified).toBe(1);
  expect(t.rdv).toBe(0);
  expect(t.signed).toBe(0);
  expectMonotonic(t);
});

test("un lead 'rdv_pris' atteint qualified ET rdv", () => {
  const t = compute(leads("rdv_pris"));
  expect(t.qualified).toBe(1);
  expect(t.rdv).toBe(1);
  expect(t.signed).toBe(0);
  expectMonotonic(t);
});

test("un lead 'signe' traverse tout le funnel (nesting forcé)", () => {
  const t = compute(leads("signe"));
  expect(t.qualified).toBe(1);
  expect(t.rdv).toBe(1);
  expect(t.signed).toBe(1);
  expectMonotonic(t);
});

test("une ligne rdv réelle fait atteindre le stage rdv même sans statut rdv_pris", () => {
  const t = compute(leads("qualifie"), { rdvLeadIds: ["l0"] });
  expect(t.rdv).toBe(1);
  expect(t.qualified).toBe(1); // nesting : rdv ⊆ qualified
  expectMonotonic(t);
});

test("rdvLeadIds hors périmètre ignorés (intersection avec scopedLeads)", () => {
  const t = compute(leads("qualifie"), { rdvLeadIds: ["hors-scope"] });
  expect(t.rdv).toBe(0);
});

test("le résultat d'appel 'rdv_pris' ne crée PAS de vrai RDV", () => {
  const t = compute(leads("qualifie"), {
    calls: [{ leadId: "l0", result: "rdv_pris" }],
  });
  expect(t.answered).toBe(1);
  expect(t.rdv).toBe(0);
  expectMonotonic(t);
});

test("un lead qui a répondu n'est jamais compté en noAnswer", () => {
  const t = compute(leads("qualifie"), {
    calls: [
      { leadId: "l0", result: "non_joint" },
      { leadId: "l0", result: "joint" },
    ],
  });
  expect(t.noAnswer).toBe(0);
  expect(t.answered).toBe(1);
});

test("calls opérationnel clampé dans [answered, newLeads]", () => {
  // 1 lead classifié, 5 appels loggés sur ce lead → calls clampé à newLeads=1
  const t = compute(leads("qualifie"), {
    calls: Array.from({ length: 5 }, () => ({ leadId: "l0", result: "joint" })),
  });
  expect(t.calls).toBe(1);
  expectMonotonic(t);
});

test("pct : borné à 100, 0 si dénominateur nul", () => {
  expect(pct(5, 10)).toBe(50);
  expect(pct(20, 10)).toBe(100);
  expect(pct(1, 0)).toBe(0);
});
