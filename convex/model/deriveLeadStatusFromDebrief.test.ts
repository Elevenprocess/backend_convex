import { expect, test } from "vitest";
import { deriveLeadStatusFromDebrief } from "./deriveLeadStatusFromDebrief";

test("vente → signe", () => {
  expect(deriveLeadStatusFromDebrief("vente", null)).toBe("signe");
});

test("en_reflexion → a_rappeler", () => {
  expect(deriveLeadStatusFromDebrief("en_reflexion", null)).toBe("a_rappeler");
});

test("suivi_prevu → a_rappeler", () => {
  expect(deriveLeadStatusFromDebrief("suivi_prevu", null)).toBe("a_rappeler");
});

test("non_vente avec nonSaleReason=suivi_prevu → a_rappeler", () => {
  expect(deriveLeadStatusFromDebrief("non_vente", "suivi_prevu")).toBe("a_rappeler");
});

test("non_vente sans motif particulier → perdu", () => {
  expect(deriveLeadStatusFromDebrief("non_vente", "pas_interesse")).toBe("perdu");
  expect(deriveLeadStatusFromDebrief("non_vente", null)).toBe("perdu");
});
