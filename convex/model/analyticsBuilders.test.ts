import { expect, test } from "vitest";
import {
  buildLatestCallByLead,
  buildQualifierByLead,
  leadTreatmentDate,
  isNewLeadInRange,
  isLeadActiveInRange,
  qualifierMatches,
  mapDebriefOutcomeToRdvResult,
  statusToResult,
  money,
  initialsFromName,
} from "./analyticsBuilders";
import { buildRange } from "./analyticsRange";

const NOW = Date.UTC(2026, 6, 3, 12, 0);
const range = buildRange("2026-07-01T00:00:00.000Z", "2026-07-03T23:59:59.999Z", 1, NOW);
const T1 = Date.UTC(2026, 6, 2, 8, 0);
const T2 = Date.UTC(2026, 6, 2, 10, 0);

test("buildLatestCallByLead / buildQualifierByLead : dernier appel gagne", () => {
  const calls = [
    { leadId: "L1", setterId: "S1", calledAt: T1, result: "joint" },
    { leadId: "L1", setterId: "S2", calledAt: T2, result: "rdv_pris" },
  ] as any[];
  expect(buildLatestCallByLead(calls).get("L1")).toBe(T2);
  expect(buildQualifierByLead(calls).get("L1")).toBe("S2");
});

test("leadTreatmentDate : dernier appel > lastContactAt, JAMAIS createdAt", () => {
  const latest = new Map([["L1", T2]]);
  expect(leadTreatmentDate({ id: "L1", createdAt: T1 } as any, latest)).toBe(T2);
  expect(leadTreatmentDate({ id: "L2", createdAt: T1, lastContactAt: T1 } as any, latest)).toBe(T1);
  expect(leadTreatmentDate({ id: "L3", createdAt: T1 } as any, latest)).toBeNull();
});

test("isLeadActiveInRange exige un traitement réel ; isNewLeadInRange exclut les imports historiques", () => {
  const latest = new Map<string, number>();
  expect(isLeadActiveInRange({ id: "L", createdAt: T1 } as any, range, latest)).toBe(false);
  expect(isNewLeadInRange({ id: "L", source: "ghl", createdAt: T1 } as any, range)).toBe(true);
  expect(isNewLeadInRange({ id: "L", source: "airtable_migration", createdAt: T1 } as any, range)).toBe(false);
});

test("qualifierMatches : dernier appelant sinon setter propriétaire", () => {
  const q = new Map([["L1", "S2"]]);
  expect(qualifierMatches({ id: "L1", setterId: "S1" } as any, "S2", q)).toBe(true);
  expect(qualifierMatches({ id: "L1", setterId: "S1" } as any, "S1", q)).toBe(false);
  expect(qualifierMatches({ id: "L2", setterId: "S1" } as any, "S1", q)).toBe(true); // fallback owner
  expect(qualifierMatches({ id: "L2", setterId: "S1" } as any, undefined, q)).toBe(false);
});

test("mapDebriefOutcomeToRdvResult", () => {
  expect(mapDebriefOutcomeToRdvResult("vente", null)).toBe("signe");
  expect(mapDebriefOutcomeToRdvResult("en_reflexion", null)).toBe("reflexion");
  expect(mapDebriefOutcomeToRdvResult("suivi_prevu", null)).toBe("reflexion");
  expect(mapDebriefOutcomeToRdvResult("non_vente", "no_show")).toBe("no_show");
  expect(mapDebriefOutcomeToRdvResult("non_vente", "suivi_prevu")).toBe("reflexion");
  expect(mapDebriefOutcomeToRdvResult("non_vente", "pas_interesse")).toBe("perdu");
});

test("statusToResult / money / initialsFromName", () => {
  expect(statusToResult("signe")).toBe("rdv_pris");
  expect(statusToResult("qualifie")).toBe("joint");
  expect(statusToResult("a_rappeler")).toBe("rappel_planifie");
  expect(statusToResult("pas_de_reponse")).toBe("non_joint");
  expect(statusToResult("perdu")).toBe("refus");
  expect(money(1500)).toBe(1500);
  expect(money(null)).toBe(0);
  expect(money(undefined)).toBe(0);
  expect(initialsFromName("Sophie Martin")).toBe("SM");
  expect(initialsFromName("")).toBe("??");
});
