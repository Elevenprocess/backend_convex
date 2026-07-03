import { expect, test } from "vitest";
import { isSubstepUnlocked, computeSlaDeadline, missingDocuments, countMissingDocs } from "./substepGating";
import type { WorkflowSubstepKey, DocumentType } from "./enums";

type St = { key: WorkflowSubstepKey; status: string };
const make = (over: Partial<Record<WorkflowSubstepKey, string>>): St[] =>
  (Object.entries(over) as [WorkflowSubstepKey, string][]).map(([key, status]) => ({ key, status }));

test("isSubstepUnlocked : sous-étape sans prérequis déverrouillée", () => {
  expect(isSubstepUnlocked("vt_planifie", make({}))).toBe(true);
  expect(isSubstepUnlocked("dp_envoyee_mairie", make({}))).toBe(true);
});

test("isSubstepUnlocked : install_a_faire librement planifiable", () => {
  expect(isSubstepUnlocked("install_a_faire", make({}))).toBe(true);
  expect(isSubstepUnlocked("install_a_faire", make({ dp_validee: "fait", consuel_valide: "a_faire" }))).toBe(true);
});

test("computeSlaDeadline : date + 28j, null si absent", () => {
  expect(computeSlaDeadline("2026-06-01")).toBe("2026-06-29");
  expect(computeSlaDeadline("2026-07-01")).toBe("2026-07-29");
  expect(computeSlaDeadline("2026-12-10")).toBe("2027-01-07");
  expect(computeSlaDeadline(null)).toBeNull();
  expect(computeSlaDeadline(undefined)).toBeNull();
});

test("missingDocuments : true si un doc attendu manque", () => {
  expect(missingDocuments("vt_validee", [])).toBe(true);
  expect(missingDocuments("vt_validee", ["rapport_vt"])).toBe(false);
  expect(missingDocuments("racco_validee", [])).toBe(true);
  expect(missingDocuments("racco_validee", ["crae"])).toBe(false);
  expect(missingDocuments("vt_planifie", [])).toBe(false); // rien d'attendu
});

test("countMissingDocs compte les sous-étapes incomplètes", () => {
  const substeps = [
    { id: "s1", key: "vt_validee" },
    { id: "s2", key: "vt_planifie" },
  ];
  const docs = new Map<string, DocumentType[]>();
  expect(countMissingDocs(substeps, docs)).toBe(1);
  docs.set("s1", ["rapport_vt"]);
  expect(countMissingDocs(substeps, docs)).toBe(0);
});
