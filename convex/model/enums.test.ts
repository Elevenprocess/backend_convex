import { expect, test } from "vitest";
import { ROLES, LEAD_STATUSES, CALL_RESULTS, roleValidator } from "./enums";

test("les rôles reprennent les 10 valeurs Postgres", () => {
  expect(ROLES).toEqual([
    "admin", "setter", "setter_lead", "commercial", "commercial_lead",
    "delivrabilite", "responsable_technique", "back_office", "technicien", "finances",
  ]);
});

test("leadStatus reprend les 11 statuts", () => {
  expect(LEAD_STATUSES).toContain("nouveau");
  expect(LEAD_STATUSES).toContain("pas_de_reponse");
  expect(LEAD_STATUSES).toHaveLength(11);
});

test("callResult reprend les 7 résultats", () => {
  expect(CALL_RESULTS).toHaveLength(7);
});

test("roleValidator est un validator union", () => {
  expect(roleValidator.kind).toBe("union");
});
