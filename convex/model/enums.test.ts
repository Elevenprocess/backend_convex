import { expect, test } from "vitest";
import { ROLES, LEAD_STATUSES, CALL_RESULTS, roleValidator } from "./enums";
import {
  RDV_STATUSES, RDV_LOCATIONS, RDV_RESULTS, FINANCING_TYPES, rdvStatusValidator,
} from "./enums";

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

test("rdvStatus reprend les 5 statuts Postgres", () => {
  expect(RDV_STATUSES).toEqual(["planifie", "honore", "no_show", "reporte", "annule"]);
});

test("rdvLocation reprend les 3 lieux", () => {
  expect(RDV_LOCATIONS).toEqual(["domicile", "agence", "visio"]);
});

test("rdvResult reprend les 5 résultats", () => {
  expect(RDV_RESULTS).toEqual(["signe", "reflexion", "perdu", "no_show", "reporte"]);
});

test("financingType reprend les 6 modes", () => {
  expect(FINANCING_TYPES).toEqual([
    "comptant", "financement", "financement_sans_apport",
    "apport_financement", "paiement_10x", "paiement_12x",
  ]);
});

test("rdvStatusValidator est un union", () => {
  expect(rdvStatusValidator.kind).toBe("union");
});
